// Modèle (« Baby Merino ») distinct de la marque (« Drops »), + date d'achat par ligne de stock.
// Retour terrain, 16/07.
import { describe, it, expect } from 'vitest'
import { emptyYarn } from '@/stores/yarns'

describe('modèle de laine', () => {
  it('expose un champ « modèle » vide par défaut', () => {
    expect(emptyYarn().model).toBe('')
  })

  it('expose un champ « date d’achat » vide par défaut', () => {
    expect(emptyYarn().purchasedAt).toBe('')
  })

  it('garde la marque et le coloris séparés du modèle', () => {
    const y = emptyYarn()
    expect(y).toHaveProperty('brand')
    expect(y).toHaveProperty('colorName')
    expect(y).toHaveProperty('model')
  })
})
