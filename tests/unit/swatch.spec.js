import { describe, it, expect } from 'vitest'
import { hexToHsl, hslToHex, isCustomColor, hsvToHslString, hslStringToHsv } from '@/constants/swatch'

describe('hexToHsl', () => {
  it('convertit les couleurs primaires', () => {
    expect(hexToHsl('#ff0000')).toBe('hsl(0 100% 50%)')
    expect(hexToHsl('#00ff00')).toBe('hsl(120 100% 50%)')
    expect(hexToHsl('#0000ff')).toBe('hsl(240 100% 50%)')
  })
  it('convertit noir, blanc et gris (saturation 0)', () => {
    expect(hexToHsl('#000000')).toBe('hsl(0 0% 0%)')
    expect(hexToHsl('#ffffff')).toBe('hsl(0 0% 100%)')
    expect(hexToHsl('#808080')).toBe('hsl(0 0% 50%)')
  })
  it('tolère l’absence de # et renvoie "" si invalide', () => {
    expect(hexToHsl('ff0000')).toBe('hsl(0 100% 50%)')
    expect(hexToHsl('nope')).toBe('')
    expect(hexToHsl('')).toBe('')
  })
})

describe('hslToHex', () => {
  it('convertit les couleurs primaires', () => {
    expect(hslToHex('hsl(0 100% 50%)')).toBe('#ff0000')
    expect(hslToHex('hsl(120 100% 50%)')).toBe('#00ff00')
    expect(hslToHex('hsl(240 100% 50%)')).toBe('#0000ff')
  })
  it('convertit noir et blanc', () => {
    expect(hslToHex('hsl(0 0% 0%)')).toBe('#000000')
    expect(hslToHex('hsl(0 0% 100%)')).toBe('#ffffff')
  })
  it('renvoie "" si invalide', () => {
    expect(hslToHex('rouge')).toBe('')
    expect(hslToHex('')).toBe('')
  })
})

describe('isCustomColor', () => {
  it('false pour vide ou pour une couleur de la palette', async () => {
    const { COLOR_PALETTE } = await import('@/constants/swatch')
    expect(isCustomColor('')).toBe(false)
    expect(isCustomColor(COLOR_PALETTE[0].hsl)).toBe(false)
  })
  it('true pour une couleur hors palette', () => {
    expect(isCustomColor('hsl(200 50% 50%)')).toBe(true)
  })
})

describe('hsvToHslString / hslStringToHsv (carré du sélecteur ↔ stockage)', () => {
  it('convertit les couleurs de référence HSV → HSL', () => {
    expect(hsvToHslString(0, 100, 100)).toBe('hsl(0 100% 50%)') // rouge pur
    expect(hsvToHslString(0, 0, 100)).toBe('hsl(0 0% 100%)') // blanc
    expect(hsvToHslString(0, 0, 0)).toBe('hsl(0 0% 0%)') // noir
    expect(hsvToHslString(0, 100, 50)).toBe('hsl(0 100% 25%)') // rouge sombre
    expect(hsvToHslString(240, 100, 100)).toBe('hsl(240 100% 50%)') // bleu pur
  })
  it('convertit HSL → HSV', () => {
    expect(hslStringToHsv('hsl(0 100% 50%)')).toEqual({ h: 0, s: 100, v: 100 })
    expect(hslStringToHsv('hsl(0 0% 100%)')).toEqual({ h: 0, s: 0, v: 100 })
    expect(hslStringToHsv('hsl(0 0% 0%)')).toEqual({ h: 0, s: 0, v: 0 })
    expect(hslStringToHsv('hsl(240 100% 50%)')).toEqual({ h: 240, s: 100, v: 100 })
  })
  it('renvoie null si la chaîne est invalide', () => {
    expect(hslStringToHsv('rouge')).toBe(null)
    expect(hslStringToHsv('')).toBe(null)
  })
  it('aller-retour fidèle (le sélecteur rouvre sur la couleur enregistrée)', () => {
    for (const [h, s, v] of [[12, 72, 67], [210, 25, 44], [300, 35, 38], [60, 100, 100]]) {
      const back = hslStringToHsv(hsvToHslString(h, s, v))
      expect(back.h).toBe(h)
      expect(Math.abs(back.s - s)).toBeLessThanOrEqual(1) // tolérance d'arrondi
      expect(Math.abs(back.v - v)).toBeLessThanOrEqual(1)
    }
  })
  it('borne les entrées hors plage plutôt que de produire une couleur absurde', () => {
    expect(hsvToHslString(0, 999, 999)).toBe('hsl(0 100% 50%)')
    expect(hsvToHslString(0, -50, -50)).toBe('hsl(0 0% 0%)')
    expect(hsvToHslString(400, 100, 100)).toBe('hsl(40 100% 50%)') // teinte repliée modulo 360
  })
})
