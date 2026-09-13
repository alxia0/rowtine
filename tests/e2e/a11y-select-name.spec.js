// Garde ciblée : le select de langue doit avoir un NOM ACCESSIBLE, sur les deux écrans qui
// en proposent un (Onboarding et Réglages). Trouvé par hasard le 29/07 (violation axe
// `select-name`, critical) via le balayage global de `a11y.spec.js` — ce test-ci dit QUOI
// est cassé si ça régresse, et ne dépend d'aucun mécanisme précis (aria-labelledby vers un
// h2 en Réglages, `<label for>` en Onboarding : les deux sont des choix valides selon le
// balisage environnant, cf. commentaire dans SettingsView.vue).
//
// Assertion sur le NOM CALCULÉ (`toHaveAccessibleName`), pas sur la présence d'un attribut
// précis : elle doit rester verte si on change de mécanisme (label ↔ aria-labelledby) et
// rouge si le nom accessible redevient vide, quelle qu'en soit la cause (lien qui pointe
// vers un id disparu, attribut retiré, etc.).
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

test('select de langue (Onboarding) — a un nom accessible', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Bienvenue sur Rowtine' })).toBeVisible()
  await expect(page.locator('#onb-language')).toHaveAccessibleName('Langue')
})

test('select de langue (Réglages) — a un nom accessible', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.goto('/settings')
  await expect(page.getByText('Mes données')).toBeVisible()
  await expect(page.locator('#language')).toHaveAccessibleName('Langue')
})
