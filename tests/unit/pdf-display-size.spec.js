import { describe, it, expect, vi } from 'vitest'

// Helpers purs uniquement : on mocke pdfjs-dist (comme pdf-resolve-image-obj.spec.js)
// pour éviter l'import réel de pdfjs-dist en environnement jsdom (DOMMatrix absent).
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ GlobalWorkerOptions: {}, OPS: {} }))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

import { displayedImageSize, fitScale, clampRenderScale, pxOptsForScale } from '@/utils/pdf'

describe('displayedImageSize (CTM → px CSS)', () => {
  it('image axis-aligned : |a|,|d| en points → px CSS (×96/72)', () => {
    const s = displayedImageSize([140, 0, 0, 140, 100, 200]) // 140 pt carré
    expect(Math.round(s.w)).toBe(187)
    expect(Math.round(s.h)).toBe(187)
  })
  it('prend la norme des colonnes (image pivotée/étirée)', () => {
    const s = displayedImageSize([0, 72, 72, 0, 0, 0]) // 72 pt, pivotée
    expect(Math.round(s.w)).toBe(96)
    expect(Math.round(s.h)).toBe(96)
  })
})

describe('fitScale (réduction, jamais agrandissement)', () => {
  it('réduit quand la cible est plus petite', () => {
    expect(fitScale(2048, 582, 374, 374)).toBeCloseTo(374 / 2048, 5)
  })
  it('ne dépasse jamais 1 (pas d’agrandissement)', () => {
    expect(fitScale(100, 100, 400, 400)).toBe(1)
  })
  it('cible absente/nulle → 1', () => {
    expect(fitScale(2048, 2048, 0, 0)).toBe(1)
    expect(fitScale(2048, 2048)).toBe(1)
  })
})

// Plafond de dimension de rendu de PAGE, appliqué en amont de
// l'allocation du canvas offscreen (renderPdfPageToDataUrl, renderPageCanvas).
describe('clampRenderScale (plafond de dimension de rendu, jamais d’agrandissement)', () => {
  it('PDF dans les bornes normales : scale inchangé (comportement actuel préservé)', () => {
    // Page A4 (595×842 pt) à l'échelle « retina » (2) : très en dessous du plafond par défaut.
    expect(clampRenderScale(595, 842, 2)).toBe(2)
  })
  it('page grand format : réduit le scale pour tenir sous le plafond', () => {
    // 5000×5000 pt à scale=2 → viewport 10000×10000 px, très au-dessus du plafond (4096 par défaut).
    const scale = clampRenderScale(5000, 5000, 2)
    expect(scale).toBeLessThan(2)
    expect(5000 * scale).toBeLessThanOrEqual(4096)
  })
  it('ne réduit que l’axe qui dépasse : page très large mais basse reste plafonnée sur la largeur', () => {
    const scale = clampRenderScale(9000, 100, 1, 4096)
    expect(9000 * scale).toBeLessThanOrEqual(4096)
    expect(scale).toBeLessThan(1)
  })
  it('plafond personnalisé (maxDim explicite)', () => {
    const scale = clampRenderScale(2000, 2000, 1, 1000)
    expect(scale).toBeCloseTo(0.5, 5)
  })
  it('n\'agrandit jamais (scale déjà petit et sous le plafond → inchangé)', () => {
    expect(clampRenderScale(100, 100, 0.5)).toBe(0.5)
  })
  it('entrées dégénérées (dimension ou scale nul/absent) → scale renvoyé tel quel', () => {
    expect(clampRenderScale(0, 100, 2)).toBe(2)
    expect(clampRenderScale(100, 0, 2)).toBe(2)
    expect(clampRenderScale(100, 100, 0)).toBe(0)
  })
})

// Deuxième passe de revue : les seuils de découpage de région (gapMin/minLen)
// doivent suivre l'échelle EFFECTIVE de rendu d'une page, pas une constante nominale — cf.
// tests/unit/pdf-vector-scale-desync.spec.js pour la preuve d'intégration (via extractVectorRegions).
describe('pxOptsForScale (seuils de découpage dérivés de l’échelle effective)', () => {
  it('croît proportionnellement à l’échelle (référence 24pt/40pt à scale=1)', () => {
    expect(pxOptsForScale(1)).toMatchObject({ gapMin: 24, minLen: 40 })
    expect(pxOptsForScale(2)).toMatchObject({ gapMin: 48, minLen: 80 })
    expect(pxOptsForScale(0.5)).toMatchObject({ gapMin: 12, minLen: 20 })
  })
  it('conserve les autres seuils calibrés (indépendants de l’échelle)', () => {
    const o = pxOptsForScale(2)
    expect(o).toMatchObject({ inkThreshold: 200, step: 3, inkFloor: 1, lineCov: 0.5, minLines: 4 })
  })
  it('échelle nulle/négative/absente → repli sur 1 (jamais de seuils nuls ou négatifs)', () => {
    expect(pxOptsForScale(0)).toMatchObject({ gapMin: 24, minLen: 40 })
    expect(pxOptsForScale(-1)).toMatchObject({ gapMin: 24, minLen: 40 })
    expect(pxOptsForScale(undefined)).toMatchObject({ gapMin: 24, minLen: 40 })
  })
})
