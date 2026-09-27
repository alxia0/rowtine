// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock pdfjs : une page avec save → transform(échelle+position) → paint → restore.
const { OPS, page1 } = vi.hoisted(() => {
  const OPS = { save: 10, restore: 11, transform: 12, paintImageXObject: 85, paintInlineImageXObject: 86 }
  const fakeImg = { width: 400, height: 300, bitmap: { close() {} } }
  const page1 = {
    getOperatorList: vi.fn().mockResolvedValue({
      // save ; cm(200,0,0,150,50,600) ; paint(img_a) ; restore
      fnArray: [10, 12, 85, 11],
      argsArray: [[], [200, 0, 0, 150, 50, 600], ['img_a'], []],
    }),
    objs: { get: vi.fn((id, cb) => cb(fakeImg)) },
  }
  return { OPS, page1 }
})
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {},
  OPS,
  getDocument: () => ({ promise: Promise.resolve({ numPages: 1, getPage: () => Promise.resolve(page1) }) }),
}))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

import { extractImagesWithPos } from '@/utils/pdf'

beforeEach(() => {
  globalThis.__decodeStub = (img, maxW, maxH) => `data:image/png;base64,IMG${maxW || img.width}x${maxH || img.height}`
})
afterEach(() => {
  delete globalThis.__decodeStub
  vi.restoreAllMocks() // restaure document.createElement si un test l'a espionné (cf. décodage réel bitmap)
})

describe('extractImagesWithPos', () => {
  it('remonte la position (x, bord haut y) depuis la CTM ; w/h = taille AFFICHÉE (px CSS), pas intrinsèque', async () => {
    const out = await extractImagesWithPos({ arrayBuffer: async () => new ArrayBuffer(8) })
    expect(out).toHaveLength(1)
    // x = ctm[4] = 50 ; y_top = ctm[5] + |ctm[3]| = 600 + 150 = 750 (points, inchangé)
    // w/h affichés : ctm (200 pt, 150 pt) × 96/72 → 267 × 200 px CSS (≠ 400×300 intrinsèques)
    expect(out[0]).toMatchObject({ page: 1, x: 50, y: 750, w: 267, h: 200 })
    expect(out[0].src).toContain('data:image')
  })

  it('décode à 2× la taille affichée (pas la résolution intrinsèque) et reporte la taille affichée dans w/h', async () => {
    const bigImg = { width: 2048, height: 2048, bitmap: { close() {} } }
    page1.getOperatorList.mockResolvedValueOnce({
      // save ; cm(140,0,0,140,100,200) 140pt carré ; paint(img_big) ; restore
      fnArray: [10, 12, 85, 11],
      argsArray: [[], [140, 0, 0, 140, 100, 200], ['img_big'], []],
    })
    page1.objs.get.mockImplementationOnce((id, cb) => cb(bigImg))
    const calls = []
    globalThis.__decodeStub = (img, maxW, maxH) => {
      calls.push([maxW, maxH])
      return `data:image/png;base64,IMG${img.width}x${img.height}`
    }
    const out = await extractImagesWithPos({ arrayBuffer: async () => new ArrayBuffer(8) })
    expect(out).toHaveLength(1)
    // 140 pt → 186.667 px CSS affichés ; décodage demandé à 2× (~373)
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBeGreaterThanOrEqual(370)
    expect(calls[0][0]).toBeLessThanOrEqual(376)
    expect(calls[0][1]).toBeGreaterThanOrEqual(370)
    expect(calls[0][1]).toBeLessThanOrEqual(376)
    // le candidat reporte la taille AFFICHÉE (187×187), pas l'intrinsèque (2048×2048)
    expect(out[0].w).toBe(187)
    expect(out[0].h).toBe(187)
  })

  it('renvoie [] si l’extraction jette (best-effort)', async () => {
    const out = await extractImagesWithPos(null)
    expect(out).toEqual([])
  })

  it("classe kind:'grid' quand l'image décodée (résolution intrinsèque) est un treillis dense (Cella)", async () => {
    // RGBA plat 300×300 : 25 lignes horizontales + 25 colonnes verticales régulières (voie FORT,
    // cf. tests/unit/classify-grid-strict.spec.js) → classifyGridStrict doit renvoyer true.
    const w = 300, h = 300
    const evenly = (n, span, start = 4) => Array.from({ length: n }, (_, i) => Math.round(start + i * (span - 2 * start) / (n - 1)))
    const data = new Uint8ClampedArray(w * h * 4).fill(255)
    const paint = (x, y) => { const j = (y * w + x) * 4; data[j] = 0; data[j + 1] = 0; data[j + 2] = 0 }
    for (const y of evenly(25, h)) for (let x = 0; x < w; x++) paint(x, y)
    for (const x of evenly(25, w)) for (let y = 0; y < h; y++) paint(x, y)
    const gridImg = { width: w, height: h, kind: 3, data }
    page1.getOperatorList.mockResolvedValueOnce({
      fnArray: [10, 12, 85, 11],
      argsArray: [[], [200, 0, 0, 150, 50, 600], ['img_grid'], []],
    })
    page1.objs.get.mockImplementationOnce((id, cb) => cb(gridImg))
    const out = await extractImagesWithPos({ arrayBuffer: async () => new ArrayBuffer(8) })
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('grid')
  })

  // Filets de grille gris clair (Dorn p5) : l'image raster reste classée diagramme.
  it("classe kind:'grid' un treillis à filets gris clair (222)", async () => {
    const w = 300, h = 300
    const evenly = (n, span, start = 4) => Array.from({ length: n }, (_, i) => Math.round(start + i * (span - 2 * start) / (n - 1)))
    const data = new Uint8ClampedArray(w * h * 4).fill(255)
    const paint = (x, y) => { const j = (y * w + x) * 4; data[j] = 222; data[j + 1] = 222; data[j + 2] = 222 }
    for (const y of evenly(25, h)) for (let x = 0; x < w; x++) paint(x, y)
    for (const x of evenly(13, w)) for (let y = 0; y < h; y++) paint(x, y)
    page1.objs.get.mockImplementationOnce((id, cb) => cb({ width: w, height: h, kind: 3, data }))
    const out = await extractImagesWithPos({ arrayBuffer: async () => new ArrayBuffer(8) })
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('grid')
  })

  it("ne pose pas kind quand l'image décodée n'a pas de treillis (photo)", async () => {
    // RGBA plat 300×300 blanc uni : aucune ligne détectée sur aucun axe → classifyGridStrict false.
    const w = 300, h = 300
    const data = new Uint8ClampedArray(w * h * 4).fill(255)
    const photoImg = { width: w, height: h, kind: 3, data }
    page1.getOperatorList.mockResolvedValueOnce({
      fnArray: [10, 12, 85, 11],
      argsArray: [[], [200, 0, 0, 150, 50, 600], ['img_photo'], []],
    })
    page1.objs.get.mockImplementationOnce((id, cb) => cb(photoImg))
    const out = await extractImagesWithPos({ arrayBuffer: async () => new ArrayBuffer(8) })
    expect(out).toHaveLength(1)
    expect(out[0]).not.toHaveProperty('kind')
  })

  // decodeImageObject NE DOIT PAS fermer img.bitmap — extractImagesWithPos
  // relit ce même bitmap juste après (imageObjectToRGBA, pour classifyGridStrict). Ce test passe
  // par le VRAI decodeImageObject (pas __decodeStub) pour prouver que les deux lectures cohabitent :
  // sans la correction, la 2e lecture (imageObjectToRGBA) jetterait sur un bitmap fermé, best-effort
  // avalerait l'erreur, et `kind:'grid'` ne serait plus jamais posé pour les images bitmap (régression
  // du fix E — diagrammes Cella en JPEG embarqué).
  it('décodage réel (sans __decodeStub) : classe kind:grid pour une image bitmap SANS fermer le bitmap avant sa 2e lecture', async () => {
    delete globalThis.__decodeStub
    const w = 300, h = 300
    const evenly = (n, span, start = 4) => Array.from({ length: n }, (_, i) => Math.round(start + i * (span - 2 * start) / (n - 1)))
    const lattice = new Uint8ClampedArray(w * h * 4).fill(255)
    const paint = (x, y) => { const j = (y * w + x) * 4; lattice[j] = 0; lattice[j + 1] = 0; lattice[j + 2] = 0 }
    for (const y of evenly(25, h)) for (let x = 0; x < w; x++) paint(x, y)
    for (const x of evenly(25, w)) for (let y = 0; y < h; y++) paint(x, y)
    let closeCalls = 0
    const bitmapImg = { width: w, height: h, bitmap: { close: () => { closeCalls++ } } }
    page1.getOperatorList.mockResolvedValueOnce({
      fnArray: [10, 12, 85, 11],
      argsArray: [[], [200, 0, 0, 150, 50, 600], ['img_bitmap'], []],
    })
    page1.objs.get.mockImplementationOnce((id, cb) => cb(bitmapImg))
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag !== 'canvas') return {}
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          fillRect: () => {},
          drawImage: () => {},
          getImageData: () => ({ data: lattice }),
        }),
        toDataURL: () => 'data:image/jpeg;base64,X',
      }
    })
    const out = await extractImagesWithPos({ arrayBuffer: async () => new ArrayBuffer(8) })
    expect(out).toHaveLength(1)
    expect(out[0].src).toBe('data:image/jpeg;base64,X')
    expect(out[0].kind).toBe('grid')
    expect(closeCalls).toBe(0)
  })

  // Deuxième passe de revue (point mineur) : la branche « décode directement à la taille cible »
  // de decodeImageObject (le livrable principal de ce travail pour la forme ImageBitmap) n'était
  // exercée par AUCUN test passant par le VRAI decodeImageObject avec un scale < 1 — le test
  // ci-dessus utilise une image 300×300 dont le plafond (~373px) ne déclenche jamais de
  // réduction. Ici, une image 2000×2000 dont le plafond réel (2× taille affichée, ~267px) force
  // la réduction : on vérifie que le PREMIER canvas créé (celui du décodage) est DÉJÀ à la
  // taille réduite — pas à 2000×2000 — preuve qu'aucun canvas plein format intermédiaire n'est
  // alloué avant de réduire.
  it('décodage réel (sans __decodeStub), image bitmap au-delà du plafond : décode DIRECTEMENT à la taille réduite (pas de canvas plein format intermédiaire)', async () => {
    delete globalThis.__decodeStub
    const w = 2000, h = 2000
    const bitmapImg = { width: w, height: h, bitmap: { close: () => {} } }
    page1.getOperatorList.mockResolvedValueOnce({
      // cm(100,0,0,100,0,0) : 100pt carré affiché → ~133px CSS affichés, plafond de décodage 2× ≈ 267px
      fnArray: [10, 12, 85, 11],
      argsArray: [[], [100, 0, 0, 100, 0, 0], ['img_huge_bitmap'], []],
    })
    page1.objs.get.mockImplementationOnce((id, cb) => cb(bitmapImg))
    // Snapshot de width/height pris au moment de getContext() (juste après que le code de
    // prod les ait posées) — PAS une relecture tardive de l'objet canvas : decodeImageObject
    // remet volontairement canvas.width/height à 0 avant de rendre la main, donc
    // lire `c.width` après coup y verrait toujours 0 et ne prouverait rien.
    const snapshots = []
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag !== 'canvas') return {}
      const c = {
        width: 0,
        height: 0,
        getContext: () => {
          snapshots.push({ width: c.width, height: c.height })
          return {
            fillRect: () => {},
            drawImage: () => {},
            getImageData: () => ({ data: new Uint8ClampedArray(c.width * c.height * 4).fill(255) }),
          }
        },
        toDataURL: () => 'data:image/jpeg;base64,X',
      }
      return c
    })
    const out = await extractImagesWithPos({ arrayBuffer: async () => new ArrayBuffer(8) })
    expect(out).toHaveLength(1)
    expect(out[0].src).toBe('data:image/jpeg;base64,X')
    // 1er canvas créé = celui de decodeImageObject : déjà réduit (jamais 2000×2000) au moment
    // même du décodage — preuve qu'aucun canvas plein format intermédiaire n'est alloué.
    expect(snapshots[0].width).toBeLessThan(300)
    expect(snapshots[0].height).toBeLessThan(300)
    expect(snapshots[0].width).toBeGreaterThan(0)
  })

  // Image étirée par le PDF (margrethe p3) : décodée aux proportions affichées, pas natives.
  it('décodage réel, image bitmap étirée : canvas aux proportions affichées', async () => {
    delete globalThis.__decodeStub
    page1.getOperatorList.mockResolvedValueOnce({
      // 376,5 × 265,5 pt affichés → 502 × 354 px CSS, bornes 2× : 1004 × 708
      fnArray: [10, 12, 85, 11],
      argsArray: [[], [376.5, 0, 0, 265.5, 0, 0], ['img_stretched'], []],
    })
    page1.objs.get.mockImplementationOnce((id, cb) => cb({ width: 1100, height: 1164, bitmap: { close() {} } }))
    const snapshots = []
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag !== 'canvas') return {}
      const c = {
        width: 0,
        height: 0,
        getContext: () => {
          snapshots.push({ width: c.width, height: c.height })
          return { fillRect: () => {}, drawImage: () => {}, getImageData: () => ({ data: new Uint8ClampedArray(c.width * c.height * 4).fill(255) }) }
        },
        toDataURL: () => 'data:image/jpeg;base64,X',
      }
      return c
    })
    await extractImagesWithPos({ arrayBuffer: async () => new ArrayBuffer(8) })
    expect(snapshots[0]).toEqual({ width: 1004, height: 708 })
  })

  it('plafonne à 1280px même quand 2× la taille affichée le dépasse (grand diagramme)', async () => {
    const bigImg = { width: 3000, height: 3000, bitmap: { close() {} } }
    page1.getOperatorList.mockResolvedValueOnce({
      // cm(1000,0,0,1000,0,0) : 1000pt carré affiché → ~1333px CSS affichés, 2× = ~2667px
      fnArray: [10, 12, 85, 11],
      argsArray: [[], [1000, 0, 0, 1000, 0, 0], ['img_huge'], []],
    })
    page1.objs.get.mockImplementationOnce((id, cb) => cb(bigImg))
    const calls = []
    globalThis.__decodeStub = (img, maxW, maxH) => {
      calls.push([maxW, maxH])
      return `data:image/png;base64,IMG`
    }
    await extractImagesWithPos({ arrayBuffer: async () => new ArrayBuffer(8) })
    expect(calls).toHaveLength(1)
    // Sans le plafond, maxW/maxH vaudraient ~2667 (2× affiché) ; avec, ils sont bornés à 1280.
    expect(calls[0][0]).toBeLessThanOrEqual(1280)
    expect(calls[0][1]).toBeLessThanOrEqual(1280)
  })
  // Un pixel transparent (masque doux) sort blanc dans le JPEG, jamais noir : voie bitmap.
  it('décodage réel, image bitmap : fond blanc peint AVANT l’image (transparence non noircie)', async () => {
    delete globalThis.__decodeStub
    const calls = []
    page1.objs.get.mockImplementationOnce((id, cb) => cb({ width: 40, height: 30, bitmap: { close() {} } }))
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag !== 'canvas') return {}
      const ctx = {
        set fillStyle(v) { calls.push(['fillStyle', v]) },
        fillRect: (...a) => calls.push(['fillRect', ...a]),
        drawImage: () => calls.push(['drawImage']),
        getImageData: () => ({ data: new Uint8ClampedArray(40 * 30 * 4).fill(255) }),
      }
      return { width: 0, height: 0, getContext: () => ctx, toDataURL: () => 'data:image/jpeg;base64,X' }
    })
    await extractImagesWithPos({ arrayBuffer: async () => new ArrayBuffer(8) })
    const fill = calls.findIndex((c) => c[0] === 'fillRect')
    expect(calls.find((c) => c[0] === 'fillStyle')?.[1]).toMatch(/^#fff(fff)?$/i)
    expect(fill).toBeGreaterThanOrEqual(0)
    expect(fill).toBeLessThan(calls.findIndex((c) => c[0] === 'drawImage'))
  })

  // Même garantie pour les pixels RGBA bruts (putImageData ne compose pas) : alpha 0 → blanc, alpha 128 → gris moyen.
  it('décodage réel, pixels RGBA bruts : composés sur blanc avant l’encodage JPEG', async () => {
    delete globalThis.__decodeStub
    let put = null
    const data = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 128, 10, 20, 30, 255])
    page1.objs.get.mockImplementationOnce((id, cb) => cb({ width: 3, height: 1, kind: 3, data }))
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag !== 'canvas') return {}
      const ctx = {
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: (d) => { put = Array.from(d.data) },
        drawImage: () => {},
        fillRect: () => {},
        getImageData: () => ({ data: new Uint8ClampedArray(12).fill(255) }),
      }
      return { width: 0, height: 0, getContext: () => ctx, toDataURL: () => 'data:image/jpeg;base64,X' }
    })
    await extractImagesWithPos({ arrayBuffer: async () => new ArrayBuffer(8) })
    expect(put.slice(0, 4)).toEqual([255, 255, 255, 255])
    expect(put[4]).toBeGreaterThanOrEqual(126)
    expect(put[4]).toBeLessThanOrEqual(128)
    expect(put[7]).toBe(255)
    expect(put.slice(8, 12)).toEqual([10, 20, 30, 255])
  })
})
