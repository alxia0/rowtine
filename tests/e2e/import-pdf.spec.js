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
  // La feuille d'ajout partage la classe `.lib-import__input` avec le choix Rowtine (23/09) :
  // scoper par `accept` pour cibler le choix PDF sans ambiguïté.
  await page.locator('.lib-import__input[accept*="pdf"]').setInputFiles(FIXTURE)
  // Depuis le 17/08 : plus de navigation automatique — l'écran reste affiché avec un bloc
  // de réussite. Depuis la refonte du bilan (lot du 23/09/2026) : titre, bilan chiffré (bulle
  // en cartes), puis « Prévisualiser le patron » comme bouton principal (le fixture a des
  // sections) — plus de « Voir le patron » pour ce cas.
  await expect(page.getByText('Ton patron est importé')).toBeVisible()
  const sectionsTile = page.locator('.done__tile').filter({ hasText: /section/ })
  await expect(sectionsTile.locator('.done__tile-val')).not.toHaveText('0')
  const stepsTile = page.locator('.done__tile').filter({ hasText: /étape/ })
  await expect(stepsTile.locator('.done__tile-val')).not.toHaveText('0')

  await page.getByRole('button', { name: 'Prévisualiser le patron' }).click()
  await expect(page).toHaveURL(/\/pattern\/\d+\/read$/)

  // Retour : la fiche patron a pris la place de l'écran d'import dans l'historique (cf.
  // previewPattern() dans LocalPdfImportView.vue) — un retour arrière ramène donc sur la
  // fiche, jamais sur le bloc de réussite déjà quitté.
  await page.goBack()
  await expect(page).toHaveURL(/\/pattern\/\d+$/)
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
  // l'enregistrement — l'écran reste affiché, avec un bouton vers le lecteur (le fixture a
  // des sections, cf. le test précédent).
  await chooser.setFiles(FIXTURE)
  await page.getByRole('button', { name: 'Prévisualiser le patron' }).click()
  await expect(page).toHaveURL(/\/pattern\/\d+\/read$/)
})
