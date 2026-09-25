// Import au format Rowtine (.rowtine ou .zip : patron .md + images). Porte visible depuis le
// 23/09 : option « Importer au format Rowtine » de la feuille d'ajout, écran d'import en mode
// `?format=rowtine`. Garde unitaire associée : tests/unit/local-import-zip-door.spec.js.
import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { completeOnboarding, openAddPatternSheet } from './helpers'

const FIXTURE = fileURLToPath(new URL('./fixtures/mini-patron.zip', import.meta.url))
const PDF = fileURLToPath(new URL('./fixtures/Pull Sabai Test.pdf', import.meta.url))

test.beforeEach(async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })
  await page.goto('/library')
})

test('« Importer au format Rowtine » importe le kit et mène à la fiche patron', async ({ page }) => {
  await openAddPatternSheet(page)
  await expect(page.getByRole('dialog')).toContainText('Importer au format Rowtine')
  await page.locator('.pas__options .lib-import__input--rowtine').setInputFiles(FIXTURE)
  // L'écran d'import est bien en mode Rowtine (la requête de route arrive jusqu'à la prop).
  await expect(page).toHaveURL(/\/import-local\?format=rowtine$/)
  await expect(page.getByRole('heading', { name: 'Importer au format Rowtine' })).toBeVisible()
  // Le patron du kit a des sections : le bouton principal du bloc de réussite est
  // « Prévisualiser le patron » (mène au lecteur) ; un retour arrière ramène sur la fiche.
  await page.getByRole('button', { name: 'Prévisualiser le patron' }).click()
  await expect(page).toHaveURL(/\/pattern\/\d+\/read$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/pattern\/\d+$/)
  await expect(page.getByRole('heading', { name: 'Patron Zip Démo' })).toBeVisible()
})

test('un PDF choisi par la porte Rowtine est refusé, sans partir dans l’import PDF', async ({ page }) => {
  await openAddPatternSheet(page)
  await page.locator('.pas__options .lib-import__input--rowtine').setInputFiles(PDF)
  await expect(page.getByText("Ce fichier n'est pas une archive Rowtine lisible")).toBeVisible()
  await expect(page.getByText('Ton patron est importé')).toHaveCount(0)
  // Le bouton de choix revient, dans le mode Rowtine.
  await expect(page.locator('label.file-pick')).toContainText('Choisir un fichier .rowtine ou .zip')
})

test('🚩 l’ancienne adresse /import-zip ne mène plus à un écran d’import', async ({ page }) => {
  await page.goto('/import-zip')
  // La route a été retirée : l'application ne doit PAS afficher un écran d'import .zip.
  await expect(page.locator('input[type="file"]')).toHaveCount(0)
})
