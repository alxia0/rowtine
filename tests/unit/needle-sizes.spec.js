// Protège la table de correspondance mm → US/UK et son choix d'échelle par type d'outil.
import { describe, it, expect } from 'vitest'
import { KNITTING_SIZES, HOOK_SIZES, STEEL_HOOK_SIZES, sizeScaleFor, sizesFor, sizeEquivalents } from '@/constants/needle-sizes'

describe('needle-sizes', () => {
  it('chaque échelle est triée par mm croissant, sans doublon', () => {
    for (const table of [KNITTING_SIZES, HOOK_SIZES, STEEL_HOOK_SIZES]) {
      const mm = table.map((s) => s.mm)
      expect(mm).toEqual([...new Set(mm)].sort((a, b) => a - b))
    }
  })
  it('donne US et UK pour une aiguille de 4 mm', () => {
    expect(sizeEquivalents(4, 'knitting')).toEqual({ us: '6', uk: '8' })
  })
  it('donne la lettre US pour un crochet de 4 mm, sans UK', () => {
    expect(sizeEquivalents(4, 'hook')).toEqual({ us: 'G-6', uk: null })
  })
  it('couvre les tailles très fines (aiguilles 0,5 mm, crochet 0,75 mm)', () => {
    expect(sizeEquivalents(0.5, 'knitting').us).toBe('8/0')
    expect(sizeEquivalents(0.75, 'hook', 'steel').us).toBe('14')
  })
  it('crochet : la matière acier donne le numéro acier, une autre matière la lettre (2,25 mm)', () => {
    expect(sizeEquivalents(2.25, 'hook', 'steel')).toEqual({ us: '2', uk: null })
    expect(sizeEquivalents(2.25, 'hook', 'aluminium')).toEqual({ us: 'B-1', uk: null })
    expect(sizeEquivalents(2.25, 'hook')).toEqual({ us: 'B-1', uk: null })
    // Acier, mais taille absente de la table acier : la lettre reste.
    expect(sizeEquivalents(4, 'hook', 'steel').us).toBe('G-6')
  })
  it('crochet sous 2 mm d’une autre matière : le numéro acier, seul en usage', () => {
    expect(sizeEquivalents(1.5, 'hook', 'aluminium').us).toBe('8')
    expect(sizeEquivalents(1.5, 'hook').us).toBe('8')
  })
  it('la matière ne change rien à une aiguille', () => {
    expect(sizeEquivalents(2.25, 'knitting', 'steel')).toEqual({ us: '1', uk: '13' })
  })
  it('une taille hors table n’a pas d’équivalent', () => {
    expect(sizeEquivalents(4.2, 'knitting')).toEqual({ us: null, uk: null })
  })
  it('choisit l’échelle selon le type', () => {
    expect(sizeScaleFor('circular')).toBe('knitting')
    expect(sizeScaleFor('interchangeable')).toBe('knitting')
    expect(sizeScaleFor('standard')).toBe('hook')
    expect(sizeScaleFor('tunisian')).toBe('hook')
    expect(sizeScaleFor('hookKit')).toBe('hook')
  })
  it('sizesFor rend les mm de l’échelle', () => {
    expect(sizesFor('knitting')).toEqual(KNITTING_SIZES.map((s) => s.mm))
  })
  it('crochet : une seule échelle, les fines de l’acier sous 2 mm puis 2 à 25 mm, triée sans doublon', () => {
    const mm = sizesFor('hook')
    expect(mm).toEqual([...new Set(mm)].sort((a, b) => a - b))
    expect(mm[0]).toBe(0.6)
    expect(mm.at(-1)).toBe(25)
    expect(mm).toEqual([...STEEL_HOOK_SIZES.map((s) => s.mm).filter((n) => n < 2), ...HOOK_SIZES.map((s) => s.mm)])
  })
  it('verrouille les valeurs corrigées après recoupement et un UK non trivial', () => {
    expect(sizeEquivalents(7, 'knitting').us).toBe('10¾')
    expect(sizeEquivalents(12, 'hook').us).toBe('O-16')
    expect(sizeEquivalents(8, 'knitting').uk).toBe('0')
  })
  it('une case non confirmée reste sans équivalent', () => {
    expect(sizeEquivalents(7.5, 'knitting').us).toBeNull()
  })
})
