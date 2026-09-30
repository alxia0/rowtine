import { describe, it, expect } from 'vitest'
import { parseDecimal, formatDecimalText } from '@/utils/decimal'

describe('parseDecimal', () => {
  it('accepte la virgule décimale FR', () => {
    expect(parseDecimal('3,5')).toBe(3.5)
  })
  it('accepte le point', () => {
    expect(parseDecimal('3.5')).toBe(3.5)
  })
  it('accepte un nombre déjà typé (valeurs historiques en base)', () => {
    expect(parseDecimal(3.5)).toBe(3.5)
  })
  it('renvoie NaN sur une chaîne non numérique', () => {
    expect(parseDecimal('abc')).toBeNaN()
  })
})

describe('formatDecimalText', () => {
  // Protège : le séparateur suit la langue, pas la saisie ; la donnée n'est ni arrondie ni complétée.
  it('suit la langue de l\'app, que la saisie ait un point ou une virgule', () => {
    expect(formatDecimalText('4.5', 'fr')).toBe('4,5')
    expect(formatDecimalText('4,5', 'en')).toBe('4.5')
    expect(formatDecimalText('4.5', 'de')).toBe('4,5')
    expect(formatDecimalText('4.5', 'es')).toBe('4,5')
    expect(formatDecimalText(4.5, 'fr')).toBe('4,5')
  })
  it('garde le nombre de décimales saisi et ne groupe jamais les milliers', () => {
    expect(formatDecimalText('4', 'fr')).toBe('4')
    expect(formatDecimalText('4.50', 'fr')).toBe('4,50')
    expect(formatDecimalText('3.125', 'en')).toBe('3.125')
    expect(formatDecimalText('1200', 'en')).toBe('1200')
  })
  it('rend telle quelle une saisie qui n\'est pas un nombre seul', () => {
    expect(formatDecimalText('4-4.5', 'fr')).toBe('4-4.5')
    expect(formatDecimalText('4 mm', 'fr')).toBe('4 mm')
    expect(formatDecimalText('3,5/4', 'en')).toBe('3,5/4')
    expect(formatDecimalText('  4.5 ', 'fr')).toBe('4,5')
  })
  it('rend telle quelle une saisie à décimales extrêmes, sans lever', () => {
    const extreme = '4.' + '1'.repeat(25)
    expect(() => formatDecimalText(extreme, 'fr')).not.toThrow()
    expect(formatDecimalText(extreme, 'fr')).toBe(extreme)
  })
  it('rend une chaîne vide pour une valeur absente', () => {
    expect(formatDecimalText('', 'fr')).toBe('')
    expect(formatDecimalText(null, 'fr')).toBe('')
    expect(formatDecimalText(undefined, 'fr')).toBe('')
  })
})
