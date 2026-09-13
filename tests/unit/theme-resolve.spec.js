import { describe, it, expect } from 'vitest'
import { THEMES, resolveEffective } from '@/theme/resolve'

describe('resolveEffective', () => {
  it('force light / dark quel que soit l\'OS', () => {
    expect(resolveEffective('light', true)).toBe('light')
    expect(resolveEffective('light', false)).toBe('light')
    expect(resolveEffective('dark', true)).toBe('dark')
    expect(resolveEffective('dark', false)).toBe('dark')
  })
  it('system suit l\'OS', () => {
    expect(resolveEffective('system', true)).toBe('dark')
    expect(resolveEffective('system', false)).toBe('light')
  })
  it('valeur inconnue → traitée comme system', () => {
    expect(resolveEffective('bidon', true)).toBe('dark')
    expect(resolveEffective(undefined, false)).toBe('light')
  })
  it('expose les 3 états', () => {
    expect(THEMES).toEqual(['system', 'light', 'dark'])
  })
})
