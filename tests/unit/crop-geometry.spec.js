import { describe, it, expect } from 'vitest'
import { initialRectForAspect, resizeWithAspect } from '@/utils/crop-geometry'

describe('initialRectForAspect', () => {
  it('centre un rect 4:3 dans un affichage carré', () => {
    const disp = { x: 0, y: 510, w: 1080, h: 1080 }
    const rect = initialRectForAspect(disp, 4 / 3)
    expect(rect.w).toBeCloseTo(1080, 5)
    expect(rect.h).toBeCloseTo(810, 5)
    expect(rect.x).toBeCloseTo(0, 5)
    expect(rect.y).toBeCloseTo(645, 5)
  })

  it('centre un rect au ratio 1 dans un affichage plus large que haut', () => {
    const disp = { x: 0, y: 0, w: 1200, h: 800 }
    const rect = initialRectForAspect(disp, 1)
    expect(rect.w).toBeCloseTo(800, 5)
    expect(rect.h).toBeCloseTo(800, 5)
    expect(rect.x).toBeCloseTo(200, 5)
    expect(rect.y).toBeCloseTo(0, 5)
  })
})

describe('resizeWithAspect', () => {
  const bounds = { x: 0, y: 0, w: 1000, h: 1000 }

  it('dérive la hauteur de la largeur en tirant le coin bas-droit', () => {
    const orig = { x: 100, y: 100, w: 400, h: 300 } // déjà au ratio 4:3
    const next = resizeWithAspect('br', orig, 100, 0, bounds, 4 / 3, 40)
    expect(next.x).toBeCloseTo(100, 5)
    expect(next.y).toBeCloseTo(100, 5)
    expect(next.w).toBeCloseTo(500, 5)
    expect(next.h).toBeCloseTo(375, 5)
  })

  it('borne la hauteur au cadre et recalcule la largeur en conséquence', () => {
    const orig = { x: 0, y: 800, w: 400, h: 300 }
    const next = resizeWithAspect('br', orig, 500, 500, bounds, 4 / 3, 40)
    expect(next.h).toBeCloseTo(200, 5)
    expect(next.w).toBeCloseTo(200 * (4 / 3), 5)
    expect(next.y).toBeCloseTo(800, 5)
  })

  it('ancre le coin opposé en tirant le coin haut-gauche', () => {
    const orig = { x: 200, y: 200, w: 400, h: 300 }
    const next = resizeWithAspect('tl', orig, -100, -100, bounds, 4 / 3, 40)
    expect(next.x + next.w).toBeCloseTo(600, 5)
    expect(next.y + next.h).toBeCloseTo(500, 5)
    expect(next.w / next.h).toBeCloseTo(4 / 3, 5)
  })

  it('ne descend jamais sous MIN même quand le geste pousse la largeur en dessous', () => {
    const orig = { x: 100, y: 100, w: 100, h: 75 } // déjà au ratio 4/3
    const next = resizeWithAspect('br', orig, -90, 0, bounds, 4 / 3, 40)
    expect(next.h).toBeGreaterThanOrEqual(40)
    expect(next.w / next.h).toBeCloseTo(4 / 3, 5)
  })

  it('applique le même plancher combiné pour un ratio portrait (< 1)', () => {
    const orig = { x: 0, y: 800, w: 300, h: 400 } // déjà au ratio 3/4
    const next = resizeWithAspect('br', orig, 500, 500, bounds, 3 / 4, 40)
    expect(next.w).toBeGreaterThanOrEqual(40)
    expect(next.h).toBeGreaterThanOrEqual(40)
    expect(next.w / next.h).toBeCloseTo(3 / 4, 5)
  })
})
