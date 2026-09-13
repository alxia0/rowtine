// Invite de désignation du dossier SAF au 1er lancement.
// Contrairement à onboarding.spec.js (assistant prénom/technique), cette invite
// ne s'affiche QUE sur plateforme native (Capacitor.isNativePlatform()) : sur le
// web (le contexte de nos e2e Playwright), elle ne doit JAMAIS apparaître, quel
// que soit l'état (1er lancement ou non). Il n'existe pas de seam e2e pour
// simuler `isNativePlatform()` (cf. tests/unit/onboarding-folder-prompt.spec.js
// et backup-storage-selection.spec.js, qui mockent @capacitor/core en unitaire
// uniquement) — inventer un hack de navigateur pour forcer ce flag serait
// fragile. On couvre donc ici la garantie « absent sur web », aux deux moments
// où elle pourrait apparaître par erreur ; les états visible/masqué/a11y du
// dialogue sont couverts en unitaire (onboarding-folder-prompt.spec.js).
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { completeOnboarding } from './helpers'

test('au 1er lancement (web), l’invite de dossier SAF n’apparaît pas', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Bienvenue sur Rowtine' })).toBeVisible()
  await expect(page.locator('[data-test="choose-now"]')).toHaveCount(0)
  await expect(page.locator('[data-test="later"]')).toHaveCount(0)
})

test('après onboarding (web), l’invite de dossier SAF n’apparaît toujours pas', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  await expect(page.locator('[data-test="choose-now"]')).toHaveCount(0)

  // L'accueil reste exempt de toute violation a11y bloquante avec ce composant
  // monté (globalement, dans App.vue) mais non rendu (v-if false sur le web).
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const blocking = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact))
  expect(blocking).toEqual([])
})
