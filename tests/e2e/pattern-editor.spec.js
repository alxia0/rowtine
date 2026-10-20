// Lot B3 — Éditeur de patron.
//
// Task D2 : retrait de l'éditeur texte (ReaderMdEditor) du crayon PatternForm —
// la voie de correction texte d'un reader passe désormais exclusivement par
// l'écran de correction post-import (CorrectionView), jamais par le formulaire
// "Ajouter manuellement". Ce spec, qui pilotait auparavant ReaderMdEditor
// (textarea .rmd-textarea) pour composer un reader À LA CRÉATION, est réécrit :
// PatternForm ne compose plus de contenu de reader du tout — un patron créé
// manuellement n'a donc aucune section tant qu'il n'a pas été écrit dans l'éditeur.
//
// Scénario A : créer un patron en bibliothèque (infos seules, sans photo) → la fiche
//              propose « Écrire les instructions », qui ouvre l'éditeur vide ; le
//              texte écrit de zéro devient des étapes à cocher dans un projet.
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
import { completeOnboarding, openAddPatternSheet, attendreFinFondu } from './helpers'

// ─── Scénario A : création depuis la bibliothèque ─────────────────────────────

test('bibliothèque : patron créé sans photo → « Écrire les instructions » → étapes cochables dans un projet', async ({ page }) => {
  const name = 'Moufles Test'
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.goto('/library')
  await openAddPatternSheet(page)
  await page.getByRole('button', { name: /Créer manuellement/ }).click()
  await page.locator('#pat-name').fill(name)
  await page.getByRole('button', { name: 'Enregistrer' }).click()

  await expect(page).toHaveURL(/\/pattern\/\d+/)
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await expect(page.getByRole('button', { name: /Prévisualiser le patron/ })).toHaveCount(0)

  await page.getByRole('button', { name: /Écrire les instructions/ }).click()
  await expect(page).toHaveURL(/\/pattern\/\d+\/correct\?write=1$/)
  await expect(page.getByRole('heading', { name: 'Écrire le patron' })).toBeVisible()

  await page.getByRole('button', { name: 'Modifier le texte' }).click()
  await page.locator('.rte__host .cm-content').click()
  // insertText, pas type() : en émulation Android, CM6 diffère la touche Entrée et une
  // frappe qui la suit de près l'annule ; un clavier tactile réel passe par beforeinput.
  await page.keyboard.insertText('## Main\n- Monter 40 m.\n- Tricoter 20 rangs.')
  await expect(page.locator('.rte__host .cm-line')).toHaveCount(3)
  await page.getByRole('button', { name: 'Enregistrer' }).click()

  // Retour à la fiche : le patron a maintenant des sections, donc Prévisualiser.
  await expect(page).toHaveURL(/\/pattern\/\d+$/)
  await expect(page.getByRole('button', { name: /Prévisualiser le patron/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Écrire les instructions/ })).toHaveCount(0)

  await page.getByRole('button', { name: /Créer un projet à partir de ce patron/ }).click()
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/project\/\d+/)
  await page.getByRole('button', { name: /Suivre le patron/ }).click()

  await expect(page.locator('.rstep')).toHaveCount(2)
  await page.locator('.rcheck').first().click()
  await expect(page.locator('.rstep').first()).toHaveClass(/rstep--done/)
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
  // Contraste mesuré après le fondu d'entrée de l'écran, jamais pendant (attendreFinFondu).
  await attendreFinFondu(page)

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
