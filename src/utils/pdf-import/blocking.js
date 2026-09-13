// Détection PURE des cas d'import non gérés. Renvoie un descripteur de
// blocage RÉVERSIBLE : l'UI l'affiche mais propose « Importer quand même » (règle
// « jamais perdre d'info »). Couvre les colonnes et, depuis une extension
// ultérieure, multiPattern.

// Nombre de pages dé-colonnées en ≥3 colonnes (chaque ligne d'une telle page porte
// `multiCol`, posé par lines.js). Signal géométrique mesuré, pas une promesse : les faux
// « colonnes » d'autrefois (sous-blocs indentés dans une colonne légitime, mesuré Cortina
// EN p.2 le 23/07 — 26 rangées piétinées vs 4 occupées) sont écartés depuis le 04/09 par
// la garde « ratio d'occupation du couloir » de detectColumns ; restent de vraies pages
// ≥3 colonnes, tableaux multi-tailles compris (sectionnés colonne par colonne, pas
// mélangés — ex. klara, glow-check, défaut de lecture de tableau connu). Corpus au 04/09 :
// 138 → 107 PDF bloqués « columns » (202 → 158 pages multiCol). L'échappatoire « Importer
// quand même » reste la soupape (haute précision visée, pas 100 %).
export function countMultiColPages(pages) {
  return (pages || []).filter((p) => Array.isArray(p) && p.some((l) => l && l.multiCol)).length
}

// En-tête « matériel / fournitures » (multilingue). Best-effort : un patron unique a EN
// GÉNÉRAL une seule occurrence, mais ce n'est pas garanti (page de couverture qui répète
// l'en-tête, patron multilingue en un seul PDF) — mesuré à 1,15 % de faux positifs sur le
// corpus réel (36/3122 PDF, 0 vrai livre parmi eux). ≥2 sur un document assez long reste un
// signal utile pour un livre/recueil ; l'échappatoire « Importer quand même »
// compense les faux positifs restants (haute précision visée, pas 100 %).
const MATERIALS_HEADING_RE =
  /^\s*(?:mat[eé]riel|fournitures|materials?|you\s+will\s+need|materiaal|benodigdheden|material(?:i|es)?)\s*:?\s*$/i
const MIN_BOOK_PAGES = 4 // en-dessous, 2 en-têtes = trop peu de signal (faux positifs)

export function detectMultiPattern(pages) {
  if (!Array.isArray(pages) || pages.length < MIN_BOOK_PAGES) return false
  let count = 0
  for (const p of pages) {
    if (Array.isArray(p) && p.some((l) => l && MATERIALS_HEADING_RE.test(String(l.text || '')))) count += 1
  }
  return count >= 2
}

export function computeBlocking(pages) {
  const reasons = []
  if (countMultiColPages(pages) > 0) reasons.push('columns')
  if (detectMultiPattern(pages)) reasons.push('multiPattern')
  return { blocked: reasons.length > 0, reasons }
}
