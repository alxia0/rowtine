// Le prix du patron, de bout en bout (lot 07/08). Ce que les tests unitaires ne peuvent pas
// prouver : que les écrans se parlent réellement.
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers.js'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const m = JSON.parse(readFileSync(path.join(__dirname, '../../src/i18n/fr.json'), 'utf-8'))

test.beforeEach(async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting', messages: m })
})

test('1. un prix saisi dans le formulaire projet ressort dans les Dépenses', async ({ page }) => {
  await page.goto('/library')
  await page.locator('.pcard').first().click()
  await expect(page).toHaveURL(/\/pattern\/\d+/)
  await page.getByRole('button', { name: new RegExp(m.pattern.createProject) }).click()
  await page.locator('#name').fill('Bonnet du dimanche')
  await page.locator('[data-test="pattern-price"]').fill('18')
  await page.getByRole('button', { name: m.common.save }).click()
  await expect(page).toHaveURL(/\/project\/\d+/)

  await page.goto('/expenses')
  await expect(page.locator('.exp__line')).toContainText([new RegExp(m.expenses.tagPattern)])
  await expect(page.locator('[data-test="expenses-breakdown"]').first()).toContainText(m.expenses.categoryPattern)
})

test('2. DEUX projets sur le même patron ⇒ UNE SEULE dépense', async ({ page }) => {
  // Le test qui justifie toute la décision : le prix appartient au patron, pas au projet.
  await page.goto('/library')
  await page.locator('.pcard').first().click()
  // Attendre la navigation AVANT de lire l'URL : `.click()` se résout dès l'événement clic
  // envoyé, pas une fois la navigation SPA (async, via le garde de route) terminée. Sans
  // cette attente, `page.url()` peut encore pointer sur `/library` — capturé en course.
  await expect(page).toHaveURL(/\/pattern\/\d+/)
  const patternUrl = page.url()
  await page.getByRole('button', { name: new RegExp(m.pattern.createProject) }).click()
  await page.locator('#name').fill('Bonnet A')
  await page.locator('[data-test="pattern-price"]').fill('18')
  await page.getByRole('button', { name: m.common.save }).click()
  await expect(page).toHaveURL(/\/project\/\d+/)
  const projetA = page.url()

  await page.goto(patternUrl)
  await page.getByRole('button', { name: new RegExp(m.pattern.createProject) }).click()
  await page.locator('#name').fill('Bonnet B')
  // Le prix est DÉJÀ là, hérité du patron : on n'y touche pas.
  await expect(page.locator('[data-test="pattern-price"]')).toHaveValue('18')
  await page.getByRole('button', { name: m.common.save }).click()
  await expect(page).toHaveURL(/\/project\/\d+/)
  // DEUX projets bien distincts, pas le même rouvert : sans quoi « une seule dépense »
  // ci-dessous ne prouverait rien de plus qu'« un seul projet, une seule dépense ».
  expect(page.url()).not.toBe(projetA)

  await page.goto('/expenses')
  await page.locator('[data-test="expenses-category-select"]').selectOption('pattern')
  await expect(page.locator('.exp__line')).toHaveCount(1)
})

test('3. le bouton Gratuit produit une ligne « Gratuit » sans gonfler le total', async ({ page }) => {
  await page.goto('/library')
  await page.locator('.pcard').first().click()
  await page.getByRole('button', { name: new RegExp(m.pattern.createProject) }).click()
  await page.locator('#name').fill('Écharpe')
  await page.locator('[data-test="pattern-price-free"]').click()
  await expect(page.locator('[data-test="pattern-price"]')).toHaveValue('0')
  await page.getByRole('button', { name: m.common.save }).click()
  await expect(page).toHaveURL(/\/project\/\d+/)

  await page.goto('/expenses')
  await page.locator('[data-test="expenses-category-select"]').selectOption('pattern')
  await expect(page.locator('.exp__line').first()).toContainText(m.expenses.freeTag)
  // « Sans gonfler le total » : une dépense à 0 est EXCLUE du total (totalsByCurrency ignore
  // les montants nuls, cf. src/utils/purchases.js) — comme c'est la SEULE dépense de ce test,
  // le bloc de total n'apparaît même pas.
  await expect(page.locator('[data-test="expenses-totals"]')).toHaveCount(0)
})

test('4. un projet en « Patron libre » n’a aucun champ de prix', async ({ page }) => {
  await page.goto('/project/new')
  await expect(page.locator('[data-test="pattern-price-hidden"]')).toBeVisible()
  await expect(page.locator('[data-test="pattern-price"]')).toHaveCount(0)
})
