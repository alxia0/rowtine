import { describe, it, expect } from 'vitest'
import { parseDecimal } from '@/utils/decimal'

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
