// @vitest-environment jsdom
// tests/unit/pdf-vector-format.spec.js
import { describe, it, expect } from 'vitest'
import { getDocument, GlobalWorkerOptions, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { collectPathBoxes } from '@/utils/pdf'
import { clusterPathBoxes } from '@/utils/pdf-import/vector-regions'

// `@/utils/pdf` importe ce MÊME module et pose `GlobalWorkerOptions.workerSrc` sur l'URL
// `?url` de Vite, qui sous Vitest (Node) n'est pas un module chargeable : `getDocument()`
// échouerait (« Setting up fake worker failed »). Même singleton ES, donc on écrase
// `workerSrc` avec un `file://` résolu par Node.
GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs')

// Pas de `new URL('...', import.meta.url)` : sous Vitest, Vite l'intercepte statiquement
// comme référence d'asset et le résout contre le dev-server (ERR_INVALID_URL_SCHEME).
const __dirname = dirname(fileURLToPath(import.meta.url))
const pdfPath = resolve(__dirname, '../fixtures/vector-grid.pdf')

describe('format constructPath (pdfjs 6.1.200)', () => {
  it('expose minMax = [minX,minY,maxX,maxY] TRIÉ (pas l\'ordre brut du tracé) par tracé', async () => {
    const data = new Uint8Array(readFileSync(pdfPath))
    const doc = await getDocument({ data, disableWorker: true }).promise
    const page = await doc.getPage(1)
    const ops = await page.getOperatorList()

    // On choisit un constructPath dont les Y BRUTS (args[1] : sous-tracés, Float32Array plats
    // de triplets [opCode, x, y]) sont DESCENDANTS, par exemple un trait vertical tracé de haut
    // en bas : si `minMax` recopiait l'ordre brut au lieu de trier, minY < maxY échouerait.
    // Recherche dans le fichier, pas d'index magique.
    let found = null
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] !== OPS.constructPath) continue
      const args = ops.argsArray[i]
      // Premier point du premier sous-tracé et dernier point du dernier, pour couvrir aussi
      // les tracés multi-segments.
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

    // Le brut est bien descendant sur Y (sinon le tracé choisi ne prouverait rien) ...
    expect(rawYFirst).toBeGreaterThan(rawYLast)
    // ... mais minMax est trié ascendant et non dégénéré : pdfjs trie.
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

// Fixture multi-grilles (tests/fixtures/make-multigrid-pdf.mjs) : deux grilles empilées,
// séparées par une gouttière blanche mais reliées par un trait vertical (le « pont »). Au
// niveau des tracés, `clusterPathBoxes` les FUSIONNE en une région : c'est la PRÉMISSE que la
// séparation raster (`splitRegionRaster`) doit défaire. La conclusion (2 grilles) exige un
// vrai canvas 2D, absent de jsdom : elle est portée par tests/e2e/import-pdf-vector.spec.js,
// et le mécanisme par pdf-import-vector-regions.spec.js.
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
    // Le pont enjambe la gouttière : une seule région englobe les deux grilles.
    expect(regions).toHaveLength(1)
    // La région unique couvre bien les deux grilles empilées (haut ET bas) : sa hauteur
    // enjambe la gouttière blanche (grille haute ≈ y 562-688, grille basse ≈ y 262-388).
    expect(regions[0].y0).toBeLessThan(400) // atteint la grille basse
    expect(regions[0].y1).toBeGreaterThan(560) // atteint la grille haute
  })
})

// Page DENSE avec un fond quasi pleine-page, plusieurs grilles et des tracés hors page : le
// fond agglomérait tout et donnait 0 région sur l'appareil. Une fixture sans fond ne
// reproduisait pas le défaut.
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
    // Le pré-filtre par tracé écarte le fond : les 3 grilles ressortent, aucune pleine-page.
    expect(regions).toHaveLength(3)
    for (const r of regions) {
      expect((r.x1 - r.x0) * (r.y1 - r.y0)).toBeLessThan(0.9 * pageArea[1])
    }
  })
})
