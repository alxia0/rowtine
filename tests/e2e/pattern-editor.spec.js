// Lot B3 — Éditeur de patron.
//
// Task D2 : retrait de l'éditeur texte (ReaderMdEditor) du crayon PatternForm —
// la voie de correction texte d'un reader passe désormais exclusivement par
// l'écran de correction post-import (CorrectionView), jamais par le formulaire
// "Ajouter manuellement". Ce spec, qui pilotait auparavant ReaderMdEditor
// (textarea .rmd-textarea) pour composer un reader À LA CRÉATION, est réécrit :
// PatternForm ne compose plus de contenu de reader du tout — un patron créé
// manuellement n'a donc aucune section tant qu'il n'a pas été importé/corrigé.
//
// Scénario A : créer un patron en bibliothèque (infos seules, sans reader) →
//              réapparaît dans la liste ; la fiche affiche « Aucune section. »
//              (ni bouton Prévisualiser ni Corriger, faute de reader — les deux sont
//              gardés sur pattern.reader?.sections?.length :
//              Prévisualiser restauré sur la fiche, Corriger vit sur l'aperçu).
// Scénario C : audit a11y axe-core sur l'écran d'édition de patron (infos seules).
//
// (L'ancien scénario D, authoring de notation papier multi-tailles « 10 (12) »
// tapée à la création, n'a plus d'équivalent dans PatternForm — cette capacité
// vit désormais dans l'écran de correction post-import, cf. correction-import.spec.js.)
//
// Convention : chaque test Playwright crée un contexte navigateur neuf → IndexedDB Dexie vide,
// pas de fuite d'état entre tests (identique aux autres specs).
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { completeOnboarding, openAddPatternSheet } from './helpers'

// ─── Scénario A : création depuis la bibliothèque ─────────────────────────────

test('bibliothèque : créer un patron (infos seules) → apparaît dans la liste ; fiche sans section', async ({ page }) => {
  const name = 'Chaussette Test'
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.goto('/library')
  await openAddPatternSheet(page)
  await page.getByRole('button', { name: /Créer manuellement/ }).click()
  await page.locator('#pat-name').fill(name)
  await page.getByRole('button', { name: 'Enregistrer' }).click()

  // Le patron apparaît dans la liste bibliothèque.
  await expect(page.getByRole('button', { name })).toBeVisible()

  // Ouvrir la fiche patron.
  await page.getByRole('button', { name }).click()
  await expect(page).toHaveURL(/\/pattern\/\d+/)

  // Aucun reader composé à la création (PatternForm ne le permet plus) : message
  // « Aucune section. » et ni bouton Prévisualiser ni Corriger le patron (les deux
  // sont gardés sur pattern.reader?.sections?.length, ici vide).
  await expect(page.getByText('Aucune section.')).toBeVisible()
  await expect(page.getByRole('button', { name: /Prévisualiser le patron/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Corriger le patron/ })).toHaveCount(0)
})

// ─── Scénario C : audit a11y sur l'écran d'édition de patron ──────────────────

test("écran d'édition de patron — sans violation a11y bloquante (serious / critical)", async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.goto('/library')
  await openAddPatternSheet(page)
  await page.getByRole('button', { name: /Créer manuellement/ }).click()
  // Peupler les champs infos patron (nom, tailles) pour auditer l'écran dans un
  // état réel d'usage, pas seulement le squelette vide.
  await page.locator('#pat-name').fill('Audit Test')
  await page.getByPlaceholder('S, M, L').fill('S, M')

  // Audit axe-core — seuils serious / critical uniquement (cf. convention projet).
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const blocking = results.violations
    .filter((v) => ['serious', 'critical'].includes(v.impact))
    .map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
    }))
  expect(blocking).toEqual([])
})
