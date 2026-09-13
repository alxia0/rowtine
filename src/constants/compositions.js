// Compositions de fil connues (Lot U1, stock/laines). Minuscules, sans « Autre » :
// l'UI ajoute « Autre » séparément (saisie libre) et ne doit pas la stocker ici.
export const COMPOSITIONS = [
  'laine', 'coton', 'acrylique', 'alpaga', 'mohair', 'soie',
  'lin', 'bambou', 'cachemire', 'polyamide', 'viscose',
]

// Nettoie une liste de compositions : trim, retire les vides, dédoublonne
// en gardant l'ordre de première apparition.
function cleanList(list) {
  const seen = new Set()
  const out = []
  for (const raw of list) {
    const item = String(raw).trim()
    if (!item || seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

// Normalise une composition en tableau. Accepte :
// - null/''/undefined → []
// - un tableau → nettoyé (trim, non vides, dédup)
// La tolérance à l'ancien format chaîne (« laine, coton ») a été retirée le 13/08/2026
// (ménage pré-1.0, réserve produit acceptée) — plus aucun producteur, plus aucune
// fiche laine en base ne la porte.
export function normalizeComposition(value) {
  if (value == null || value === '') return []
  if (Array.isArray(value)) return cleanList(value)
  return []
}

// Composition mise bout à bout SANS traduction : les matériaux du catalogue sortent avec
// leur clé, donc toujours en français. Seul appelant : la colonne « composition » de
// l'export tableur (`src/utils/yarn-filter.js`). Pour tout AFFICHAGE, utiliser
// `compositionText` plus bas, qui traduit dans la langue active.
export function compositionToText(arr) {
  return normalizeComposition(arr).join(', ')
}

// Libellé affichable d'UN matériau : traduit s'il appartient au catalogue (`COMPOSITIONS`),
// renvoyé tel quel sinon — une composition personnalisée saisie librement (« soie de bambou »)
// n'a pas de clé i18n et ne doit jamais lui être forcée. `t` est pris en paramètre : ce
// module ne dépend pas de vue-i18n, seul l'appelant (composant) le fait.
export function compositionLabel(item, t) {
  return COMPOSITIONS.includes(item) ? t(`yarn.compositions.${item}`) : item
}

// Texte affichable d'une composition complète (tableau) : chaque
// matériau passé par compositionLabel, joints par « , ». Corrige le défaut de
// YarnDetailDialog qui poussait la clé de catalogue brute (toujours en français) au lieu de
// la traduire dans la langue active (06/08/2026).
export function compositionText(value, t) {
  return normalizeComposition(value).map((item) => compositionLabel(item, t)).join(', ')
}
