import { describe, it, expect } from 'vitest'
import { defaultsForLocale } from '@/utils/locale-defaults'

describe('defaultsForLocale', () => {
  it('propose l’impérial et le dollar aux États-Unis', () => {
    expect(defaultsForLocale('en-US')).toEqual({ unitSystem: 'imperial', currency: 'USD' })
  })

  it('reste métrique au Royaume-Uni, avec la livre sterling', () => {
    // Les Britanniques tricotent en mètres et en grammes : déduire l'impérial de la langue
    // anglaise serait faux pour eux, comme pour les Australiens et les Canadiens.
    expect(defaultsForLocale('en-GB')).toEqual({ unitSystem: 'metric', currency: 'GBP' })
  })

  it('reconnaît la Suisse et le Canada quelle que soit la langue', () => {
    expect(defaultsForLocale('fr-CH').currency).toBe('CHF')
    expect(defaultsForLocale('de-CH').currency).toBe('CHF')
    expect(defaultsForLocale('fr-CA').currency).toBe('CAD')
    expect(defaultsForLocale('en-CA')).toEqual({ unitSystem: 'metric', currency: 'CAD' })
  })

  it('retombe sur métrique et euro pour tout le reste', () => {
    for (const l of ['fr', 'fr-FR', 'de-DE', 'es', '', null, undefined, 'charabia']) {
      expect(defaultsForLocale(l)).toEqual({ unitSystem: 'metric', currency: 'EUR' })
    }
  })

  it('ignore la casse et le séparateur', () => {
    expect(defaultsForLocale('EN_US')).toEqual({ unitSystem: 'imperial', currency: 'USD' })
  })
})
