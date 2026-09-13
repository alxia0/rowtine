// Parcours #6 — Ajout d'une photo via le seam caméra (src/utils/photo.js).
// Vérifie que pickImage() mocké injecte bien une image dans le formulaire patron.
import { test, expect } from '@playwright/test'
import { completeOnboarding, setCameraPhoto, FAKE_PHOTO, openAddPatternSheet } from './helpers'

test('ajouter une photo à un patron utilise la caméra mockée', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.goto('/library')
  await openAddPatternSheet(page)
  await page.getByRole('button', { name: /Créer manuellement/ }).click()

  // On fixe la photo que pickImage() renverra, sur le document courant (déterministe).
  await setCameraPhoto(page, FAKE_PHOTO)
  await expect(page.locator('img.photorow__img')).toHaveCount(0)
  await page.getByRole('button', { name: 'Ajouter une photo' }).click()

  const img = page.locator('img.photorow__img')
  await expect(img).toHaveCount(1)
  await expect(img).toHaveAttribute('src', FAKE_PHOTO)
})

test('une annulation caméra (null) n’ajoute pas de photo', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.goto('/library')
  await openAddPatternSheet(page)
  await page.getByRole('button', { name: /Créer manuellement/ }).click()

  await setCameraPhoto(page, null) // pickImage() renverra null
  await page.getByRole('button', { name: 'Ajouter une photo' }).click()

  await expect(page.locator('img.photorow__img')).toHaveCount(0)
})
