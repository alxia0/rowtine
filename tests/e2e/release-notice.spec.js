// Parcours — la pop-up « Nouveautés » de l'accueil après une mise à jour.
//
// Une installation neuve ne la voit jamais (le marqueur avance dès la fin de l'onboarding) ;
// une installation existante la voit une fois, puis plus après rechargement. On vérifie le
// DIALOGUE lui-même (rôle, titre, points), pas seulement la route.
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { completeOnboarding, writeSetting, readSetting } from './helpers'

const VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')).version
const TITRE = `Nouveautés de la version ${VERSION}`

test('une installation neuve ne voit jamais la pop-up, et la version est déjà notée', async ({ page }) => {
  await completeOnboarding(page)
  // `completeOnboarding` recharge déjà la page : l'accueil a été remonté depuis la base.
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText(TITRE)).toHaveCount(0)
  expect(await readSetting(page, 'lastSeenVersion')).toBe(VERSION)
})

test('une installation existante voit la pop-up une fois, pas après fermeture et rechargement', async ({ page }) => {
  await completeOnboarding(page)
  // Installation d'avant ce lot : onboardée, aucun marqueur.
  await writeSetting(page, 'lastSeenVersion', null)
  await page.reload()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(TITRE)
  expect(await dialog.locator('[data-test="confirm-items"] li').count()).toBeGreaterThan(0)

  await page.locator('[data-test="confirm-ok"]').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await readSetting(page, 'lastSeenVersion')).toBe(VERSION)

  await page.reload()
  await expect(page.getByRole('heading', { name: /Bonjour/ })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('« Tout voir » note la version et ouvre l\'écran À propos', async ({ page }) => {
  await completeOnboarding(page)
  await writeSetting(page, 'lastSeenVersion', null)
  await page.reload()
  await expect(page.getByRole('dialog')).toContainText(TITRE)

  await page.locator('[data-test="confirm-cancel"]').click()
  await expect(page).toHaveURL(/\/about$/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await readSetting(page, 'lastSeenVersion')).toBe(VERSION)
})
