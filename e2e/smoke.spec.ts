import { test, expect } from '@playwright/test'

// Smoke test: the homepage renders its shell without a working backend.
// Supabase calls may fail under dummy CI env, but the static chrome must load.
test('homepage loads with title and hero content', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Trek Buddies/)
  await expect(page.getByRole('heading', { name: /Upcoming/i })).toBeVisible()
})

test('explore page is reachable', async ({ page }) => {
  const res = await page.goto('/explore')
  expect(res?.status()).toBeLessThan(400)
})
