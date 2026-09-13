// Charte : un seul bouton terracotta plein visible par écran. Cf. audit UX 16/07.
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

test('l’écran Réglages n’a qu’un seul bouton principal', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })
  await page.goto('/settings')

  await expect(page.locator('.btn--primary:visible')).toHaveCount(1)
})
