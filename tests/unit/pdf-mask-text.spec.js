// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {},
}))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

import { maskTextData } from '@/utils/pdf'

describe('maskTextData', () => {
  it("peint en blanc (R=255) les pixels des bboxes, sans toucher l'original", () => {
    const w = 6, h = 6
    const data = new Uint8ClampedArray(w * h * 4).fill(0) // tout encré (R=0)
    const masked = maskTextData(data, w, h, [{ x0: 1, y0: 1, x1: 3, y1: 3 }])
    // original intact
    expect(data[(1 * w + 1) * 4]).toBe(0)
    // masqué : (1,1) et (2,2) blancs ; (0,0) et (3,3) toujours encrés
    expect(masked[(1 * w + 1) * 4]).toBe(255)
    expect(masked[(2 * w + 2) * 4]).toBe(255)
    // `(0 * w + 0)` est écrit en toutes lettres, comme les autres lignes : c'est la formule
    // d'index de pixel `(y * largeur + x) * 4`, lisible à côté de ses voisines. Le linter y
    // voit une multiplication par zéro inutile ; la simplifier casserait le parallèle.
    // oxlint-disable-next-line erasing-op
    expect(masked[(0 * w + 0) * 4]).toBe(0)
    expect(masked[(3 * w + 3) * 4]).toBe(0)
  })

  it("clampe les bboxes hors limites sans planter", () => {
    const w = 4, h = 4
    const data = new Uint8ClampedArray(w * h * 4).fill(0)
    const masked = maskTextData(data, w, h, [{ x0: -5, y0: -5, x1: 2, y1: 2 }, { x0: 3, y0: 3, x1: 99, y1: 99 }])
    // Même formule d'index de pixel qu'au test précédent, gardée verbatim.
    // oxlint-disable-next-line erasing-op
    expect(masked[(0 * w + 0) * 4]).toBe(255)
    expect(masked[(3 * w + 3) * 4]).toBe(255)
  })
})
