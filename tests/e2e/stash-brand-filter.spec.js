import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

test.beforeEach(async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })
  await page.goto('/stash')
})

async function ajouterLaine(page, marque) {
  await page.getByRole('button', { name: 'Ajouter une laine' }).click()
  await page.waitForURL('**/stash/new')
  await page.locator('.addform select').first().selectOption('__other__')
  await page.locator('input[placeholder="Saisis la marque"]').fill(marque)
  await page.locator('.palette__sw[aria-label="moutarde"]').click()
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  // « Enregistrer » navigue vers la fiche fraîchement créée (route stash-item).
  await page.waitForURL(/\/stash\/\d+$/)
  await page.goto('/stash')
}

// Parcours « Filtrer » (menus posés précédemment) : bouton Filtrer → popup → critère
// Marque → option. Choisir une option APPLIQUE le filtre et REVIENT à la page des
// critères — la liste des cartes derrière la popup se met donc à jour immédiatement,
// ce que l'on asserte popup ouverte (preuve que l'application est réelle, pas différée
// à la fermeture).
test('le filtre par marque ne garde que les laines de la marque choisie', async ({ page }) => {
  await ajouterLaine(page, 'Drops')
  await ajouterLaine(page, 'Katia')
  await page.goto('/stash')

  await expect(page.locator('.ycard')).toHaveCount(2)

  await page.locator('[data-test="filter-menu-btn"]').click()
  await page.locator('[data-test="filter-crit-brand"]').click()
  await page.locator('[data-test="filter-option"]', { hasText: 'Drops' }).click()
  await expect(page.locator('.ycard')).toHaveCount(1)
  await expect(page.locator('.ycard')).toContainText('Drops')
  // Un critère actif → le badge compte 1.
  await expect(page.locator('[data-test="filter-badge"]')).toHaveText('1')

  // « Toutes les marques » remet le critère à zéro, sans repasser par la fermeture.
  await page.locator('[data-test="filter-crit-brand"]').click()
  await page.locator('[data-test="filter-all"]').click()
  await expect(page.locator('.ycard')).toHaveCount(2)
  await expect(page.locator('[data-test="filter-badge"]')).toHaveCount(0)
})
