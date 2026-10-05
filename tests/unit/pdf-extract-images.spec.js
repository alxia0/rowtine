// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock pdfjs : deux pages, la 1re avec une image embarquée, la 2e sans.
// vi.hoisted : le factory de vi.mock est hoisté au-dessus des déclarations top-level
// (cf. tests/unit/native-storage.spec.js), donc les valeurs qu'il referme dessus
// doivent elles-mêmes être déclarées via vi.hoisted().
const { OPS, page1, page2, destroy, docOpts, getPage } = vi.hoisted(() => {
  const OPS = { transform: 12, paintImageXObject: 85, paintInlineImageXObject: 86 }
  const fakeImg = { width: 400, height: 300, bitmap: { close() {} } }
  const page1 = {
    getOperatorList: vi.fn().mockResolvedValue({ fnArray: [12, 85], argsArray: [[300, 0, 0, 300, 0, 0], ['img_a']] }),
    objs: { get: (id, cb) => cb(fakeImg) },
    view: [0, 0, 595, 842],
    getViewport: () => ({ width: 595, height: 842 }),
    render: vi.fn(() => ({ promise: Promise.resolve() })),
    cleanup: vi.fn(),
    getTextContent: vi.fn().mockResolvedValue({ items: [], styles: {} }),
  }
  const page2 = {
    getOperatorList: vi.fn().mockResolvedValue({ fnArray: [12], argsArray: [[]] }),
    objs: { get: (id, cb) => cb(null) },
    view: [0, 0, 595, 842],
    getViewport: () => ({ width: 595, height: 842 }),
    render: vi.fn(() => ({ promise: Promise.resolve() })),
    cleanup: vi.fn(),
    getTextContent: vi.fn().mockResolvedValue({ items: [], styles: {} }),
  }
  const getPage = vi.fn((n) => Promise.resolve(n === 1 ? page1 : page2))
  return { OPS, page1, page2, destroy: vi.fn().mockResolvedValue(undefined), docOpts: [], getPage }
})
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {},
  OPS,
  getDocument: (opts) => (docOpts.push(opts), {
    promise: Promise.resolve({ numPages: 2, getPage, getMetadata: async () => ({ info: { Title: 'T' } }) }),
    destroy,
  }),
}))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

import { extractImages, extractPages, extractDocMetaTitle, pdfPageCount, extractImagesWithPos, extractVectorRegions, selectedPageNumbers, renderPdfThumbnails } from '@/utils/pdf'

beforeEach(() => {
  // Stub du décodeur canvas : renvoie une data URL déterministe selon la taille.
  globalThis.__decodeStub = (img) => `data:image/png;base64,IMG${img.width}x${img.height}`
})

afterEach(() => {
  delete globalThis.__decodeStub
})

describe('extractImages', () => {
  it('extrait les images embarquées, ignore les pages sans image, best-effort', async () => {
    const out = await extractImages({ arrayBuffer: async () => new ArrayBuffer(8) })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ page: 1, w: 400, h: 300 })
    expect(out[0].src).toContain('data:image')
  })
  it('renvoie [] si l’extraction jette (best-effort)', async () => {
    const out = await extractImages(null)
    expect(out).toEqual([])
  })
})

// Chaque ouverture pdf.js garde le document dans le worker tant qu'il n'est pas détruit :
// la visionneuse en rouvre un à chaque page feuilletée.
describe('libération du document pdf.js', () => {
  const file = { arrayBuffer: async () => new ArrayBuffer(8) }
  beforeEach(() => destroy.mockClear())

  it('détruit le document après usage', async () => {
    expect(await pdfPageCount(file)).toBe(2)
    expect(await extractDocMetaTitle(file)).toBe('T')
    await extractImages(file)
    expect(destroy).toHaveBeenCalledTimes(3)
  })

  it('détruit le document même si la lecture échoue en cours de route', async () => {
    page1.getTextContent.mockRejectedValueOnce(new Error('lecture impossible'))
    await expect(extractPages(file)).rejects.toThrow()
    expect(destroy).toHaveBeenCalledTimes(1)
  })
})

describe('ouverture pdf.js', () => {
  // Protège : pdf.js refuse de décoder une image géante (bombe de décompression) à chaque ouverture.
  it('passe maxImageSize (8192 × 8192) à chaque getDocument', async () => {
    const file = { arrayBuffer: async () => new ArrayBuffer(8) }
    docOpts.length = 0
    await pdfPageCount(file)
    await extractDocMetaTitle(file)
    await extractImages(file)
    expect(docOpts).toHaveLength(3)
    for (const o of docOpts) expect(o.maxImageSize).toBe(8192 * 8192)
  })
})

describe('extraction limitée aux pages choisies', () => {
  beforeEach(() => getPage.mockClear())

  // Protège : sans sélection, toutes les pages ; avec, seulement celles du PDF.
  it('selectedPageNumbers', () => {
    expect(selectedPageNumbers(3)).toEqual([1, 2, 3])
    expect(selectedPageNumbers(3, [])).toEqual([1, 2, 3])
    expect(selectedPageNumbers(3, [2, 5])).toEqual([2])
  })

  // Protège : le texte des pages non choisies n'est jamais lu.
  it('extractPages ne lit que les pages choisies et compte la progression sur elles', async () => {
    const progress = []
    const pages = await extractPages(new Blob(['x']), (i, k) => progress.push([i, k]), { pageNumbers: [2] })
    expect(pages).toHaveLength(1)
    expect(getPage.mock.calls.map((c) => c[0])).toEqual([2])
    expect(progress).toEqual([[1, 1]])
  })

  // Protège : une image garde le numéro de sa page dans le PDF complet.
  it('extractImagesWithPos : page 2 seule → pas l’image de la page 1 ; page 1 → image page 1', async () => {
    expect(await extractImagesWithPos(new Blob(['x']), undefined, { pageNumbers: [2] })).toEqual([])
    const imgs = await extractImagesWithPos(new Blob(['x']), undefined, { pageNumbers: [1] })
    expect(imgs.length).toBeGreaterThan(0)
    expect(imgs.every((im) => im.page === 1)).toBe(true)
  })

  // Protège : les régions vectorielles ne parcourent que les pages choisies.
  it('extractVectorRegions ne lit que les pages choisies', async () => {
    await extractVectorRegions(new Blob(['x']), undefined, { pageNumbers: [2] })
    expect(getPage.mock.calls.map((c) => c[0])).toEqual([2])
  })
})

describe('renderPdfThumbnails', () => {
  // jsdom n'implémente pas le canvas : on le stubbe pour garder une sortie propre.
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({})
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,T')
  })
  afterEach(() => vi.restoreAllMocks())
  const reset = () => {
    destroy.mockClear()
    getPage.mockClear()
    for (const p of [page1, page2]) {
      p.cleanup.mockClear()
      p.render.mockClear()
    }
  }

  // Protège : un seul document ouvert, une miniature par page dans l'ordre, document libéré.
  it('compte les pages puis rend chaque page dans l’ordre', async () => {
    destroy.mockClear()
    const opened = docOpts.length
    const counts = []
    const thumbs = []
    await renderPdfThumbnails(new Blob(['x']), { onCount: (n) => counts.push(n), onThumb: (p) => thumbs.push(p) })
    expect(docOpts.length - opened).toBe(1)
    expect(counts).toEqual([2])
    expect(thumbs).toEqual([1, 2])
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  // Protège : fermer le sélecteur arrête le rendu d'un gros PDF, et libère quand même.
  it('s’arrête dès que isCancelled est vrai', async () => {
    destroy.mockClear()
    const thumbs = []
    await renderPdfThumbnails(new Blob(['x']), { onThumb: (p) => thumbs.push(p), isCancelled: () => thumbs.length >= 1 })
    expect(thumbs).toEqual([1])
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  // Protège : chaque page libère son operator list et ses images décodées après sa miniature.
  it('libère chaque page après sa miniature', async () => {
    reset()
    await renderPdfThumbnails(new Blob(['x']), {})
    expect(page1.cleanup).toHaveBeenCalledTimes(1)
    expect(page2.cleanup).toHaveBeenCalledTimes(1)
  })

  // Protège : une annulation pendant le rendu ne publie rien, ne touche pas la page suivante, libère tout.
  it('annulation pendant le rendu', async () => {
    reset()
    let cancelled = false
    page1.render.mockImplementationOnce(() => {
      cancelled = true
      return { promise: Promise.resolve() }
    })
    const onThumb = vi.fn()
    await renderPdfThumbnails(new Blob(['x']), { onThumb, isCancelled: () => cancelled })
    expect(onThumb).not.toHaveBeenCalled()
    expect(getPage).not.toHaveBeenCalledWith(2)
    expect(page1.cleanup).toHaveBeenCalledTimes(1)
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  // Protège : une page qui ne se rend pas donne '' et est libérée, la suivante est traitée.
  it('page en échec', async () => {
    reset()
    page1.render.mockImplementationOnce(() => ({ promise: Promise.reject(new Error('rendu impossible')) }))
    const onThumb = vi.fn()
    await renderPdfThumbnails(new Blob(['x']), { onThumb })
    expect(onThumb.mock.calls[0]).toEqual([1, ''])
    expect(onThumb.mock.calls[1][0]).toBe(2)
    expect(page1.cleanup).toHaveBeenCalledTimes(1)
  })
})
