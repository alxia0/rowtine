// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'

// Deuxième passe de revue (rowtine-mvm) : PXOPTS (gapMin/minLen, cf. splitRegionGuarded) doit
// être dérivé de l'échelle EFFECTIVE de rendu de CHAQUE page (rendered.viewport.scale), pas
// d'une constante nominale (`scale = 2`) — sinon une page dont l'échelle a été réduite par
// clampRenderScale (page grand format au-delà de RENDER_MAX_DIM) verrait ses gouttières
// mesurées avec des seuils calibrés pour des pixels 4× plus grands qu'ils ne le sont réellement,
// et une vraie gouttière entre deux grilles ne serait plus reconnue → grilles fusionnées à tort.
//
// Contrairement à pdf-vector-mask-wiring.spec.js (qui passe par le raccourci de test
// `opts.__testSingleRegion`, un chemin PARALLÈLE qui n'exerce pas la boucle `byPage` de
// production), ce test passe par le VRAI chemin de production : `getDocument`/`getOperatorList`
// mockés pour produire une région via `collectPathBoxes`/`clusterPathBoxes`, puis
// `renderPageCanvas` court-circuité par `__renderPageStub` (mécanisme déjà prévu par le code de
// production pour la testabilité) pour fournir un rendu factice AVEC une échelle effective
// différente du `scale` nominal.

// Une seule page. 12 boîtes de tracés (constructPath) empilées verticalement, espacées de 18pt
// (< gap de clustering, 24pt par défaut) et larges de 160pt : elles fusionnent en UNE région
// operator-list de x:[0,160], y:[0,222] (minW≥150, minH≥40, count≥8 — cf. DEFAULTS de
// clusterPathBoxes). `argsArray[i][2]` = minMax [minX,minY,maxX,maxY] lu par collectPathBoxes ;
// OPS ne définit que `constructPath`, donc aucune transformation CTM n'entre en jeu (identité).
const { OPS, page1 } = vi.hoisted(() => {
  const OPS = { constructPath: 1 }
  const boxYs = [0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200, 220]
  const fnArray = boxYs.map(() => OPS.constructPath)
  const argsArray = boxYs.map((y) => [null, null, [0, y, 160, y + 2]])
  const page1 = {
    view: [0, 0, 200, 250],
    getOperatorList: vi.fn().mockResolvedValue({ fnArray, argsArray }),
  }
  return { OPS, page1 }
})
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {},
  OPS,
  getDocument: () => ({ promise: Promise.resolve({ numPages: 1, getPage: () => Promise.resolve(page1) }), destroy: async () => {} }),
}))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

import { extractVectorRegions } from '@/utils/pdf'

// Rendu factice : treillis dense (grille) sur y∈[0,90) et y∈[110,222), séparés par une
// gouttière BLANCHE de 20px (y∈[90,110)) — sur toute la largeur x∈[0,160). `viewport.scale`
// simule l'échelle EFFECTIVE après plafonnement par clampRenderScale (potentiellement
// différente du `scale` nominal 2 passé à renderPageCanvas).
function fakeRenderedAtScale(effectiveScale) {
  const w = 200, h = 250
  const data = new Uint8ClampedArray(w * h * 4).fill(255)
  const ink = (x, y) => { data[(y * w + x) * 4] = 0 }
  const lattice = (y0, y1) => {
    for (let y = y0; y < y1; y += 4) for (let x = 0; x < 160; x++) ink(x, y)
    for (let x = 0; x < 160; x += 4) for (let y = y0; y < y1; y++) ink(x, y)
  }
  lattice(0, 90)   // grille haute
  lattice(110, 222) // grille basse — gouttière blanche de 20px entre les deux (y 90..109)
  const viewport = {
    width: w, height: h, scale: effectiveScale,
    convertToViewportPoint: (x, y) => [x, y],
    convertToPdfPoint: (x, y) => [x, y],
  }
  return { canvas: {}, viewport, data, width: w, height: h }
}

const FILE = { arrayBuffer: async () => new ArrayBuffer(8) }

afterEach(() => {
  delete globalThis.__renderPageStub
  delete globalThis.__pageTextBoxesStub
  delete globalThis.__cropCanvasStub
})

describe('extractVectorRegions — PXOPTS suit l’échelle EFFECTIVE de rendu (page plafonnée)', () => {
  it("page rendue à une échelle RÉDUITE (0.5, simulant un plafonnement) : la gouttière de 20px est quand même détectée → 2 régions kind:grid", async () => {
    // À l'échelle effective 0.5 : gapMin = round(24*0.5) = 12px, minLen = round(40*0.5) = 20px.
    // La gouttière (20px) ≥ gapMin (12px) → reconnue → split en 2 bandes, chacune ≥ minLen (20px).
    globalThis.__renderPageStub = () => fakeRenderedAtScale(0.5)
    globalThis.__pageTextBoxesStub = () => []
    let cropCount = 0
    globalThis.__cropCanvasStub = () => `data:image/jpeg;base64,X${cropCount++}`
    const out = await extractVectorRegions(FILE)
    expect(out.length).toBe(2)
    expect(out.every((r) => r.kind === 'grid')).toBe(true)
  })

  it('page rendue à l’échelle NOMINALE (2, page normale, non plafonnée) : gouttière de 20px NON reconnue à cette échelle → 1 région fusionnée (comportement historique inchangé)', async () => {
    // À l'échelle effective 2 (comportement historique, PDF dans les bornes normales) :
    // gapMin = 48px. Notre gouttière synthétique de 20px ne serait PAS reconnue à cette échelle
    // (comportement attendu : à scale=2, une gouttière réelle mesurerait ~2× plus de pixels) —
    // ce test documente juste que la voie « non plafonnée » garde le calcul historique
    // (gapMin dérivé du scale RÉEL, ici bien 2 puisqu'aucun plafonnement n'a eu lieu).
    globalThis.__renderPageStub = () => fakeRenderedAtScale(2)
    globalThis.__pageTextBoxesStub = () => []
    globalThis.__cropCanvasStub = () => 'data:image/jpeg;base64,X'
    const out = await extractVectorRegions(FILE)
    expect(out.length).toBe(1) // gouttière non reconnue à cette échelle : 1 bloc fusionné
  })
})
