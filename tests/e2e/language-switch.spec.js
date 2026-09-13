// Preuve fonctionnelle du passage multilingue (29/07, sélecteur passé en liste déroulante le
// même jour suite à un retour d'usage sur l'ergonomie) : l'allemand et l'espagnol ne sont pas
// qu'une option qui s'affiche, ils changent VRAIMENT l'interface, immédiatement, et le
// choix survit à un rechargement — `page.reload()` recharge tout le JS et repart de l'état
// persisté (Dexie/IndexedDB), ce qui est l'équivalent le plus proche d'un redémarrage d'app
// disponible sous Playwright (le mécanisme lui-même est celui déjà utilisé pour fr/en,
// cf. router/index.js `beforeEach` : on vérifie seulement qu'il tient avec 4 valeurs).
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

test('choisir Deutsch à l’accueil bascule l’UI immédiatement et survit à un rechargement', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Bienvenue sur Rowtine' })).toBeVisible()

  await page.locator('[data-test="onb-language"]').selectOption('de')
  await expect(page.getByRole('heading', { name: 'Willkommen bei Rowtine' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('de')

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Willkommen bei Rowtine' })).toBeVisible()
  // `<html lang>` APRÈS rechargement : c'est le chemin d'application réel de la locale
  // persistée (router/index.js `beforeEach`), celui que le test unitaire html-lang.spec.js ne
  // peut pas couvrir. index.html livre `lang="fr"` en dur : sans l'observateur de i18n,
  // l'attribut resterait 'fr' alors que l'interface est en allemand, et TalkBack prononcerait
  // l'allemand avec la phonétique française (constat 1 de la revue finale, 29/07).
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('de')
})

test('choisir Español dans les réglages bascule l’UI immédiatement et survit à un rechargement', async ({
  page,
}) => {
  await completeOnboarding(page)
  await page.goto('/settings')

  await page.locator('[data-test="language-select"]').selectOption('es')
  // « Idioma » = « langue » en espagnol (settings.language, es.json) : preuve que le
  // changement est réel, pas seulement une option mise en surbrillance.
  await expect(page.getByRole('heading', { name: 'Idioma', level: 2 })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('es')

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Idioma', level: 2 })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('es')
})

// Garde retirée à tort avec la bascule à boutons (revue du 29/07) : les gardes « 2 par rangée »
// supprimées portaient AUSSI la preuve que les 4 langues sont bien proposées (rangees.boutons
// === 4), pas seulement leur disposition. `selectOption('de'/'es')` plus haut échouerait déjà si
// l'allemand ou l'espagnol manquait, mais rien ne couvrait plus l'anglais après la suppression du
// bouton 'English' — d'où le test rouge sur main (tests/e2e/onboarding.spec.js). On restaure la
// garde de façon explicite, sur les deux écrans, plutôt que de dépendre indirectement d'un test
// de bascule qui pourrait lui-même être retiré ou changé de langue cible plus tard.
test('les 4 langues sont proposées dans le sélecteur de langue (onboarding)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Bienvenue sur Rowtine' })).toBeVisible()

  const select = page.locator('[data-test="onb-language"]')
  await expect(select.locator('option')).toHaveCount(4)
})

test('les 4 langues sont proposées dans le sélecteur de langue (réglages)', async ({ page }) => {
  await completeOnboarding(page)
  await page.goto('/settings')

  const select = page.locator('[data-test="language-select"]')
  await expect(select.locator('option')).toHaveCount(4)
})
