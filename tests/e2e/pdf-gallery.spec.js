// tests/e2e/pdf-gallery.spec.js — import PDF local : rétention du PDF + image ancrée
// sous sa ligne d'instruction (#5). La fixture « Pull Sabai Test » contient une image
// embarquée qui, à l'import, s'ancre de façon déterministe sous la ligne « Répéter ce
// rang … » (match verbatim) → elle apparaît sous cette ligne dans le Lecteur au lieu de
// la galerie. Le cas « image non ancrée → reste en galerie » est couvert en unitaire
// (pdf-import-orchestrator.spec.js).
import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { completeOnboarding, openAddPatternSheet } from './helpers'

const FIXTURE = fileURLToPath(new URL('./fixtures/Pull Sabai Test.pdf', import.meta.url))

test('le PDF importé est retenu et son image apparaît sous la bonne ligne', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })
  await page.goto('/library')
  // Le bouton biblio ouvre la feuille d'ajout (P2) ; le tap sur le label PDF
  // ouvre le sélecteur natif ; fournir le fichier à l'input caché déclenche la navigation
  // vers import-local et démarre l'import au montage.
  await openAddPatternSheet(page)
  await page.locator('.lib-import__input[accept*="pdf"]').setInputFiles(FIXTURE)
  // (#4) : plus d'écran de revue intermédiaire — on tape le bouton pour naviguer. Refonte
  // du bilan (lot du 23/09/2026) : le fixture a des sections, le bouton principal est donc
  // « Prévisualiser le patron » (mène au lecteur) plutôt que « Voir le patron » — un retour
  // arrière ramène sur la fiche, qui a pris la place de l'écran d'import dans l'historique.
  await page.getByRole('button', { name: 'Prévisualiser le patron' }).click()
  await expect(page).toHaveURL(/\/pattern\/\d+\/read$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/pattern\/\d+$/)

  // L'aperçu inline a été retiré de la fiche patron — l'image
  // embarquée, ancrée sous son instruction, se vérifie désormais dans l'aperçu
  // Prévisualiser (Lecteur en lecture seule, StepImages/.stepimgs). Le décodage canvas
  // des images pdfjs (Chromium headless) s'est révélé fiable ici (cf. historique de ce
  // test) : assertion stricte.
  await page.getByRole('button', { name: /Prévisualiser le patron/ }).click()
  await expect(page).toHaveURL(/\/pattern\/\d+\/read$/)
  await expect(page.locator('.stepimgs img').first()).toBeVisible()
  await page.locator('.rhdr__back').click()
  await expect(page).toHaveURL(/\/pattern\/\d+$/)

  // #5 — Rétention du PDF : la carte « PDF original » a été retirée ; le PDF reste joignable
  // en tapant la photo SOURCE (1re image = rendu de la page 1). La présence de cette photo +
  // de l'indice « Touchez la source… » (affiché seulement si pattern.pdf) prouve que le PDF
  // est conservé ET atteignable — sinon « jamais perdre d'info » serait violé.
  await expect(page.locator('.pphotos__img').first()).toBeVisible()
  await expect(page.getByText(/Touchez la source pour ouvrir le PDF/i)).toBeVisible()

  // Volet projet : un projet suivant ce patron rend le même reader → l'image reste
  // ancrée sous sa ligne dans le Lecteur du projet.
  await page.getByRole('button', { name: /Créer un projet à partir de ce patron/ }).click()
  await expect(page).toHaveURL(/\/project\/new/)
  await page.locator('#name').fill('Suivi Pull Sabai')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/project\/\d+/)
  await page.getByRole('button', { name: /Suivre le patron/ }).click()
  await expect(page).toHaveURL(/\/project\/\d+\/read/)
  await expect(page.locator('.stepimgs img').first()).toBeVisible()
})
