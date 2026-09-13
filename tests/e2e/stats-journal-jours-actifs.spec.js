// e2e — un rang coché dans le suivi, SANS aucune séance chronométrée, doit allonger la série de
// l'écran Statistiques (§7ter). Aucun test unitaire ne traverse la chaîne complète :
// geste réel → journal en IndexedDB → union → tuile affichée. C'est aussi la seule preuve
// automatisée que le journal n'invente AUCUNE durée (la case du jour reste au niveau 0).
import { test, expect } from '@playwright/test'
import { completeOnboarding, openDemoReaderWithChart } from './helpers.js'

test('un rang coché sans séance fait apparaître une série de 1 jour, sans durée', async ({ page }) => {
  await completeOnboarding(page)

  // 1. AVANT : aucune séance, aucun geste ⇒ l'écran Statistiques est à son état vide.
  //    ⚠️ Cette assertion épingle AUSSI que le semis d'exemples n'écrit ni séance ni ligne de
  //    journal (garde déjà en place) : si elle rougit un jour, c'est le semis qui a changé.
  await page.goto('/stats')
  await expect(page.locator('[data-stat="streak"]')).toHaveCount(0)

  // 2. Entrer dans le suivi d'un projet et cocher le premier rang. `.rcheck` est le bouton
  //    role="checkbox" de chaque rang (ReaderView.vue:796-802) ; le cocher appelle
  //    `toggleDone` → `persist({ worked: true })` → `writeSnap(..., true)`, le site 4.
  await openDemoReaderWithChart(page)
  const premierRang = page.locator('.rcheck').first()
  await premierRang.click()
  await expect(premierRang).toHaveAttribute('aria-checked', 'true')

  // ⚠️ `toggleDone` lance `persist()` SANS l'attendre (chaîne `persistChain`, ReaderView.vue:311) :
  // `page.goto` détruit le contexte JS et peut perdre l'écriture IndexedDB avant son commit.
  // Mesuré le 11/08 (revue) : sans cette attente, le test échoue 8 fois sur 9 hors
  // contention (il ne passait que grâce à la charge de la campagne complète) — un signal qui
  // s'évapore dès qu'on le lance seul, la même classe de piège que le port 5173 sur ce projet.
  // On sonde la base jusqu'à ce que la ligne du journal ait RÉELLEMENT atterri, plutôt qu'un
  // `waitForTimeout` (délai arbitraire, jamais déterministe).
  await expect
    .poll(() => page.evaluate(() => new Promise((resolve) => {
      const q = indexedDB.open('rowtine')
      q.onsuccess = () => {
        const c = q.result.transaction('activeDays').objectStore('activeDays').count()
        c.onsuccess = () => resolve(c.result)
        c.onerror = () => resolve(-1)
      }
      q.onerror = () => resolve(-1)
    })))
    .toBe(1)

  // 3. APRÈS : la série et les jours actifs comptent ce jour, alors qu'AUCUNE séance n'existe.
  await page.goto('/stats')
  await expect(page.locator('[data-stat="streak"]')).toContainText('1')
  await expect(page.locator('[data-stat="activeDays"]')).toContainText('1')
  // Le total de temps reste un tiret : le journal ne connaît aucune durée. Sans cette
  // assertion, le test passerait aussi si le journal inventait une durée quelconque.
  await expect(page.locator('[data-stat="total"]')).toContainText('—')

  // 4. Et la case d'aujourd'hui dans la grille reste au NIVEAU 0 — la grille mesure le TEMPS.
  //    Les deux affirmations doivent coexister à l'écran sans se contredire.
  //    ⚠️ Point d'attention : `:not(.hm__cell--future)` est nécessaire — la semaine en cours
  //    (fenêtre partielle) porte TOUJOURS des jours futurs, rendus ABSENTS et non « l0 »
  //    (buildGrid, src/utils/stats-grid.js). Sans cette exclusion, l'assertion échouerait à
  //    chaque exécution — un défaut de l'assertion elle-même, pas du comportement testé.
  const cases = page.locator('.hm__cols .hm__cell')
  await expect(cases.first()).toBeVisible()
  const niveauxNonNuls = await page.locator('.hm__cols .hm__cell:not(.hm__cell--l0):not(.hm__cell--future)').count()
  expect(niveauxNonNuls).toBe(0)
})
