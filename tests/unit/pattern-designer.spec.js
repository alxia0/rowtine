// Protège le nettoyage du designer saisi et le libellé de la ligne « Patron » du badge.
import { describe, it, expect } from 'vitest'
import { cleanDesignerName, patternBadgeLine } from '@/utils/pattern-designer'

describe('cleanDesignerName', () => {
  it('trim et réduit les espaces multiples', () => {
    expect(cleanDesignerName('  Sys   Fredens \n')).toBe('Sys Fredens')
  })
  it('espaces, tabulations et retours seuls -> chaîne vide', () => {
    expect(cleanDesignerName(' \t\n ')).toBe('')
  })
  it('non-chaîne -> chaîne vide', () => {
    expect(cleanDesignerName(null)).toBe('')
    expect(cleanDesignerName(undefined)).toBe('')
    expect(cleanDesignerName(42)).toBe('')
  })
})

describe('patternBadgeLine', () => {
  const t = (key, params = {}) => `${key}|${params.name}|${params.author}`
  it('nom + designer -> clé patternWithDesigner', () => {
    expect(patternBadgeLine({ name: 'Bonnet', author: 'Sys' }, t, 'fr')).toBe('project.patternWithDesigner|Bonnet|Sys')
  })
  it('transmet la locale à t en 3e argument, nom et designer nettoyés', () => {
    const calls = []
    const spy = (...args) => { calls.push(args); return '' }
    patternBadgeLine({ name: '  Bonnet  ', author: ' Sys  F ' }, spy, 'de')
    expect(calls[0]).toEqual(['project.patternWithDesigner', { name: 'Bonnet', author: 'Sys F' }, { locale: 'de' }])
  })
  it('sans designer -> nom seul, pas de « par » orphelin', () => {
    expect(patternBadgeLine({ name: 'Bonnet', author: '  ' }, t, 'fr')).toBe('Bonnet')
  })
  it('patron absent, builtin ou sans nom -> chaîne vide', () => {
    expect(patternBadgeLine(null, t, 'fr')).toBe('')
    expect(patternBadgeLine({ name: 'Libre', builtin: true }, t, 'fr')).toBe('')
    expect(patternBadgeLine({ name: '  ', author: 'Sys' }, t, 'fr')).toBe('')
  })
})
