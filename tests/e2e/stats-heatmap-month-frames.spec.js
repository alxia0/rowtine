// e2e — les rectangles de mois (StatsHeatmap.vue) doivent COÏNCIDER avec les colonnes
// qu'ils encadrent. jsdom (tests/unit/stats-heatmap.spec.js) ne calcule aucune disposition
// réelle : `getBoundingClientRect()` y vaut toujours zéro, donc un défaut de GÉOMÉTRIE ne peut
// être prouvé qu'en vrai navigateur — c'est le sens même de ce fichier.
//
// Défaut trouvé par la revue du 11/08 : `.hm__col` n'a AUCUNE largeur fixée (StatsHeatmap.vue),
// elle est dimensionnée par son contenu — dont l'étiquette de mois (`white-space: nowrap`).
// Une étiquette plus large que 20 px élargit sa colonne, ce qu'une formule arithmétique
// (`left = index × 22`) ignore : l'écart se cumule colonne après colonne. Corrigé en mesurant
// les VRAIES coordonnées DOM des colonnes plutôt qu'en les supposant.
import { test, expect } from '@playwright/test'
import { completeOnboarding, seedHeatmapSessions } from './helpers.js'

// Reconstitue les groupes de colonnes par mois à partir du DOM affiché — un début de groupe
// est une colonne dont `.hm__month` porte un texte non vide, EXACTEMENT le critère que
// `col.monthStart` encode côté app (StatsHeatmap.vue : `{{ col.monthStart ? monthLabel(...) : '' }}`).
// Reconstruit ici plutôt qu'importé : ce test mesure ce que la PAGE affiche, pas ce que le
// module interne calcule — sinon une régression dans `monthGroups()` ET dans ce test à la
// fois (improbable, mais c'est la garantie qu'on veut) pourrait se dissimuler l'une l'autre.
function mesurerEcarts() {
  return document.evaluate // no-op placeholder to keep linters quiet about unused import style
    ? (() => {
        const cols = [...document.querySelectorAll('.hm__cols > .hm__col')]
        const frames = [...document.querySelectorAll('.hm__cols > .hm__month-frame')]
        const groupes = []
        cols.forEach((col, i) => {
          const label = col.querySelector('.hm__month')?.textContent.trim()
          if (label || i === 0) groupes.push({ start: i, count: 0 })
          groupes[groupes.length - 1].count += 1
        })
        return groupes.map((g, gi) => {
          const premiere = cols[g.start].getBoundingClientRect()
          const derniere = cols[g.start + g.count - 1].getBoundingClientRect()
          const cadre = frames[gi]?.getBoundingClientRect()
          return {
            groupe: gi,
            colonnes: g.count,
            ecartGauche: cadre ? Math.abs(cadre.left - premiere.left) : Infinity,
            ecartDroite: cadre ? Math.abs(cadre.right - derniere.right) : Infinity,
          }
        })
      })()
    : null
}

async function ecartsPourFenetre(page, libelle) {
  await page.getByRole('button', { name: libelle, exact: true }).click()
  await expect(page.locator('.hm__month-frame').first()).toBeVisible()
  // Un `nextTick`/réancrage peut suivre le clic (cf. StatsHeatmap.vue) : on laisse la mise en
  // page se stabiliser avant de mesurer, sans quoi on mesurerait parfois une disposition
  // encore en transition (source de flaky, indépendante du défaut visé ici).
  await page.waitForTimeout(50)
  return page.evaluate(mesurerEcarts)
}

test('les rectangles de mois coïncident avec leurs colonnes — Année (53 colonnes)', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  await seedHeatmapSessions(page)
  await page.goto('/stats')

  const ecarts = await ecartsPourFenetre(page, 'Année')
  // Au moins une dizaine de groupes de mois sur 53 colonnes/~13 mois — sinon la mesure ne
  // porte sur rien (garde anti-vacuité : un tableau vide passerait `every()` par défaut).
  expect(ecarts.length).toBeGreaterThan(10)
  console.log('[mois/Année] écarts mesurés :', JSON.stringify(ecarts))
  for (const e of ecarts) {
    expect(e.ecartGauche, `groupe ${e.groupe} (${e.colonnes} colonnes) — bord gauche`).toBeLessThanOrEqual(1)
    expect(e.ecartDroite, `groupe ${e.groupe} (${e.colonnes} colonnes) — bord droit`).toBeLessThanOrEqual(1)
  }
})

test('les rectangles de mois coïncident avec leurs colonnes — Semestre (26 colonnes)', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  await seedHeatmapSessions(page)
  await page.goto('/stats')

  const ecarts = await ecartsPourFenetre(page, 'Semestre')
  expect(ecarts.length).toBeGreaterThan(4)
  console.log('[mois/Semestre] écarts mesurés :', JSON.stringify(ecarts))
  for (const e of ecarts) {
    expect(e.ecartGauche, `groupe ${e.groupe} (${e.colonnes} colonnes) — bord gauche`).toBeLessThanOrEqual(1)
    expect(e.ecartDroite, `groupe ${e.groupe} (${e.colonnes} colonnes) — bord droit`).toBeLessThanOrEqual(1)
  }
})

// Trimestre (13 colonnes, non scrollable) : la revue l'a mesuré déjà correct (0-1 px). Gardé
// ici comme TÉMOIN — si un correctif futur casse ce cas simple pendant qu'il corrige les
// grandes fenêtres, ce test-là doit le voir.
test('les rectangles de mois coïncident avec leurs colonnes — Trimestre (13 colonnes, témoin)', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  await seedHeatmapSessions(page)
  await page.goto('/stats')

  // ⚠️ ATTENDRE que les rectangles soient rendus avant de mesurer, comme le font les deux tests
  // ci-dessus via `ecartsPourFenetre`. Sans cette attente, `mesurerEcarts` rendait un tableau
  // VIDE (mesuré : `ecarts.length === 0`) parce que la grille n'était pas encore montée — et
  // c'est précisément la garde anti-vacuité `toBeGreaterThan(2)` qui l'a révélé, plutôt qu'un
  // `every()` sur un tableau vide qui aurait passé en ne prouvant rien.
  // Trimestre étant la fenêtre PAR DÉFAUT, il n'y a aucun bouton à cliquer ici : on attend
  // seulement le rendu.
  await expect(page.locator('.hm__month-frame').first()).toBeVisible()
  await page.waitForTimeout(50)

  const ecarts = await page.evaluate(mesurerEcarts)
  expect(ecarts.length).toBeGreaterThan(2)
  console.log('[mois/Trimestre] écarts mesurés :', JSON.stringify(ecarts))
  for (const e of ecarts) {
    expect(e.ecartGauche, `groupe ${e.groupe} (${e.colonnes} colonnes) — bord gauche`).toBeLessThanOrEqual(1)
    expect(e.ecartDroite, `groupe ${e.groupe} (${e.colonnes} colonnes) — bord droit`).toBeLessThanOrEqual(1)
  }
})
