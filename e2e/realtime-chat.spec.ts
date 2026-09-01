import { test, expect, type Page } from '@playwright/test'

// Two real browser sessions against the same conversation, driving the three things
// that have been failing by hand: presence (online count), typing broadcast, and live
// message delivery — plus the tab-focus regression that used to kill the channel silently.
//
// Assertions are on user-visible behaviour, not console output, so the page ships without
// diagnostic logging. Page errors and any stray console output are still printed to make a
// failure readable.

const CONVERSATION_ID =
  process.env.E2E_CONVERSATION_ID ?? 'acaf4728-0921-4db8-8431-8947679bfbd1'

const A = { email: process.env.E2E_A_EMAIL, password: process.env.E2E_A_PASSWORD }
const B = { email: process.env.E2E_B_EMAIL, password: process.env.E2E_B_PASSWORD }

const haveCreds = Boolean(A.email && A.password && B.email && B.password)

function tap(page: Page, label: string) {
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`  ${label} ${msg.type()}: ${msg.text()}`)
    }
  })
  page.on('pageerror', err => console.log(`  ${label} PAGE ERROR ${err.message}`))
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/auth/login')
  await page.locator('input[type="email"]:visible').first().fill(email)
  await page.locator('input[type="password"]:visible').first().fill(password)
  await page.locator('button[type="submit"]:visible').first().click()
  await page.waitForURL(url => !url.pathname.startsWith('/auth/login'), { timeout: 30_000 })
}

async function openConversation(page: Page) {
  await page.goto(`/messages?conversationId=${CONVERSATION_ID}`)
  await expect(page.getByPlaceholder('Message the group...')).toBeVisible({ timeout: 30_000 })
}

test.describe('realtime chat between two sessions', () => {
  test.skip(!haveCreds, 'Set E2E_A_EMAIL / E2E_A_PASSWORD / E2E_B_EMAIL / E2E_B_PASSWORD')
  test.setTimeout(120_000)

  test('presence, typing and message delivery all reach the other session', async ({ browser }) => {
    const ctxA = await browser.newContext()
    const ctxB = await browser.newContext()
    const pageA = await ctxA.newPage()
    const pageB = await ctxB.newPage()

    tap(pageA, '[A]')
    tap(pageB, '[B]')

    console.log('\n--- signing in ---')
    await signIn(pageA, A.email!, A.password!)
    await signIn(pageB, B.email!, B.password!)

    console.log('\n--- opening conversation in both sessions ---')
    await openConversation(pageA)
    await openConversation(pageB)

    // Presence only reaches the UI if the server sent the initial presence_state frame:
    // without it RealtimePresence.joinRef stays null, inPendingSyncState() is permanently
    // true, and every presence_diff is buffered rather than dispatched. A correct count here
    // is proof that frame arrived, so it needs no console assertion. A failure means the
    // `presence: { enabled: true }` flag stopped reaching the server — most likely a client
    // upgrade changed the join payload.
    console.log('\n--- presence: each session should count both members ---')
    await expect(pageA.getByText('2 online')).toBeVisible({ timeout: 20_000 })
    await expect(pageB.getByText('2 online')).toBeVisible({ timeout: 20_000 })

    console.log('\n--- typing: B types, A should show the indicator with B\'s real name ---')
    await pageB.getByPlaceholder('Message the group...').fill('typing a message')
    await expect(pageA.getByText(/typing…/)).toBeVisible({ timeout: 15_000 })
    await expect(pageA.getByText(/^(?!.*Hiker).*typing…/)).toBeVisible({ timeout: 15_000 })

    console.log('\n--- delivery: B sends, A should receive without reloading ---')
    const body = `e2e realtime probe ${Date.now()}`
    const composerB = pageB.getByPlaceholder('Message the group...')
    await composerB.fill(body)
    await composerB.press('Enter')
    await expect(pageA.getByText(body)).toBeVisible({ timeout: 20_000 })

    // The regression that started all of this: a backgrounded tab used to tear the channel
    // down and silently fail to rebuild it. Re-check delivery after A loses and regains focus.
    console.log('\n--- tab focus: A backgrounds and returns, delivery must survive ---')
    await pageA.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await pageA.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    const second = `e2e realtime probe after focus ${Date.now()}`
    await composerB.fill(second)
    await composerB.press('Enter')
    await expect(pageA.getByText(second)).toBeVisible({ timeout: 20_000 })

    // Presence surviving the focus round-trip is the real proof the channel was never torn
    // down: a rebuilt channel would have re-tracked from an empty presence state.
    await expect(pageA.getByText('2 online')).toBeVisible({ timeout: 20_000 })

    await ctxA.close()
    await ctxB.close()
  })
})
