import { test, expect, type Page } from '@playwright/test'

// signInAs() proves the password on a throwaway client, asks the database
// which kind of account it is, and only then hands the session to the real
// (cookie-backed) client. The mismatch branch — a trekker on the company tab —
// must end with the generic message and NOTHING persisted: no cookie, no
// storage, and the refresh token the password check minted revoked.
//
// This drives the real login page against a mocked Supabase, so it runs in CI
// where NEXT_PUBLIC_SUPABASE_URL is a dummy. What is under test is the
// client-side guarantee; is_trekker() itself is covered in tests/db.

const USER_ID = '00000000-0000-4000-8000-00000000a001'
const EMAIL = 'trekker@example.test'
const PASSWORD = 'correct-horse-battery'

// auth-js decodes the access token to read `exp`; it never verifies the
// signature client-side, so a syntactically valid JWT is enough.
function fakeJwt(payload: Record<string, unknown>) {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`
}

function fakeSession() {
  const now = Math.floor(Date.now() / 1000)
  const user = {
    id: USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: EMAIL,
    app_metadata: { provider: 'email' },
    user_metadata: { full_name: 'Trekker A' },
    created_at: '2026-01-01T00:00:00Z',
  }
  return {
    access_token: fakeJwt({ sub: USER_ID, role: 'authenticated', exp: now + 3600 }),
    refresh_token: 'fake-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    user,
  }
}

/**
 * Stand in for GoTrue + PostgREST for one page. The database says this is a
 * plain trekker account, whichever tab the login form is on.
 */
async function mockSupabase(page: Page) {
  const calls: string[] = []
  const session = fakeSession()

  await page.route(/\/auth\/v1\/token/, (route) => {
    calls.push('token')
    return route.fulfill({ json: session })
  })
  await page.route(/\/auth\/v1\/user/, (route) => route.fulfill({ json: session.user }))
  await page.route(/\/auth\/v1\/logout/, (route) => {
    calls.push('logout')
    return route.fulfill({ status: 204, body: '' })
  })
  await page.route(/\/rest\/v1\/profiles/, (route) =>
    route.fulfill({ json: { account_type: 'trekker' } }),
  )
  await page.route(/\/rest\/v1\/rpc\/is_trekker/, (route) => route.fulfill({ json: true }))

  return calls
}

async function submitLogin(page: Page) {
  await page.locator('input[type="email"]:visible').first().fill(EMAIL)
  await page.locator('input[type="password"]:visible').first().fill(PASSWORD)
  await page.locator('button[type="submit"]:visible').first().click()
}

async function persistedSessionKeys(page: Page) {
  const cookies = (await page.context().cookies()).map((c) => c.name).filter((n) => n.startsWith('sb-'))
  const storage = await page.evaluate(() =>
    Object.keys(window.localStorage).filter((k) => k.startsWith('sb-')),
  )
  return { cookies, storage }
}

test('a trekker signing in on the company tab is refused and nothing is persisted', async ({ page }) => {
  const calls = await mockSupabase(page)

  await page.goto('/auth/login')
  // The login and signup forms both render; the login form is first in the DOM.
  await page.getByRole('button', { name: 'A trek company' }).first().click()
  await submitLogin(page)

  // The message must not confirm what kind of account the email IS — only
  // that no company account was found.
  await expect(page.getByText('No company account found with that email.')).toBeVisible()
  await expect(page).toHaveURL(/\/auth\/login/)

  expect(calls).toContain('token')
  expect(calls, 'the probe must revoke the token it minted').toContain('logout')

  expect(await persistedSessionKeys(page)).toEqual({ cookies: [], storage: [] })
})

test('the same account on the trekker tab signs in and gets a cookie session', async ({ page }) => {
  // The control: if this fails, the mismatch test above passes for the wrong
  // reason (a login that never persists anything).
  const calls = await mockSupabase(page)

  await page.goto('/auth/login')
  await submitLogin(page)

  await expect(page.getByText('Login successful!')).toBeVisible()
  expect(calls).not.toContain('logout')

  const { cookies, storage } = await persistedSessionKeys(page)
  expect(cookies.some((n) => /^sb-.*-auth-token/.test(n))).toBe(true)
  // The real client is cookie-backed; the probe leaves nothing in storage.
  expect(storage).toEqual([])
})
