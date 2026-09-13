// Parcours #4 — Import PDF local (LocalPdfImportView + utils/pdf-import + worker pdfjs).
import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { completeOnboarding, openAddPatternSheet } from './helpers'

const FIXTURE = fileURLToPath(new URL('./fixtures/Pull Sabai Test.pdf', import.meta.url))

test.beforeEach(async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })
  await page.goto('/library')
})

test('le bouton d’import mène à l’écran local, qui analyse et sauvegarde', async ({ page }) => {
  // Le bouton biblio ouvre la feuille d'ajout (P2) ; le tap sur le label PDF
  // ouvre le sélecteur natif ; fournir le fichier à l'input caché déclenche la navigation
  // vers import-local et démarre l'import au montage.
  await openAddPatternSheet(page)
  // La feuille d'ajout partage la classe `.lib-import__input` avec le choix .zip (Task B3) :
  // scoper par `accept` pour cibler le choix PDF sans ambiguïté.
  await page.locator('.lib-import__input[accept*="pdf"]').setInputFiles(FIXTURE)
  // Depuis le 17/08 : plus de navigation automatique — l'écran reste
  // affiché avec un bloc de réussite, et c'est le clic sur « Voir le patron » qui navigue.
  await page.getByRole('button', { name: 'Voir le patron' }).click()
  await expect(page).toHaveURL(/\/pattern\/\d+$/)
  // La fiche patron est épurée, plus d'aperçu inline. La preuve
  // que le PDF a bien été analysé (sections extraites) est la présence du bouton
  // « Prévisualiser le patron », restauré et gardé sur reader.sections.length.
  await expect(page.getByRole('button', { name: /Prévisualiser le patron/ })).toBeVisible()
})

test('🚩 écran au repos : nouvelle ligne visible, ET le tap sur le bouton ouvre toujours le VRAI sélecteur de fichiers natif', async ({
  page,
}) => {
  // Une ligne d'explication (P3) a été ajoutée juste avant le <label>. Preuve que
  // rien ne s'est glissé entre le <label> et son <input> : `page.waitForEvent('filechooser')`
  // ne se résout QUE si le clic déclenche réellement l'activation native de l'input fichier
  // (contrairement à `setInputFiles()`, qui contourne le geste utilisateur et ne détecterait
  // pas une régression de ce type — cf. tests/e2e/library-add-sheet.spec.js).
  await page.goto('/import-local')

  await expect(page.getByText('Le patron est analysé sur ton appareil')).toBeVisible()
  await expect(page.getByText('Le patron est enregistré directement dans ta bibliothèque')).toBeVisible()

  const chooserPromise = page.waitForEvent('filechooser')
  await page.locator('label.file-pick').click()
  const chooser = await chooserPromise
  expect(chooser.isMultiple()).toBe(false)

  // Bout en bout : fournir le fichier au chooser mène bien à l'analyse, puis à
  // l'enregistrement — l'écran reste affiché, avec un bouton vers la fiche.
  await chooser.setFiles(FIXTURE)
  await page.getByRole('button', { name: 'Voir le patron' }).click()
  await expect(page).toHaveURL(/\/pattern\/\d+$/)
})
