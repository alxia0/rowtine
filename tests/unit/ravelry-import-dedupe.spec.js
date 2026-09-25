// Dédoublonnage (clé brand+model+colorName normalisée) et filtre de statut. Comportement
// « ignorer si déjà présent » : append-only, jamais de fusion (cf. spec, décision
// « Dédoublonnage »).
import { describe, it, expect } from 'vitest'
import { yarnKey, isInStash, classifyRows } from '@/utils/ravelry-import/dedupe'

describe('yarnKey', () => {
  it('insensible à la casse et aux accents', () => {
    expect(yarnKey({ brand: 'Drops', model: 'Baby Merino', colorName: 'Bleu Nuit' })).toBe(
      yarnKey({ brand: 'DROPS', model: 'baby merino', colorName: 'bleu nuit' }),
    )
  })

  it('deux laines différentes ont des clés différentes', () => {
    expect(yarnKey({ brand: 'Drops', model: 'A', colorName: 'Bleu' })).not.toBe(
      yarnKey({ brand: 'Drops', model: 'B', colorName: 'Bleu' }),
    )
  })
})

describe('isInStash', () => {
  it('reconnaît "In stash", insensible à la casse', () => {
    expect(isInStash('In stash')).toBe(true)
    expect(isInStash('in stash')).toBe(true)
  })
  it('rejette les 3 autres statuts et une valeur absente', () => {
    expect(isInStash('All used up')).toBe(false)
    expect(isInStash('Will trade or sell')).toBe(false)
    expect(isInStash('Traded, sold, gifted')).toBe(false)
    expect(isInStash('')).toBe(false)
    expect(isInStash(undefined)).toBe(false)
  })
})

describe('classifyRows', () => {
  const row = (status, yarn) => ({ status, yarn, purchase: {} })

  it('sépare nouvelle / déjà présente / hors statut', () => {
    const existing = [{ brand: 'Drops', model: 'Baby Merino', colorName: 'Bleu nuit' }]
    const rows = [
      row('In stash', { brand: 'Drops', model: 'Baby Merino', colorName: 'Bleu nuit' }), // déjà présente
      row('In stash', { brand: 'Katia', model: 'Concept', colorName: 'Vert' }), // nouvelle
      row('All used up', { brand: 'X', model: 'Y', colorName: 'Z' }), // hors statut
    ]
    const { created, alreadyPresent, excludedStatus } = classifyRows(rows, existing)
    expect(created).toHaveLength(1)
    expect(created[0].yarn.model).toBe('Concept')
    expect(alreadyPresent).toHaveLength(1)
    expect(excludedStatus).toHaveLength(1)
  })

  it('deux lignes IDENTIQUES du même fichier : la 2e ne crée pas de doublon', () => {
    const rows = [
      row('In stash', { brand: 'Katia', model: 'Concept', colorName: 'Vert' }),
      row('In stash', { brand: 'Katia', model: 'Concept', colorName: 'Vert' }),
    ]
    const { created, alreadyPresent } = classifyRows(rows, [])
    expect(created).toHaveLength(1)
    expect(alreadyPresent).toHaveLength(1)
  })

  it('correspondance insensible à la casse/accents avec le stock existant', () => {
    const existing = [{ brand: 'cheval blanc', model: 'sunny', colorName: '56 vieux rose' }]
    const rows = [row('In stash', { brand: 'Cheval Blanc', model: 'Sunny', colorName: '56 Vieux Rose' })]
    const { created, alreadyPresent } = classifyRows(rows, existing)
    expect(created).toHaveLength(0)
    expect(alreadyPresent).toHaveLength(1)
  })

  it('nom de couleur de repli : reconnaît aussi une fiche importée avant le repli (nom vide)', () => {
    const existing = [{ brand: '', model: 'Like Mohair', colorName: '' }]
    const rows = [{ status: 'In stash', yarn: { brand: '', model: 'Like Mohair', colorName: 'Gris' }, colorNameFromFamily: true, purchase: {} }]
    const { created, alreadyPresent } = classifyRows(rows, existing)
    expect(created).toHaveLength(0)
    expect(alreadyPresent).toHaveLength(1)
  })

  it('nom de couleur venu du Colorway : une fiche au nom vide reste une autre laine', () => {
    const existing = [{ brand: 'Drops', model: 'Alpaca', colorName: '' }]
    const rows = [row('In stash', { brand: 'Drops', model: 'Alpaca', colorName: 'Gris' })]
    const { created } = classifyRows(rows, existing)
    expect(created).toHaveLength(1)
  })
})
