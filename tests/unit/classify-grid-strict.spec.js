// tests/unit/classify-grid-strict.spec.js
import { describe, it, expect } from 'vitest'
import { classifyGridStrict, classifyRasterGrid } from '@/utils/pdf-import/vector-regions'

// Construit un RGBA plat blanc (R=255) puis peint des lignes sombres (R=0) aux positions données.
function makeLattice(w, h, rowYs, colXs, ink = 0) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255)
  const paint = (x, y) => { const j = (y * w + x) * 4; data[j] = ink; data[j + 1] = ink; data[j + 2] = ink }
  for (const y of rowYs) for (let x = 0; x < w; x++) paint(x, y)
  for (const x of colXs) for (let y = 0; y < h; y++) paint(x, y)
  return data
}
const evenly = (n, span, start = 4) => Array.from({ length: n }, (_, i) => Math.round(start + i * (span - 2 * start) / (n - 1)))
const bbox = (w, h) => ({ x0: 0, y0: 0, x1: w, y1: h })

describe('classifyGridStrict', () => {
  it('treillis dense régulier (25×25) → grille (voie FORT)', () => {
    const w = 300, h = 300
    const data = makeLattice(w, h, evenly(25, h), evenly(25, w))
    expect(classifyGridStrict(data, w, bbox(w, h))).toBe(true)
  })

  it('treillis lâche mais régulier (12×12) → grille (voie RÉGULIER)', () => {
    const w = 300, h = 300
    const data = makeLattice(w, h, evenly(12, h), evenly(12, w))
    expect(classifyGridStrict(data, w, bbox(w, h))).toBe(true)
  })

  it('trop peu de lignes (6×6) → pas une grille', () => {
    const w = 300, h = 300
    const data = makeLattice(w, h, evenly(6, h), evenly(6, w))
    expect(classifyGridStrict(data, w, bbox(w, h))).toBe(false)
  })

  it('12 lignes mais espacement IRRÉGULIER sur l’axe limitant → pas une grille', () => {
    const w = 300, h = 300
    // 12 lignes horizontales agglutinées (irrégulières) + 20 colonnes régulières
    const rowYs = [10, 12, 14, 40, 42, 44, 120, 122, 124, 260, 262, 264]
    const data = makeLattice(w, h, rowYs, evenly(20, w))
    expect(classifyGridStrict(data, w, bbox(w, h))).toBe(false)
  })

  it('seulement 3 colonnes (comme le QR/marketing Bonnet) → pas une grille', () => {
    const w = 300, h = 300
    const data = makeLattice(w, h, evenly(14, h), evenly(3, w))
    expect(classifyGridStrict(data, w, bbox(w, h))).toBe(false)
  })
})

// Image raster : un treillis à filets gris clair (Dorn p5, gris 222) reste un diagramme.
describe('classifyRasterGrid', () => {
  it('filets gris clair (222) : manqués par le seuil strict, reconnus en image raster', () => {
    const w = 300, h = 300
    const data = makeLattice(w, h, evenly(25, h), evenly(13, w), 222)
    expect(classifyGridStrict(data, w, bbox(w, h))).toBe(false)
    expect(classifyRasterGrid(data, w, bbox(w, h))).toBe(true)
  })

  it('fond sans blanc papier (photo de porte, tissu) : pas de second essai en gris clair', () => {
    const w = 300, h = 300
    const data = makeLattice(w, h, evenly(25, h), evenly(13, w), 222)
    for (let i = 0; i < data.length; i += 4) if (data[i] === 255) { data[i] = 238; data[i + 1] = 238; data[i + 2] = 238 }
    expect(classifyRasterGrid(data, w, bbox(w, h))).toBe(false)
  })

  it('garde tout verdict grille du seuil strict et rejette une image sans treillis', () => {
    const w = 300, h = 300
    expect(classifyRasterGrid(makeLattice(w, h, evenly(25, h), evenly(25, w)), w, bbox(w, h))).toBe(true)
    expect(classifyRasterGrid(makeLattice(w, h, evenly(6, h), evenly(6, w), 222), w, bbox(w, h))).toBe(false)
  })
})
