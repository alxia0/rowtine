// Vérification finale — Lot A unification :
//   1. Projet libre (sans patron) → onglet Sections affiche la coquille reader
//      ("Mon tricot") ET le bloc compteurs ; aucun bouton "Ajouter une section".
//   2. Projet démo Bonnet Torsade → le suivi reader reste fonctionnel (taille + coches). Non-régression.
//   3. Audit a11y axe-core sur l'onglet Sections d'un projet libre.
//
// Convention : chaque test repart d'un contexte navigateur neuf (Playwright crée
// un contexte isolé par test → IndexedDB Dexie vide, pas de fuite d'état entre tests).
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { completeOnboarding } from './helpers'

// ───────────────────────── helpers locaux ──────────────────────────────────

// Crée un projet libre (sans choisir de patron) et atterrit sur l'onglet Sections.
async function createFreeProject(page, name = 'Écharpe test') {
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.getByRole('button', { name: /Créer un projet/ }).click()
  await expect(page).toHaveURL(/\/project\/new/)
  await page.locator('#name').fill(name)
  // NE PAS toucher au sélecteur de patron → le patron libre builtin est sélectionné par défaut.
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/project\/\d+/)
  // L'onglet Sections est actif par défaut.
  await expect(page.getByRole('tab', { name: /Sections/ })).toBeVisible()
}

// Ouvre le projet démo Bonnet Torsade (créé pendant l'onboarding) et navigue dans le suivi reader.
async function openDemoProjectReader(page) {
  await completeOnboarding(page, { firstName: 'Alex' })
  // L'onboarding seed un projet "Bonnet Torsade" en statut wip comme dernier projet.
  // On clique sur la section « Reprendre » du héros → atterrit sur la fiche projet.
  await page.locator('.resume').click()
  await expect(page).toHaveURL(/\/project\/\d+/)
  // Entrer dans le suivi interactif.
  await page.getByRole('button', { name: /Suivre le patron/ }).click()
  await expect(page).toHaveURL(/\/project\/\d+\/read/)
}

// ───────────────────────── scénario 1 : projet libre ──────────────────────

test('projet libre → coquille reader "Mon tricot" + bloc compteurs, pas de "Ajouter une section"', async ({ page }) => {
  await createFreeProject(page)

  // La coquille reader est affichée : section "Mon tricot" du patron libre builtin.
  await expect(page.locator('.rovw__title', { hasText: 'Mon tricot' })).toBeVisible()

  // Le bloc compteurs est présent (titre "Compteurs").
  await expect(page.locator('.counters-block')).toBeVisible()
  await expect(page.getByRole('heading', { name: /Compteurs/ })).toBeVisible()

  // Aucun formulaire d'ajout de section manuelle.
  await expect(page.getByText(/Ajouter une section/i)).toHaveCount(0)
})

// ───────────────────────── scénario 2 : non-régression Bonnet Torsade ──────

test('projet Bonnet Torsade → suivi reader opérationnel (tailles + coches) [non-régression]', async ({ page }) => {
  await openDemoProjectReader(page)

  // Des sélecteurs de taille sont présents (Bonnet Torsade a S, M, L).
  await expect(page.locator('.szpill').first()).toBeVisible()

  // Des étapes cochables sont présentes.
  await expect(page.locator('.rcheck').first()).toBeVisible()

  // La progression démarre à 0 %.
  await expect(page.locator('.rhdr__pct')).toHaveText('0 %')

  // Cocher la première étape fait progresser.
  await page.locator('.rcheck').first().click()
  await expect(page.locator('.rstep').first()).toHaveClass(/rstep--done/)
  await expect(page.locator('.rhdr__pct')).not.toHaveText('0 %')
})

// ───────────────────────── scénario 3 : audit a11y ─────────────────────────

test('projet libre — onglet Sections sans violation a11y bloquante', async ({ page }) => {
  await createFreeProject(page)

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
