import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock pdfjs : deux pages, la 1re avec une image embarquée, la 2e sans.
// vi.hoisted : le factory de vi.mock est hoisté au-dessus des déclarations top-level
// (cf. tests/unit/native-storage.spec.js), donc les valeurs qu'il referme dessus
// doivent elles-mêmes être déclarées via vi.hoisted().
const { OPS, page1, page2 } = vi.hoisted(() => {
  const OPS = { paintImageXObject: 85, paintInlineImageXObject: 86 }
  const fakeImg = { width: 400, height: 300, bitmap: { close() {} } }
  const page1 = {
    getOperatorList: vi.fn().mockResolvedValue({ fnArray: [85], argsArray: [['img_a']] }),
    objs: { get: (id, cb) => cb(fakeImg) },
  }
  const page2 = {
    getOperatorList: vi.fn().mockResolvedValue({ fnArray: [12], argsArray: [[]] }),
    objs: { get: (id, cb) => cb(null) },
  }
  return { OPS, page1, page2 }
})
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {},
  OPS,
  getDocument: () => ({ promise: Promise.resolve({ numPages: 2, getPage: (n) => Promise.resolve(n === 1 ? page1 : page2) }) }),
}))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

import { extractImages } from '@/utils/pdf'

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
