// Dépenses d'outils : lignes FABRIQUÉES à la lecture depuis les fiches (jamais écrites en base),
// sur le modèle de patternExpenseLines (pattern-price.js). Le prix d'un outil est unitaire :
// `lineAmount` en fait déjà le produit avec la quantité.
import { hasPrice } from '@/utils/price-currency'

export function toolExpenseLine(tool) {
  return {
    id: `tool:${tool.id}`,
    category: 'tool',
    toolId: tool.id,
    kind: 'buy',
    quantity: tool.quantity,
    unitPrice: tool.price,
    currency: tool.priceCurrency || '',
    date: tool.purchasedAt || '',
  }
}

// Seuls les prix déclarés (`0` compris) donnent une ligne. Un outil prêté, perdu ou abîmé reste
// une dépense faite.
export function toolExpenseLines(tools) {
  return (tools || []).filter((t) => hasPrice(t?.price)).map(toolExpenseLine)
}
