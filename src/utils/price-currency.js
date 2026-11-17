// src/utils/price-currency.js
import { parseDecimal } from '@/utils/decimal'
// Devise d'un prix de laine ou d'outil. Fonctions pures, sans accès à la base.

// Un prix « déclaré » : `0` et `'0'` comptent (une laine offerte a bien un prix, zéro) ;
// seuls vide, blanc, `null` et `undefined` n'en sont pas.
export function hasPrice(value) {
  return String(value ?? '').trim() !== ''
}

// Devise d'une fiche : la sienne si elle en porte une, sinon le repli (devise des réglages).
export function priceCurrencyOf(entity, fallback) {
  const own = String(entity?.priceCurrency ?? '').trim()
  return own !== '' ? entity.priceCurrency : fallback
}

// Totaux regroupés par devise : jamais une somme mêlée de monnaies différentes (la devise est
// une étiquette, pas un taux). Seules les entrées qui ont un prix (`hasPrice`, donc `0` compris)
// comptent ; une devise absente retombe sur `fallback`. Montant = prix × quantité (stock).
// (Nom distinct de `totalsByCurrency` de purchases.js, qui somme des lignes d'achat.)
export function stockTotalsByCurrency(items, fallback) {
  const out = {}
  for (const it of items || []) {
    if (!hasPrice(it?.price)) continue
    const price = parseDecimal(it.price) || 0
    const amount = (Number(it.quantity) || 0) * price
    const cur = priceCurrencyOf(it, fallback)
    out[cur] = (out[cur] || 0) + amount
  }
  return out
}
