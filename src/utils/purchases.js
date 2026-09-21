// src/utils/purchases.js
// Calculs du budget laine — PURS : aucune dépendance à Dexie, Pinia ou Vue, pour
// rester testables sans base et réutilisables par la fiche, l'écran Dépenses et
// l'accueil sans les faire diverger (leçon du récap de stock dupliqué, 17/07).
import { parseDecimal } from '@/utils/decimal'
import { consumedOf, reservationsOf } from '@/utils/yarn-usage'

// Une ligne d'historique. `kind` : 'buy' (acheté) | 'gift' (offert).
// `unitPrice` : prix d'UNE pelote, saisi (virgule française admise). Vide sur un
// cadeau, ou sur un achat dont le prix est inconnu — les deux cas valent 0 dans le
// budget mais ne se disent PAS la même chose à l'écran (cf. isPriceUnknown).
export function emptyPurchase() {
  return {
    yarnId: null,
    yarnLabel: '',
    kind: 'buy',
    quantity: 1,
    unitPrice: '',
    currency: '',
    date: '',
    bain: '',
    reconstructed: false,
    // Catégorie de dépense (lot « prix du patron », 07/08). Explicite sur les lignes NEUVES ;
    // les lignes déjà en base n'ont pas ce champ et n'ont pas à être réécrites — `categoryOf`
    // fait valoir l'absence pour 'yarn'.
    category: 'yarn',
  }
}

export function isPriceUnknown(line) {
  return line?.kind !== 'gift' && !String(line?.unitPrice ?? '').trim()
}

export function lineAmount(line) {
  if (!line || line.kind === 'gift') return 0
  const price = parseDecimal(line.unitPrice) || 0
  const qty = Number(line.quantity) || 0
  return price * qty
}

// Un objet { devise: montant } et non un nombre : l'app ne connaît aucun taux de
// change et n'additionnera jamais deux devises (cf. constants/currencies.js).
export function totalsByCurrency(lines) {
  const out = {}
  for (const line of lines || []) {
    const amount = lineAmount(line)
    if (!amount) continue
    const key = line.currency || ''
    out[key] = (out[key] || 0) + amount
  }
  return out
}

export function totalSkeins(lines) {
  return (lines || []).reduce((a, l) => a + (Number(l.quantity) || 0), 0)
}

// Ce que l'état du stock sous-entend avoir été acquis : les pelotes restantes PLUS
// celles déjà tricotées — `consumeYarn` déduit la consommation de `quantity` tout en
// la traçant dans `consumed` (utils/yarn-usage.js:112).
export function acquiredFromStock(yarn) {
  const rest = Number(yarn?.quantity) || 0
  const used = Object.values(consumedOf(yarn)).reduce((a, n) => a + (Number(n) || 0), 0)
  return rest + used
}

// Alias sémantique de `totalSkeins` côté « historique d'achats » (nom utilisé par `stockGap`
// ci-dessous et par YarnPurchases.vue) — délégué direct, jamais dupliqué, pour qu'il ne puisse
// pas diverger du vrai calcul (même parti pris que `startOfWeekMonday`, time-periods.js).
export const acquiredFromLines = totalSkeins

// Positif : le stock dépasse l'historique (achat non enregistré, ou cadeau).
// Négatif : l'historique dépasse le stock (pelotes sorties sans passer par un projet).
export function stockGap(yarn, lines) {
  return acquiredFromStock(yarn) - acquiredFromLines(lines)
}

// Date d'achat la plus récente parmi les lignes d'une laine — ce que le tri du stock et
// l'export CSV lisaient jusqu'ici dans `yarn.purchasedAt` (travaux sur le budget). ISO
// YYYY-MM-DD : l'ordre lexical EST l'ordre chronologique (même convention que
// stores/purchases.js:byRecentFirst). '' si aucune ligne n'a de date — jamais undefined,
// pour rester directement affichable/exportable.
export function latestPurchaseDate(lines) {
  let latest = ''
  for (const line of lines || []) {
    const d = String(line?.date || '')
    if (d && d > latest) latest = d
  }
  return latest
}

// Regroupe des lignes par année puis par mois (clé mois 'AAAA-MM'), plus récent
// D'ABORD — même convention chronologique que `byRecentFirst` (stores/purchases.js).
// Une ligne SANS date ('' ou absente) ne peut être rattachée à aucune période :
// au lieu d'être perdue ou noyée dans un groupe arbitraire (cf. règle « jamais
// perdre d'info »), elle forme un groupe à part, `year: ''` (« date inconnue »),
// PLACÉ EN DERNIER — son montant compte malgré tout dans le total de ce groupe
// (totalsByCurrency ne fait aucune exception pour une ligne sans date).
// Forme : [{ year, total: {devise: montant}, months: [{ month, total, lines }] }].
export function groupByPeriod(lines) {
  const dated = []
  const undated = []
  for (const line of lines || []) {
    if (String(line?.date || '').trim()) dated.push(line)
    else undated.push(line)
  }

  const byYear = new Map()
  for (const line of dated) {
    const year = line.date.slice(0, 4)
    const month = line.date.slice(0, 7)
    if (!byYear.has(year)) byYear.set(year, new Map())
    const byMonth = byYear.get(year)
    if (!byMonth.has(month)) byMonth.set(month, [])
    byMonth.get(month).push(line)
  }

  // Tri décroissant (chaînes 'AAAA'/'AAAA-MM' : l'ordre lexical EST l'ordre
  // chronologique, même convention que `latestPurchaseDate` ci-dessus).
  const desc = (a, b) => (a < b ? 1 : a > b ? -1 : 0)

  // Ordre des LIGNES à l'intérieur d'un même mois : plus récent d'abord — même
  // convention que `byRecentFirst` (stores/purchases.js) et que le bloc « Achats
  // et cadeaux » de la fiche laine (YarnPurchases.vue). Sans ce tri explicite, les
  // lignes sortiraient dans l'ordre où `usePurchasesStore` les a chargées (id
  // décroissant, cf. `load()`) — un ordre qui coïncide avec la date SEULEMENT si
  // les lignes ont été saisies dans l'ordre chronologique, ce qui n'est pas
  // garanti (une ligne ancienne peut être ajoutée après une récente).
  // Départage à date égale. `Number(...) || 0` et non `l.id || 0` : les lignes de dépense de
  // PATRON portent un identifiant en chaîne (`'pat:11'`, cf. src/utils/pattern-price.js), et
  // une soustraction dessus produirait `NaN` — un comparateur qui renvoie `NaN` ne trie pas,
  // il rend l'ordre INDÉTERMINÉ sans lever la moindre erreur. Toutes les lignes de patron se
  // retrouvent donc à rang 0 : elles sont départagées par l'ordre d'entrée, stable et
  // déterministe (tri stable en JavaScript depuis ES2019, et `patternExpenseLines` parcourt
  // les patrons dans l'ordre du magasin).
  const rank = (l) => Number(l?.id) || 0
  const byDateDesc = (a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    return rank(b) - rank(a)
  }

  const groups = [...byYear.keys()].sort(desc).map((year) => {
    const byMonth = byYear.get(year)
    const months = [...byMonth.keys()].sort(desc).map((month) => {
      const monthLines = [...byMonth.get(month)].sort(byDateDesc)
      return { month, total: totalsByCurrency(monthLines), lines: monthLines }
    })
    return { year, total: totalsByCurrency(months.flatMap((m) => m.lines)), months }
  })

  // Groupe « date inconnue » : toujours en dernier, jamais inséré au tri normal
  // (une année '' se retrouverait en tête d'un tri décroissant de chaînes).
  if (undated.length) {
    const undatedSorted = [...undated].sort(byDateDesc) // dates toutes vides : départagé par id décroissant
    groups.push({
      year: '',
      total: totalsByCurrency(undatedSorted),
      months: [{ month: '', total: totalsByCurrency(undatedSorted), lines: undatedSorted }],
    })
  }

  return groups
}

// Années réellement présentes dans l'historique (lignes DATÉES uniquement),
// dédoublonnées, plus récentes d'abord — alimente le sélecteur d'année de
// l'écran Dépenses (retour d'usage, 01/08). Même convention de tri
// décroissant que `groupByPeriod` ci-dessus (l'ordre lexical d'une chaîne
// 'AAAA' EST l'ordre chronologique). Une ligne sans date ne contribue à
// aucune année ici — cf. `filterByYear` pour le choix « sans date » séparé.
export function yearsOf(lines) {
  const years = new Set()
  for (const line of lines || []) {
    const d = String(line?.date || '').trim()
    if (d) years.add(d.slice(0, 4))
  }
  return [...years].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
}

// Filtre du sélecteur d'année de l'écran Dépenses. Trois formes : 'all' (ou
// toute valeur absente) ne filtre rien — comportement historique de l'écran ;
// une année 'AAAA' ne garde que les lignes DONT `date` commence par cette
// année ; 'unknown' ne garde QUE les lignes sans date — sans ce troisième
// choix, une ligne sans date deviendrait inatteignable dès qu'un filtre
// d'année est actif (cf. règle « jamais perdre d'info »). Même découpage
// daté/non-daté que `groupByPeriod`, pour que filtre et regroupement
// racontent toujours la même histoire.
export function filterByYear(lines, year) {
  if (!year || year === 'all') return lines || []
  if (year === 'unknown') return (lines || []).filter((l) => !String(l?.date || '').trim())
  // .trim() D'ABORD, comme `yearsOf` ci-dessus : sans lui, une date avec un espace
  // parasite (" 2026-01-10") apparaîtrait dans le menu comme "2026" (yearsOf trime)
  // mais ne correspondrait à AUCUN filtre ici (slice(0, 4) donnerait " 202"), ni à
  // "Date inconnue" (la chaîne trimée n'est pas vide) — introuvable sous tout
  // filtre sauf "Toutes les années".
  return (lines || []).filter((l) => String(l?.date || '').trim().slice(0, 4) === year)
}

// Bains distincts parmi les lignes d'une laine, dédoublonnés et joints par ' · ', DANS
// L'ORDRE D'APPARITION (pas trié alphabétiquement) — même convention de jointure que
// `purchaseLabel` (StashView.vue) pour rester cohérent à l'écran. '' si aucune ligne n'a
// de bain renseigné.
export function bainsOf(lines) {
  const seen = []
  for (const line of lines || []) {
    const b = String(line?.bain || '').trim()
    if (b && !seen.includes(b)) seen.push(b)
  }
  return seen.join(' · ')
}

// ─── Catégories de dépense (lot « prix du patron », 07/08) ──────────────────
// Deux catégories : la laine (lignes de `db.purchases`) et les patrons (lignes fabriquées à
// la lecture par src/utils/pattern-price.js). L'ABSENCE de `category` VAUT 'yarn' : les
// lignes écrites avant ce lot n'ont pas le champ, et on ne réécrit RIEN en base pour un
// défaut de lecture qui coûte une ligne.
export function categoryOf(line) {
  return line?.category === 'pattern' ? 'pattern' : 'yarn'
}

// 'all' (ou toute valeur absente) ne filtre rien — même convention que `filterByYear`.
export function filterByCategory(lines, category) {
  if (!category || category === 'all') return lines || []
  return (lines || []).filter((l) => categoryOf(l) === category)
}

// { catégorie: { devise: montant } }. Les DEUX clés existent toujours, même vides : l'appelant
// n'a pas à se garder contre un `undefined` avant de lire. Comme `totalsByCurrency`, dont
// cette fonction se sert, un montant nul ne crée aucune entrée de devise — un patron gratuit
// ne fait donc pas apparaître de devise fantôme dans la ventilation.
export function totalsByCategory(lines) {
  const out = { yarn: {}, pattern: {} }
  for (const cat of ['yarn', 'pattern']) {
    out[cat] = totalsByCurrency(filterByCategory(lines, cat))
  }
  return out
}

// Coût des laines imputées à UN projet (lot « coût total du projet », 08/08). PUR : aucune
// dépendance à Dexie, Pinia ou Vue — la fiche projet ne fait qu'appeler et formater.
//
// Deux quantités s'additionnent pour une même laine : ce que le projet a RÉSERVÉ et ce
// qu'il a DÉJÀ TRICOTÉ. Aucun double comptage : `consumeProjectReservation` (yarn-usage.js)
// retire la réservation au moment où elle devient consommation ; une laine qui porte les
// deux a bien été re-réservée APRÈS avoir été tricotée — deux lots réels de pelotes.
//
// `unknownCount` compte des LAINES, pas des pelotes : c'est ce que la fiche annonce
// (« 2 laine(s) sans prix noté »). Une chaîne vide = « je n'ai rien noté » ; un `'0'` = un
// prix DÉCLARÉ (« j'ai vérifié, c'était offert »), qui compte donc dans `pricedCount` —
// même arbitrage que `isPricedPattern` (pattern-price.js). Les confondre perdrait l'info.
export function projectYarnCost(yarns, projectId) {
  const out = { amount: 0, skeins: 0, unknownCount: 0, pricedCount: 0 }
  const pid = Number(projectId)
  // `Number(null)` et `Number('')` valent 0, qui EST « finite » : sans le `pid <= 0`, un id
  // absent irait chercher les allocations du projet fantôme n° 0 (les ids Dexie partent à 1)
  // — même garde que `setProjectReservation` (yarn-usage.js).
  if (!Number.isFinite(pid) || pid <= 0) return out
  for (const y of yarns || []) {
    const n = (reservationsOf(y)[pid] || 0) + (consumedOf(y)[pid] || 0)
    if (n <= 0) continue
    out.skeins += n
    const raw = String(y?.price ?? '').trim()
    if (!raw) {
      out.unknownCount++
      continue
    }
    out.pricedCount++
    out.amount += (parseDecimal(raw) || 0) * n
  }
  return out
}
