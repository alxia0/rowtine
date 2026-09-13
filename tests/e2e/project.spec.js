// Parcours critique #2 — Cycle de vie d'un projet (création + persistance Dexie).
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

test.beforeEach(async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })
})

test('créer un projet depuis l’accueil', async ({ page }) => {
  await page.getByRole('button', { name: /Créer un projet/ }).click()
  await expect(page).toHaveURL(/\/project\/new/)

  await page.locator('#name').fill('Pull torsadé de test')
  await page.getByRole('button', { name: 'Enregistrer' }).click()

  // On atterrit sur la fiche projet, qui affiche le nom saisi.
  await expect(page).toHaveURL(/\/project\/\d+/)
  await expect(page.getByText('Pull torsadé de test')).toBeVisible()
})

test('un nom vide bloque la création (validation)', async ({ page }) => {
  await page.getByRole('button', { name: /Créer un projet/ }).click()
  await page.getByRole('button', { name: 'Enregistrer' }).click()

  // Message d'erreur et on reste sur l'écran de création.
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page).toHaveURL(/\/project\/new/)
})

test('le projet créé survit à un rechargement (persistance locale)', async ({ page }) => {
  await page.getByRole('button', { name: /Créer un projet/ }).click()
  await page.locator('#name').fill('Châle persistant')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/project\/\d+/)
  const detailUrl = page.url()

  // Rechargement direct de la fiche → le projet est relu depuis IndexedDB (pas en mémoire).
  await page.reload()
  await expect(page).toHaveURL(detailUrl)
  await expect(page.getByText('Châle persistant')).toBeVisible()
})
