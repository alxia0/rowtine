import { describe, it, expect, vi } from 'vitest'

// Mocke pdfjs-dist pour éviter l'import réel (DOMMatrix absent en jsdom) — cf. pdf-crop-margin.spec.js
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ GlobalWorkerOptions: {}, OPS: {} }))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

import { imageObjectToRGBA } from '@/utils/pdf'

describe('imageObjectToRGBA', () => {
  it('kind 2 (RGB) → RGBA plein, alpha=255', () => {
    // 2×1 px : rouge puis vert
    const img = { width: 2, height: 1, kind: 2, data: new Uint8Array([255, 0, 0, 0, 255, 0]) }
    const out = imageObjectToRGBA(img)
    expect(out.width).toBe(2); expect(out.height).toBe(1)
    expect(Array.from(out.data)).toEqual([255, 0, 0, 255, 0, 255, 0, 255])
  })
  it('kind 3 (RGBA) → copie fidèle', () => {
    const img = { width: 1, height: 1, kind: 3, data: new Uint8Array([10, 20, 30, 40]) }
    expect(Array.from(imageObjectToRGBA(img).data)).toEqual([10, 20, 30, 40])
  })
  it('entrée sans data ni bitmap → null', () => {
    expect(imageObjectToRGBA({ width: 0, height: 0 })).toBe(null)
  })
  it('dimensions valides mais sans data ni bitmap → null (garde de repli)', () => {
    expect(imageObjectToRGBA({ width: 5, height: 5 })).toBe(null)
  })
})
