import { describe, it, expect, afterEach, vi } from 'vitest'

// Le vrai pdfjs-dist plante à l'import en jsdom (DOMMatrix absent) ; on le mocke comme les
// autres tests unitaires de @/utils/pdf (pdf-mask-text, pdf-display-size, pdf-resolve-image-obj).
// __testSingleRegion court-circuite le chemin réel (getDocument/OPS jamais appelés) donc un
// mock minimal suffit.
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ GlobalWorkerOptions: {}, OPS: {} }))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

import { extractVectorRegions } from '@/utils/pdf'

// Trace un treillis (lignes horiz + vert espacées de 4px) dans `data` (RGBA plat, largeur w),
// borné à [x0,x1)×[y0,y1). Réutilisé pour bâtir un rendu factice (grille dense = kind grid attendu).
function makeLattice(data, w, x0, x1, y0, y1) {
  const ink = (x, y) => { data[(y * w + x) * 4] = 0 }
  for (let y = y0; y < y1; y += 4) for (let x = x0; x < x1; x++) ink(x, y)
  for (let x = x0; x < x1; x += 4) for (let y = y0; y < y1; y++) ink(x, y)
}

// Canvas factice : cropCanvas fait document.createElement('canvas') + drawImage ; en jsdom on
// se contente d'un stub qui renvoie une dataURL non vide (le contenu pixel du crop n'est pas testé ici).
function fakeRendered() {
  const scale = 2
  const w = 120, h = 200
  const data = new Uint8ClampedArray(w * h * 4).fill(255)
  const ink = (x, y) => { data[(y * w + x) * 4] = 0 }
  makeLattice(data, w, 8, 112, 16, 72)   // grille haute
  makeLattice(data, w, 8, 112, 128, 184) // grille basse
  // « texte » de titre dans la gouttière (y ~90-104, pleine largeur) : ponte la projection sans masquage
  for (let y = 90; y < 104; y++) for (let x = 10; x < 110; x++) ink(x, y)
  const viewport = {
    width: w, height: h, scale,
    convertToViewportPoint: (x, y) => [x, y],
    convertToPdfPoint: (x, y) => [x, y],
  }
  return { canvas: {}, viewport, data, width: w, height: h }
}

// Rendu factice : UN SEUL treillis dense couvrant tout le canvas (pas de gouttière) → 1 région,
// et un nombre de lignes/colonnes largement au-dessus du seuil structurel (classifyGridStrict.strong).
function denseLatticeRendered() {
  const scale = 2
  const w = 120, h = 200
  const data = new Uint8ClampedArray(w * h * 4).fill(255)
  makeLattice(data, w, 8, 112, 8, 192)
  const viewport = {
    width: w, height: h, scale,
    convertToViewportPoint: (x, y) => [x, y],
    convertToPdfPoint: (x, y) => [x, y],
  }
  return { canvas: {}, viewport, data, width: w, height: h }
}

// Rendu factice « quasi vide » : seulement 3 lignes horizontales + 3 colonnes verticales
// isolées (comme un cadre/QR/photo). Assez pour l'ancien seuil lâche d'isGridCell
// (minLines:3, lineCov:0.4, utilisé pour le DÉCOUPAGE) mais loin du seuil structurel de
// classifyGridStrict (regMin:10, utilisé pour le KIND final) → ne doit PAS être classé grille.
function quasiEmptyRendered() {
  const scale = 2
  const w = 120, h = 200
  const data = new Uint8ClampedArray(w * h * 4).fill(255)
  const ink = (x, y) => { data[(y * w + x) * 4] = 0 }
  for (const y of [40, 100, 160]) for (let x = 10; x < 110; x++) ink(x, y)
  for (const x of [20, 60, 100]) for (let y = 10; y < 190; y++) ink(x, y)
  const viewport = {
    width: w, height: h, scale,
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

// LIMITE DE COUVERTURE : ce test passe par le garde `opts.__testSingleRegion` de extractVectorRegions,
// qui est un chemin PARALLÈLE (mêmes étapes masquage→split→kind) et n'exerce PAS la vraie boucle
// `byPage` de production. Il ne détecterait donc pas une régression du câblage principal (ex. si l'appel
// de production repassait de `measureData` à `rendered.data`). La voie de PRODUCTION est exercée
// bout-en-bout par l'oracle desktop `tools/oracle-vector-desktop.mjs` sur le vrai Phildar.
describe('extractVectorRegions — mesure texte-masquée', () => {
  it('sans bboxes texte : le titre ponte → 1 région (comportement actuel)', async () => {
    globalThis.__renderPageStub = () => fakeRendered()
    globalThis.__pageTextBoxesStub = () => []
    globalThis.__cropCanvasStub = () => 'data:image/jpeg;base64,X'
    // 1 page, 1 région pleine (on force via un opts qui n'exclut rien) : on s'appuie sur le stub de rendu.
    const out = await extractVectorRegions(FILE, null, { __testSingleRegion: true })
    expect(out.length).toBe(1)
  })

  it('avec la bbox du titre masquée : la gouttière réapparaît → 2 régions kind:grid', async () => {
    globalThis.__renderPageStub = () => fakeRendered()
    globalThis.__pageTextBoxesStub = () => [{ x0: 0, y0: 88, x1: 120, y1: 106 }] // masque le titre
    globalThis.__cropCanvasStub = () => 'data:image/jpeg;base64,X'
    const out = await extractVectorRegions(FILE, null, { __testSingleRegion: true })
    expect(out.length).toBe(2)
    expect(out.every((r) => r.kind === 'grid')).toBe(true)
  })
})

// D — le `kind` final doit venir de classifyGridStrict (classifieur STRUCTUREL), pas du
// drapeau `cell.grid` d'isGridCell (seuils lâches, servent seulement à DÉCOUPER les régions).
// C'est le fix des faux positifs Bonnet (QR/photo pris pour des grilles par l'ancien seuil lâche).
describe('extractVectorRegions — kind vient du classifieur strict (D)', () => {
  it('treillis dense (grille réelle) → kind:grid', async () => {
    globalThis.__renderPageStub = () => denseLatticeRendered()
    globalThis.__pageTextBoxesStub = () => []
    globalThis.__cropCanvasStub = () => 'data:image/jpeg;base64,X'
    const out = await extractVectorRegions(FILE, null, { __testSingleRegion: true })
    expect(out.length).toBe(1)
    expect(out[0].kind).toBe('grid')
  })

  it('quasi vide (peu de lignes, ex. QR/photo) → kind:reference malgré le drapeau isGridCell lâche', async () => {
    globalThis.__renderPageStub = () => quasiEmptyRendered()
    globalThis.__pageTextBoxesStub = () => []
    globalThis.__cropCanvasStub = () => 'data:image/jpeg;base64,X'
    const out = await extractVectorRegions(FILE, null, { __testSingleRegion: true })
    expect(out.length).toBe(1)
    expect(out[0].kind).toBe('reference')
  })
})
