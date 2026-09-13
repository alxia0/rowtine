// Revue lot 1 (02/08) : `.block__title:first-child` était mort pour TOUS les titres, pas
// seulement le premier — chaque `<h2>` de la politique de confidentialité était rendu dans
// SON PROPRE `<div v-for>`, donc chacun était le premier (et seul) enfant de son conteneur.
// Résultat mesuré : marge du haut à 0px sur chaque section, collée au paragraphe précédent.
// Corrigé en passant à `<template v-for>` (PrivacyPolicyView.vue) : ce test mesure la vraie
// disposition rendue plutôt que de supposer que le correctif CSS suffit — la politique du
// projet (« exiger l'image/la mesure, pas l'affirmation »).
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

test('politique de confidentialité : les titres de section ne sont pas collés au texte qui précède', async ({
  page,
}) => {
  await completeOnboarding(page)
  await page.goto('/about/privacy')
  await expect(page.getByText('Quelles données existent')).toBeVisible()

  const titles = page.locator('.block__title')
  const count = await titles.count()
  // Le contenu (privacy-policy.fr.js) porte 5 titres de section — si ce nombre change un
  // jour, ce test doit être relu, pas juste ajusté en silence. (Relu le 04/09 à l'ajout de
  // « Responsable et contact » : le 5e suit un paragraphe, même marge .block__title.)
  expect(count).toBeGreaterThanOrEqual(2)

  // Le 1er titre suit un paragraphe d'intro : sa marge du haut peut légitimement être 0 ou
  // non (les deux sont lisibles, l'intro et le 1er titre sont proches par construction). Le
  // test porte sur le 2e titre, qui doit lui être visuellement SÉPARÉ du bloc précédent.
  const secondTitleMarginTop = await titles.nth(1).evaluate((el) => parseFloat(getComputedStyle(el).marginTop))
  expect(secondTitleMarginTop).toBeGreaterThan(0)
})
