// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { detectAppLocale } from '@/utils/app-locale'

describe('detectAppLocale', () => {
  it('reconnaît une langue supportée sans région', () => {
    expect(detectAppLocale('de')).toBe('de')
  })

  it('ignore la région et ne garde que la langue', () => {
    expect(detectAppLocale('de-AT')).toBe('de')
    expect(detectAppLocale('es-MX')).toBe('es')
    expect(detectAppLocale('en-GB')).toBe('en')
    expect(detectAppLocale('fr-CH')).toBe('fr')
  })

  it('accepte le séparateur souligné et la casse haute (Android renvoie parfois « de_DE »)', () => {
    expect(detectAppLocale('de_DE')).toBe('de')
    expect(detectAppLocale('ES-es')).toBe('es')
  })

  it("se replie sur l'anglais pour une langue non supportée, jamais sur le français", () => {
    expect(detectAppLocale('it-IT')).toBe('en')
    expect(detectAppLocale('ja')).toBe('en')
  })

  it("se replie sur l'anglais quand l'entrée est vide, nulle ou absurde", () => {
    expect(detectAppLocale('')).toBe('en')
    expect(detectAppLocale(null)).toBe('en')
    expect(detectAppLocale(undefined)).toBe('en')
    expect(detectAppLocale(42)).toBe('en')
  })

  it('accepte une liste de préférences et retient la 1re langue supportée', () => {
    // navigator.languages sur Android : ['it-IT', 'de-DE', 'en-US']
    expect(detectAppLocale(['it-IT', 'de-DE', 'en-US'])).toBe('de')
    expect(detectAppLocale(['it-IT', 'ja-JP'])).toBe('en')
    expect(detectAppLocale([])).toBe('en')
  })
})
