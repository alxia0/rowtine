// L'export stash Ravelry a 25 en-têtes fixes, vérifiés colonne par colonne sur deux
// fichiers réels. Cette table
// résout chaque en-tête connu vers un nom de champ CANONIQUE, jamais vers une position de
// colonne, un fichier dont les colonnes ne sont pas dans le même ordre reste importable.
import { describe, it, expect } from 'vitest'
import { normalizeHeader, fieldForHeader } from '@/utils/ravelry-import/field-aliases'

describe('normalizeHeader', () => {
  it('minuscule, sans accents, espaces superflus compressés', () => {
    expect(normalizeHeader('  Purchase   Date ')).toBe('purchase date')
    expect(normalizeHeader('Métrage (m)')).toBe('metrage (m)')
  })
})

describe('fieldForHeader', () => {
  it('reconnaît les en-têtes utiles du format stash Ravelry', () => {
    expect(fieldForHeader('Status')).toBe('status')
    expect(fieldForHeader('Brand')).toBe('brand')
    expect(fieldForHeader('Yarn')).toBe('model')
    expect(fieldForHeader('Colorway')).toBe('colorway')
    expect(fieldForHeader('Color family')).toBe('colorFamily')
    expect(fieldForHeader('Color Attributes')).toBe('colorAttributes')
    expect(fieldForHeader('Weight')).toBe('weight')
    expect(fieldForHeader('Grams/skein')).toBe('gramsPerSkein')
    expect(fieldForHeader('Yards/skein')).toBe('yardsPerSkein')
    expect(fieldForHeader('Meters/skein')).toBe('metersPerSkein')
    expect(fieldForHeader('Skeins')).toBe('skeins')
    expect(fieldForHeader('Remaining skeins')).toBe('remainingSkeins')
    expect(fieldForHeader('Dye lot')).toBe('dyeLot')
    expect(fieldForHeader('Stored in')).toBe('storedIn')
    expect(fieldForHeader('Purchase date')).toBe('purchaseDate')
    expect(fieldForHeader('Price paid')).toBe('pricePaid')
    expect(fieldForHeader('Purchased at')).toBe('purchasedAt')
    expect(fieldForHeader('Comments')).toBe('comments')
    expect(fieldForHeader('Tag List')).toBe('tagList')
  })

  it('insensible à la casse et aux espaces superflus', () => {
    expect(fieldForHeader('  brand  ')).toBe('brand')
    expect(fieldForHeader('BRAND')).toBe('brand')
  })

  it('en-tête inconnu (hors périmètre de la spec) → chaîne vide', () => {
    expect(fieldForHeader('ID Ravelry')).toBe('')
    expect(fieldForHeader('Has photo')).toBe('')
    expect(fieldForHeader('Total yards')).toBe('')
    expect(fieldForHeader('Remaining yards')).toBe('')
  })
})
