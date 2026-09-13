// PORTE DE SERVICE — un .zip déposé dans l'import PDF produit un patron. Depuis le
// 08/08/2026, l'interface ne propose PLUS de choix « .zip » : la fonction est fondue dans
// l'import PDF et sert à dépanner une utilisatrice en lui retravaillant son patron.
//
// ⚠️ Ce fichier est, avec tests/unit/local-import-zip-door.spec.js, le SEUL garde de cette
// fonction. S'il cesse de mordre, la porte peut disparaître sans que rien ne le dise.
import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { completeOnboarding, openAddPatternSheet } from './helpers'

const FIXTURE = fileURLToPath(new URL('./fixtures/mini-patron.zip', import.meta.url))

test.beforeEach(async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })
  await page.goto('/library')
})

test('un .zip déposé dans l’import PDF mène à la fiche patron', async ({ page }) => {
  await openAddPatternSheet(page)
  // Un SEUL input fichier dans la feuille désormais : celui de l'import PDF. C'est bien lui
  // qu'on nourrit d'un .zip — c'est tout le sujet de la porte de service.
  const inputs = page.locator('.pas__options .lib-import__input')
  await expect(inputs).toHaveCount(1)
  await inputs.setInputFiles(FIXTURE)
  await page.getByRole('button', { name: 'Voir le patron' }).click()
  await expect(page).toHaveURL(/\/pattern\/\d+$/)
  await expect(page.getByRole('heading', { name: 'Patron Zip Démo' })).toBeVisible()
})

test('🚩 rien dans la feuille d’ajout ne nomme le zip', async ({ page }) => {
  // La contrepartie du test précédent : la fonction marche, mais elle est INVISIBLE.
  // Sans cette assertion, réintroduire un libellé « .zip » passerait inaperçu.
  await openAddPatternSheet(page)
  const dialog = page.getByRole('dialog')
  await expect(dialog).not.toContainText('zip')
  await expect(dialog).not.toContainText('.zip')
})

test('🚩 l’ancienne adresse /import-zip ne mène plus à un écran d’import', async ({ page }) => {
  await page.goto('/import-zip')
  // La route a été retirée : l'application ne doit PAS afficher un écran d'import .zip.
  await expect(page.locator('input[type="file"]')).toHaveCount(0)
})
