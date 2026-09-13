// « du 18/05/2026 au 11/08/2026 » doit s'afficher « Du 18/05/2026 au 11/08/2026 », pas
// « Du 18/05/2026 Au 11/08/2026 ». text-transform: capitalize capitalise CHAQUE mot -> on ne
// veut que la 1re lettre.
//
// Réorienté (finitions, grille calendaire du temps, 11/08) : ce test visait
// `.current__period`, la mention de la plage dans la tuile de total — retirée suite à un
// retour d'usage, une seule mention étant nécessaire (§4), sous le sélecteur (`.range`). `.range` porte le
// MÊME risque de capitalisation (même texte `rangeLabel`, même règle CSS) : le test garde donc
// son objet, seul le sélecteur cible change. `.bar__label` (périodes ET jours de semaine) n'est
// pas concerné par ce déplacement et reste tel quel.
//
// Réorienté à nouveau, tâche D (11/08) : les barres de période (`.bar__label` vérifié ici) ont
// déménagé dans l'onglet « Rythme », qui n'est plus affiché par défaut — un clic sur l'onglet
// est désormais nécessaire avant de les chercher. `.range` reste commun aux deux onglets, lui.
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

test('les libellés de période ne capitalisent que la première lettre', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })

  // Les barres de période ne s'affichent que si au moins une session est enregistrée
  // (aggregateByPeriod ne matérialise que les périodes ayant des sessions — StatsView.vue).
  // `.range`, lui, s'affiche dans tous les cas (hors du `v-if="hasAnyActivity"`) — mais on
  // enregistre quand même une vraie session via le chrono du lecteur, comme session.spec.js,
  // pour que `.bar__label` (testé plus bas) soit lui aussi visible.
  await page.locator('.resume').click()
  await expect(page).toHaveURL(/\/project\/\d+/)
  await page.getByRole('button', { name: /Suivre le patron/ }).click()
  await expect(page).toHaveURL(/\/project\/\d+\/read/)
  await page.locator('.chrono-fab__body').click() // démarre le chrono
  await page.waitForTimeout(1100)
  // Sort du lecteur vers la fiche (la séance poursuit) puis du PROJET vers l'accueil :
  // c'est ce second retour qui enregistre la session (garde « sortie de bulle », lot
  // « chrono unifié » 2026-08-30).
  await page.locator('.rhdr__back').click()
  await page.locator('.phdr__back').click()
  await expect(page.getByText(/Temps enregistré/)).toBeVisible()

  await page.goto('/stats')

  const plage = page.locator('.range')
  await expect(plage).toBeVisible()
  // Le bug : text-transform: capitalize sur l'élément met une majuscule à CHAQUE mot.
  await expect(plage).toHaveCSS('text-transform', 'none')
  // Le correctif : ::first-letter met la majuscule sur la 1re lettre seulement — on vérifie
  // que le pseudo-élément porte bien la règle (nécessaire, pas suffisant : cf. capture d'écran
  // pour prouver qu'il se génère réellement, .bar__label étant un <span> blockifié par flex).
  await expect(
    await plage.evaluate((el) => getComputedStyle(el, '::first-letter').textTransform),
  ).toBe('uppercase')

  // Les barres de période vivent dans l'onglet « Rythme » (tâche D, 11/08) — masqué par défaut.
  await page.getByRole('tab', { name: 'Rythme' }).click()
  const label = page.locator('.bar__label').first()
  await expect(label).toBeVisible()
  await expect(label).toHaveCSS('text-transform', 'none')
  await expect(
    await label.evaluate((el) => getComputedStyle(el, '::first-letter').textTransform),
  ).toBe('uppercase')
})
