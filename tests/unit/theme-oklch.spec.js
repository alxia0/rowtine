import { describe, it, expect } from 'vitest'
import { oklchToRgb, oklchToCss, oklchToHex } from '@/theme/oklch'

describe('oklchToRgb', () => {
  it('L=0 -> noir, quels que soient C et H', () => {
    expect(oklchToRgb(0, 0.2, 190)).toEqual([0, 0, 0])
  })
  it('L=100, C=0 -> blanc', () => {
    expect(oklchToRgb(100, 0, 0)).toEqual([255, 255, 255])
  })
  it('reproduit --brand clair actuel (#ad5a34) depuis ses coordonnées OKLCH mesurées', () => {
    expect(oklchToRgb(55.94, 0.1202, 44.08)).toEqual([173, 90, 52])
  })
  it('reproduit --brand sombre actuel (#e8ad4c) depuis ses coordonnées OKLCH mesurées', () => {
    expect(oklchToRgb(78.51, 0.1317, 77)).toEqual([232, 173, 76])
  })
  it('écrête au gamut sRGB (jamais de composante hors [0,255])', () => {
    const [r, g, b] = oklchToRgb(60, 0.4, 260) // chromaticité extrême, hors-gamut
    for (const v of [r, g, b]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(255)
    }
  })
})

describe('oklchToCss', () => {
  it('formate en rgb(), jamais en oklch()', () => {
    expect(oklchToCss(55.94, 0.1202, 44.08)).toBe('rgb(173, 90, 52)')
  })
})

describe('oklchToHex', () => {
  it('formate en hex minuscule à 6 chiffres', () => {
    expect(oklchToHex(55.94, 0.1202, 44.08)).toBe('#ad5a34')
  })
  it('reproduit --bg sombre actuel (#161210)', () => {
    expect(oklchToHex(18.63, 0.0078, 4.28 + 44)).toBe('#161210')
  })
})
