// tests/unit/pdf-vector-format.spec.js
import { describe, it, expect } from 'vitest'
import { getDocument, GlobalWorkerOptions, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { collectPathBoxes } from '@/utils/pdf'
import { clusterPathBoxes } from '@/utils/pdf-import/vector-regions'

// `@/utils/pdf` importe ce MÊME module (`pdfjs-dist/legacy/build/pdf.mjs`) et pose, à son
// chargement, `GlobalWorkerOptions.workerSrc` sur l'URL que Vite calcule pour le navigateur
// (`?url`) — sous Vitest (Node), cette URL est un chemin relatif au serveur de dev
// (`/node_modules/...`), pas un module chargeable, et `getDocument()` ci-dessous échouerait
// avec « Setting up fake worker failed ». Les deux imports partagent le même singleton ES
// (même spécificateur) : on écrase donc explicitement `workerSrc` avec un `file://` valide,
// résolu par Node lui-même plutôt que par Vite (cf. commentaire `__dirname` ci-dessous pour
// la même prudence vis-à-vis de l'analyse statique de Vite sous Vitest).
GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs')

// NB : on évite `new URL('...', import.meta.url)` ici — sous Vitest (pool jsdom),
// Vite intercepte statiquement ce pattern précis comme référence d'asset et le
// résout contre l'origine du dev-server (http://localhost:3000/...) au lieu du
// vrai chemin fichier, faisant échouer `fileURLToPath` avec ERR_INVALID_URL_SCHEME.
// `dirname(fileURLToPath(import.meta.url)) + resolve` n'est pas reconnu par cette
// analyse statique et résout correctement en file://.
const __dirname = dirname(fileURLToPath(import.meta.url))
const pdfPath = resolve(__dirname, '../fixtures/vector-grid.pdf')

describe('format constructPath (pdfjs 6.1.200)', () => {
  it('expose minMax = [minX,minY,maxX,maxY] TRIÉ (pas l\'ordre brut du tracé) par tracé', async () => {
    const data = new Uint8Array(readFileSync(pdfPath))
    const doc = await getDocument({ data, disableWorker: true }).promise
    const page = await doc.getPage(1)
    const ops = await page.getOperatorList()

    // On sélectionne un constructPath dont les coordonnées BRUTES (args[1] =
    // tableau de sous-tracés, chacun un Float32Array plat de triplets
    // [opCode, x, y]) sont en ordre DESCENDANT sur l'axe Y — ex. un trait
    // vertical tracé de haut en bas. Un tel tracé rend
    // le test discriminant : si `minMax` recopiait l'ordre brut du tracé
    // (minY = y du premier point, maxY = y du dernier point) au lieu de trier,
    // l'assertion minY < maxY échouerait. `vector-grid.pdf` contient de tels
    // traits verticaux parmi ses constructPath (recherche robuste, pas d'index
    // magique).
    let found = null
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] !== OPS.constructPath) continue
      const args = ops.argsArray[i]
      // args[1] est un tableau de sous-tracés, chacun un Float32Array plat
      // de triplets [opCode, x, y]. On prend le 1er point du 1er sous-tracé
      // et le dernier point du dernier sous-tracé pour couvrir aussi les
      // tracés multi-segments.
      const subpaths = args[1]
      const firstSub = subpaths[0]
      const lastSub = subpaths[subpaths.length - 1]
      const rawYFirst = firstSub[2]
      const rawYLast = lastSub[lastSub.length - 1]
      if (rawYFirst > rawYLast) {
        found = { args, rawYFirst, rawYLast }
        break
      }
    }
    expect(found).not.toBeNull()

    const { args, rawYFirst, rawYLast } = found
    expect(args).toHaveLength(3)
    const minMax = args[2]
    expect(Array.from(minMax)).toHaveLength(4)

    // Le brut est bien descendant sur Y (sinon le tracé sélectionné ne
    // prouverait rien) ...
    expect(rawYFirst).toBeGreaterThan(rawYLast)
    // ... mais minMax doit malgré tout être trié ascendant, et non dégénéré
    // (min ≠ max sur l'axe Y) : preuve que pdfjs trie plutôt que de recopier
    // l'ordre brut du tracé.
    expect(minMax[1]).toBeLessThan(minMax[3])
    expect(minMax[0]).toBeLessThanOrEqual(minMax[2]) // minX ≤ maxX (structure)
  })

  it('collectPathBoxes rend des boîtes plausibles pour la grille', async () => {
    const data = new Uint8Array(readFileSync(pdfPath))
    const doc = await getDocument({ data, disableWorker: true }).promise
    const page = await doc.getPage(1)
    const ops = await page.getOperatorList()
    const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const boxes = collectPathBoxes(ops, OPS)
    expect(boxes.length).toBeGreaterThan(0)
    for (const b of boxes) {
      expect(b.x0).toBeLessThanOrEqual(b.x1)
      expect(b.y0).toBeLessThanOrEqual(b.y1)
    }
  })
})

// Fixture multi-grilles (voir tests/fixtures/make-multigrid-pdf.mjs) — DEUX
// grilles empilées, séparées par une gouttière blanche, mais RELIÉES par un trait de
// liaison vertical (le « pont ») qui enjambe la gouttière. Ce test capture l'état
// « AVANT » de la séparation fine : au niveau des boîtes de tracés (operator, phase 1),
// `clusterPathBoxes` FUSIONNE tout en 1 seule région parce que le pont ponte la
// gouttière. C'est précisément ce que la phase 2 (`splitRegionRaster`, projection de
// densité d'encre sur le rendu raster) doit rescinder en 2 grilles distinctes.
//
// Ce test est sans canvas (pdfjs lit juste la liste d'opérateurs) : il prouve la
// PRÉMISSE (1 région operator), pas la conclusion (2 grilles après raster). Reproduire
// la séparation raster sur le VRAI rendu de cette fixture est IMPRATICABLE sous Vitest :
// jsdom n'implémente pas `HTMLCanvasElement.getContext('2d')` sans le paquet npm `canvas`
// (absent du projet — vérifié : l'appel retourne `undefined` avec un warning « Not
// implemented »). La preuve que le raster sépare bien cette région unique en 2 diagrammes
// est donc portée bout-en-bout par l'e2e (`tests/e2e/import-pdf-vector.spec.js`, seul
// environnement ici avec un vrai canvas 2D) ; le mécanisme Y-puis-X générique est en
// outre couvert par le buffer synthétique de `tests/unit/pdf-import-vector-regions.spec.js`
// (« sépare 2 bandes Y dont une en 2 colonnes X → 3 cellules »).
describe('détection multi-grilles sur PDF réel (fixture vector-multigrid.pdf)', () => {
  const multigridPath = resolve(__dirname, '../fixtures/vector-multigrid.pdf')
  it('clusterPathBoxes fusionne les 2 grilles pontées en 1 région (prémisse de la phase 2)', async () => {
    const data = new Uint8Array(readFileSync(multigridPath))
    const doc = await getDocument({ data, disableWorker: true }).promise
    const page = await doc.getPage(1)
    const view = page.view
    const pageArea = { 1: (view[2] - view[0]) * (view[3] - view[1]) }
    const boxes = collectPathBoxes(await page.getOperatorList(), OPS).map((b) => ({ page: 1, ...b }))
    const regions = clusterPathBoxes(boxes, { pageArea })
    // Le pont vertical enjambe la gouttière → une seule région operator engloble les
    // deux grilles. C'est l'état « AVANT » que la séparation fine (raster) doit défaire.
    expect(regions).toHaveLength(1)
    // La région unique couvre bien les deux grilles empilées (haut ET bas) : sa hauteur
    // enjambe la gouttière blanche (grille haute ≈ y 562-688, grille basse ≈ y 262-388).
    expect(regions[0].y0).toBeLessThan(400) // atteint la grille basse
    expect(regions[0].y1).toBeGreaterThan(560) // atteint la grille haute
  })
})

// Oracle représentatif du bug device Phildar : une page DENSE avec un fond quasi
// pleine-page + plusieurs grilles + des tracés hors-page. La fixture minimale d'origine
// (2 grilles, sans fond) ne pouvait PAS reproduire l'agglomération → les tests passaient
// alors que le vrai cas donnait 0 région. Ce test charge un PDF qui reproduit l'échec.
describe('détection régions sur page dense (régression bug Phildar : 0 région)', () => {
  const densePath = resolve(__dirname, '../fixtures/vector-dense-page.pdf')
  it('extrait ≥ 2 régions in-page malgré un fond pleine-page', async () => {
    const data = new Uint8Array(readFileSync(densePath))
    const doc = await getDocument({ data, disableWorker: true }).promise
    const page = await doc.getPage(1)
    const view = page.view
    const pageArea = { 1: (view[2] - view[0]) * (view[3] - view[1]) }
    const boxes = collectPathBoxes(await page.getOperatorList(), OPS).map((b) => ({ page: 1, ...b }))
    const regions = clusterPathBoxes(boxes, { pageArea })
    // Avant le pré-filtre par tracé : 0 région (le fond agglomère tout, cluster
    // pleine-page rejeté). Après : les 3 grilles ressortent, aucune n'est pleine-page.
    expect(regions).toHaveLength(3)
    for (const r of regions) {
      expect((r.x1 - r.x0) * (r.y1 - r.y0)).toBeLessThan(0.9 * pageArea[1])
    }
  })
})
