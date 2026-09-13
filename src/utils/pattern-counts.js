// Compte les patrons par catégorie, pour les pastilles de filtre de la bibliothèque.
//
// Module PUR (aucune dépendance au store) : testable isolément.
//
// Règle assumée : un patron sans catégorie, ou porteur d'une catégorie hors catalogue,
// compte dans le TOTAL mais dans aucune pastille. La somme des 9 catégories peut donc être
// inférieure au total affiché sur « Tous ». C'est voulu — le patron reste accessible sous
// « Tous », rien n'est perdu.
import { PATTERN_CATEGORIES } from '@/constants/catalog'

export function countByCategory(patterns) {
  const list = Array.isArray(patterns) ? patterns : []
  // Objet sans prototype : une catégorie qui s'appellerait « constructor » ou « toString »
  // ne peut alors pas heurter une propriété héritée.
  const byCategory = Object.create(null)
  for (const c of PATTERN_CATEGORIES) byCategory[c] = 0
  for (const p of list) {
    const c = p?.category
    if (c && c in byCategory) byCategory[c] += 1
  }
  return { total: list.length, byCategory }
}
