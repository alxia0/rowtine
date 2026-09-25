// Parcours — import PDF local d'un patron À DIAGRAMME VECTORIEL (grilles tracées en
// traits, pas d'image raster). Couvre bout-en-bout : parsePdfLocally → extractVectorRegions
// → clusterPathBoxes → associateImages, en conditions réelles (vrai pdfjs, vrai rendu
// canvas), ce que les tests unitaires mockent (pdf-import-vector-integration.spec.js).
//
// Fixture `vector-pattern.pdf` (voir fixtures/make-vector-pattern-pdf.mjs) : texte de
// patron minimal (pour ne pas être classé « scanné ») + 2 grilles vectorielles séparées
// par un grand blanc. `vector-grid.pdf` (aucun texte) NE PEUT PAS servir ici :
// chars=0 ⇒ heuristique « scanné » ⇒ n'atteint jamais l'extraction de régions.
import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { completeOnboarding, openAddPatternSheet } from './helpers'

const FIXTURE = fileURLToPath(new URL('./fixtures/vector-pattern.pdf', import.meta.url))
const MULTIGRID_FIXTURE = fileURLToPath(new URL('./fixtures/vector-multigrid.pdf', import.meta.url))
const TITLE_MULTIGRID_FIXTURE = fileURLToPath(
  new URL('./fixtures/vector-title-multigrid.pdf', import.meta.url),
)

test('import offline d’un PDF à diagramme vectoriel : au moins une grille est rendue', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })
  await page.goto('/library')
  // Le bouton biblio ouvre la feuille d'ajout (P2) ; le tap sur le label PDF
  // ouvre le sélecteur natif ; fournir le fichier à l'input caché déclenche la navigation
  // vers import-local et démarre l'import au montage.
  await openAddPatternSheet(page)
  await page.locator('.lib-import__input[accept*="pdf"]').setInputFiles(FIXTURE)
  // Pas de branche « PDF scanné » : le texte (Corps/Rang…) suffit à passer l'heuristique.
  // (#4) : plus d'écran de revue intermédiaire — il faut cliquer le bouton. Refonte du
  // bilan (lot du 23/09/2026) : ce fixture a des sections (la grille promue), le bouton
  // principal du bloc de réussite est donc « Prévisualiser le patron », qui mène
  // directement au lecteur — plus de « Voir le patron » pour ce cas.
  await page.getByRole('button', { name: 'Prévisualiser le patron' }).click()
  await expect(page).toHaveURL(/\/pattern\/\d+\/read$/)
  // Fondu d'entrée (<Transition mode="out-in">, cf. le test suivant pour le détail) :
  // attendre le lecteur monté avant tout comptage.
  await page.locator('.rhdr').waitFor()

  // Au moins une des deux grilles vectorielles est rendue. #2-B : une région kind:'grid'
  // est désormais promue en diagramme INTERACTIF (ReaderChart), affichée
  // dans l'aperçu Prévisualiser (Lecteur en lecture seule, .rstep__chart) — la fiche elle-même
  // n'a plus d'aperçu inline. Une région kind:'reference' reste ancrée sous une instruction
  // (visible depuis un projet, hors de ce parcours) ou en galerie de la fiche patron. Les deux
  // issues restantes testées ici sont un succès : ce qui compte est qu'une grille existe et
  // soit rendue. On est déjà sur le lecteur (cf. clic ci-dessus) : compter directement.
  const charts = await page.locator('.rstep__chart .chart__canvas img').count()
  if (charts > 0) {
    await expect(page.locator('.rstep__chart .chart__canvas img').first()).toBeVisible()
    return
  }

  // Repli galerie : fiche patron (le nom dérivé du texte du PDF est « Pull Vector Test »).
  await page.goto('/library')
  await page.getByText('Pull Vector Test').first().click()
  await expect(page.locator('.pgal__cell img').first()).toBeVisible()
})

// Séparation fine, phase 2 — fixture `vector-multigrid.pdf` (voir
// tests/fixtures/make-multigrid-pdf.mjs) : DEUX grilles empilées reliées par un trait de
// liaison vertical (« pont ») qui enjambe la gouttière. C'est l'oracle du mécanisme de
// phase 2 : au niveau operator, `clusterPathBoxes` FUSIONNE tout en UNE SEULE région
// (le pont ponte la gouttière — asserté sans canvas dans pdf-vector-format.spec.js).
// Obtenir 2 images de diagramme en sortie du pipeline PROUVE donc que la rastérisation +
// projection de densité (`splitRegionRaster`, phase 2) a rescindé cette région unique en
// 2 grilles — l'operator seul n'en aurait donné qu'1. Ce parcours exerce le VRAI rendu
// canvas (Chromium ; Vitest/jsdom n'implémente pas `getContext('2d')` sans le paquet npm
// `canvas`, absent — cf. la note dans pdf-vector-format.spec.js), seul endroit qui peut
// prouver la séparation raster sur un PDF réel bout-en-bout.
test('import offline d’un PDF multi-grilles pontées : le raster sépare en 2 diagrammes (phase 2)', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })
  await page.goto('/library')
  // Le bouton biblio ouvre la feuille d'ajout (P2) ; le tap sur le label PDF
  // ouvre le sélecteur natif ; fournir le fichier à l'input caché déclenche la navigation
  // vers import-local et démarre l'import au montage.
  await openAddPatternSheet(page)
  await page.locator('.lib-import__input[accept*="pdf"]').setInputFiles(MULTIGRID_FIXTURE)
  // (#4) : plus d'écran de revue intermédiaire — il faut cliquer le bouton. Refonte du
  // bilan (lot du 23/09/2026) : ce fixture a des sections (les grilles promues), le bouton
  // principal du bloc de réussite est donc « Prévisualiser le patron », qui mène
  // directement au lecteur — plus de « Voir le patron » pour ce cas.
  await page.getByRole('button', { name: 'Prévisualiser le patron' }).click()
  await expect(page).toHaveURL(/\/pattern\/\d+\/read$/)
  // Fondu d'entrée des écrans : la vue montée par le routeur
  // n'existe dans le DOM qu'1-2 frames APRÈS la confirmation de navigation (<Transition
  // mode="out-in" démonte l'écran quitté avant de monter le suivant). Les `count()`
  // instantanés ci-dessous lisaient donc un DOM encore vide (0 image → faux échec) :
  // attendre le lecteur monté avant tout comptage — le fait observable, pas un délai
  // arbitraire (doctrine du dépôt, cf. document.fonts.ready dans responsive.spec.js).
  await page.locator('.rhdr').waitFor()

  // Les 2 diagrammes issus de la séparation raster peuvent atterrir dans l'aperçu
  // Prévisualiser (.rstep__chart, plus d'aperçu inline sur la fiche) et/ou en
  // galerie (associateImages) : on additionne les deux, ce qui compte étant le nombre
  // total d'images de diagramme produites, pas leur emplacement précis. Le seuil ≥2 est
  // la preuve de la séparation : l'operator seul (1 région) n'aurait produit qu'1 image ;
  // en obtenir 2 exige la phase 2. On est déjà sur le lecteur (cf. clic ci-dessus) :
  // compter directement.
  const charts = await page.locator('.rstep__chart .chart__canvas img').count()
  let gallery = 0
  if (charts < 2) {
    await page.goto('/library')
    await page.getByText('Pull test multi-grilles').first().click()
    await page.locator('.phdr').waitFor() // fiche montée (fondu d'entrée)
    gallery = await page.locator('.pgal__cell img').count()
  }

  expect(charts + gallery).toBeGreaterThanOrEqual(2)
})

// Affinage phase 2 — fixture `vector-title-multigrid.pdf` (voir
// tests/fixtures/make-vector-title-pdf.mjs) : mêmes DEUX grilles pontées que ci-dessus, mais
// la bande qui les sépare porte une ligne de TITRE texte (« Diagramme dos ») au lieu d'un
// blanc pur. Sans le masquage du texte avant la projection de densité (`maskTextData`), cette
// encre casse le blanc de la bande en deux barres trop courtes pour former une gouttière
// valide : la région entière (grille A + bande + grille B) resterait UNE SEULE cellule, soit
// 1 seul diagramme en sortie au lieu de 2 (vérifié par simulation fidèle à l'algorithme, cf.
// commentaire du générateur). Obtenir 2 images ici prouve donc que le masquage texte
// est bien câblé dans le vrai pipeline (pdfjs + rendu canvas Chromium), pas seulement que la
// séparation raster existe (déjà couvert par le test précédent, pont sans titre).
test('import offline d’un PDF multi-grilles pontées avec titre inter-grilles : le masquage texte préserve la séparation en 2 diagrammes (phase 2 affinée)', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })
  await page.goto('/library')
  // Le bouton biblio ouvre la feuille d'ajout (P2) ; le tap sur le label PDF
  // ouvre le sélecteur natif ; fournir le fichier à l'input caché déclenche la navigation
  // vers import-local et démarre l'import au montage.
  await openAddPatternSheet(page)
  await page.locator('.lib-import__input[accept*="pdf"]').setInputFiles(TITLE_MULTIGRID_FIXTURE)
  // (#4) : plus d'écran de revue intermédiaire — il faut cliquer le bouton. Refonte du
  // bilan (lot du 23/09/2026) : ce fixture a des sections (les grilles promues), le bouton
  // principal du bloc de réussite est donc « Prévisualiser le patron », qui mène
  // directement au lecteur — plus de « Voir le patron » pour ce cas.
  await page.getByRole('button', { name: 'Prévisualiser le patron' }).click()
  await expect(page).toHaveURL(/\/pattern\/\d+\/read$/)
  await page.locator('.rhdr').waitFor() // lecteur monté (fondu d'entrée — cf. 1er test)

  // Même logique de comptage (aperçu Prévisualiser + galerie) que le test pont sans titre
  // ci-dessus : ce qui compte est le nombre total d'images de diagramme produites par le
  // pipeline complet. Les diagrammes interactifs promus (ReaderChart) sont
  // comptés dans l'aperçu Prévisualiser (.rstep__chart, plus d'aperçu inline sur la fiche) ;
  // galerie en repli seulement. On est déjà sur le lecteur (cf. clic ci-dessus) : compter
  // directement.
  const charts = await page.locator('.rstep__chart .chart__canvas img').count()
  let gallery = 0
  if (charts < 2) {
    await page.goto('/library')
    await page.getByText('Pull titre inter grilles').first().click()
    await page.locator('.phdr').waitFor() // fiche montée (fondu d'entrée)
    gallery = await page.locator('.pgal__cell img').count()
  }

  expect(charts + gallery).toBeGreaterThanOrEqual(2)
})
