// tests/unit/tool-expense.spec.js
// Lignes de dépense fabriquées depuis les prix d'outils : forme, prix déclaré, montant.
import { describe, it, expect } from 'vitest'
import { toolExpenseLine, toolExpenseLines } from '@/utils/tool-expense'
import { lineAmount } from '@/utils/purchases'

const tool = (over = {}) => ({
  id: 5, type: 'circular', price: '12', priceCurrency: 'EUR', quantity: 1, purchasedAt: '2026-04-02', status: 'available', ...over,
})

describe('toolExpenseLines', () => {
  it('prix vide ⇒ aucune ligne ; "0" ⇒ une ligne (gratuit déclaré)', () => {
    expect(toolExpenseLines([tool({ price: '' })])).toEqual([])
    expect(toolExpenseLines([tool({ price: '0' })])).toHaveLength(1)
  })

  it('forme de la ligne : id, catégorie, devise et date de la fiche', () => {
    expect(toolExpenseLine(tool())).toEqual({
      id: 'tool:5', category: 'tool', toolId: 5, kind: 'buy', quantity: 1, unitPrice: '12', currency: 'EUR', date: '2026-04-02',
    })
  })

  it('prix 10 × quantité 2 ⇒ montant 20', () => {
    expect(lineAmount(toolExpenseLine(tool({ price: 10, quantity: 2 })))).toBe(20)
  })

  it('un outil perdu avec un prix reste une dépense', () => {
    expect(toolExpenseLines([tool({ status: 'lost' })])).toHaveLength(1)
  })

  it('liste absente ⇒ tableau vide', () => {
    expect(toolExpenseLines(null)).toEqual([])
  })
})
