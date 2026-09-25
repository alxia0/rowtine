import { YARN_BRANDS } from '@/constants/catalog'
import { COLOR_PALETTE, paletteColorLabel } from '@/constants/swatch'
import { M_PER_YD } from '@/utils/units'

// Valeur `Weight` Ravelry (« Worsted (9 wpi) », « Super Bulky »…) → clé YARN_WEIGHTS, par
// mot-clé dans la valeur normalisée. « superbulky » AVANT « bulky » : sinon « super bulky »
// matcherait « bulky » en premier. Valeur non reconnue → '' (jamais un bucket approché).
const WEIGHT_KEYWORDS = [
  ['superbulky', ['super bulky', 'jumbo']],
  ['bulky', ['bulky']],
  ['aran', ['aran']],
  ['worsted', ['worsted']],
  ['dk', ['dk']],
  ['sport', ['sport']],
  ['fingering', ['fingering']],
  ['lace', ['lace', 'cobweb']],
]
function mapWeight(raw) {
  const norm = String(raw || '').toLowerCase()
  if (!norm) return ''
  for (const [key, keywords] of WEIGHT_KEYWORDS) {
    if (keywords.some((kw) => norm.includes(kw))) return key
  }
  return ''
}

// Cale une marque Ravelry sur son orthographe du catalogue rowtine si elle y figure
// (comparaison insensible à la casse), sinon gardée telle quelle (marque hors catalogue,
// saisie libre déjà tolérée par YarnEditView.vue).
function mapBrand(raw) {
  const value = String(raw || '').trim()
  if (!value) return ''
  const hit = YARN_BRANDS.find((b) => b.toLowerCase() === value.toLowerCase())
  return hit || value
}

// « Closest color? » d'une fiche Ravelry (colonne « Color family » de l'export, toujours en
// anglais quelle que soit la langue du site) → pastille de la palette rowtine. Les 20 valeurs
// relevées sur ravelry.com le 23/09/2026 ; Multicolored et Rainbow n'ont pas de pastille.
const PALETTE_BY_COLOR_FAMILY = {
  black: 'noir', blue: 'bleu', 'blue-green': 'turquoise', 'blue-purple': 'lavande', brown: 'marron',
  gray: 'gris', green: 'vert', 'natural/undyed': 'ecru', orange: 'orange', pink: 'rose',
  purple: 'violet', red: 'rouge', 'red-orange': 'corail', 'red-purple': 'prune', white: 'blanc',
  yellow: 'jaune', 'yellow-green': 'kaki', 'yellow-orange': 'moutarde',
}
function paletteForColorFamily(raw) {
  const key = PALETTE_BY_COLOR_FAMILY[String(raw || '').trim().toLowerCase()]
  return key ? COLOR_PALETTE.find((c) => c.key === key) || null : null
}

// Une cellule de CSV arrive en chaîne brute (cf. parse.js) : espaces de milliers (dont
// insécables) retirés, virgule décimale ramenée au point, comme `parseDecimal` (decimal.js).
function toNumber(raw) {
  if (raw === '' || raw == null) return null
  const n = typeof raw === 'string' ? Number(raw.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.')) : Number(raw)
  return Number.isFinite(n) ? n : null
}

function round2(n) {
  return Math.round(n * 100) / 100
}

// `Purchase date` : le fichier stash Ravelry porte une chaîne AAAA-MM-JJ (vérifié sur deux
// fichiers réels), mais une cellule Excel FORMATÉE en date reviendrait de la lib `xlsx` sous
// forme d'objet `Date`, les deux formes sont donc acceptées.
//
// Composantes UTC, jamais locales : `parse.js` lit le classeur avec `cellDates: true`, et
// SheetJS ancre alors la date à minuit UTC du jour calendaire visé (vérifié empiriquement),
// quel que soit le fuseau de la machine. Extraire via les composantes UTC redonne donc
// toujours le bon jour. `ymdLocal()` (composantes LOCALES) serait ici un vrai bug : sur une
// machine à l'ouest de Greenwich (ex. America/Los_Angeles), ce même instant minuit UTC
// retombe encore la veille en heure locale, ce qui décalerait la date d'achat importée d'un
// jour. Ne PAS reprendre `toISOString()` suivi d'un `slice` des 10 premiers caractères non
// plus : motif interdit partout dans src/ par tests/unit/aujourdhui-heure-locale.spec.js
// (même s'il donnerait ici le même résultat que les composantes UTC, puisque `toISOString()`
// est lui-même toujours en UTC).
function toDateString(raw) {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const y = raw.getUTCFullYear()
    const m = String(raw.getUTCMonth() + 1).padStart(2, '0')
    const d = String(raw.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  // Chaîne : seule une date ISO est gardée. Une date non ISO (CSV retouché, « 09/25/2026 »,
  // « 25/09/2026 ») casserait le classement par année/mois de purchases.js, et l'ordre
  // jour/mois y est ambigu : elle part en note (cf. mapRow), la date d'achat reste vide.
  const text = String(raw || '').trim()
  const iso = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/.exec(text)
  return iso ? iso[1] : ''
}

function trimmed(raw) {
  return String(raw ?? '').trim()
}

export function mapRow(row) {
  const skeins = toNumber(row.skeins)
  const priceTotal = toNumber(row.pricePaid)
  const unitPrice = priceTotal == null ? '' : skeins ? round2(priceTotal / skeins) : priceTotal

  const metersPerSkein = toNumber(row.metersPerSkein)
  const yardsPerSkein = toNumber(row.yardsPerSkein)
  const lengthM =
    metersPerSkein != null ? metersPerSkein : yardsPerSkein != null ? round2(yardsPerSkein * M_PER_YD) : ''

  // Annexes ajoutées SEULEMENT si non vides : aucun de ces 3 champs n'a d'équivalent
  // structuré fiable côté rowtine (cf. spec, section « Décisions »).
  const notesParts = []
  const comments = trimmed(row.comments)
  if (comments) notesParts.push(comments)
  // Couleur : le Colorway donne le nom ; à défaut, Closest color (Color family) le fournit,
  // sous le nom de sa pastille s'il en a une (comme un choix de pastille à la main). La
  // pastille, elle, vient toujours de Closest color. Color family ne part en annexe que
  // si elle n'a servi à rien d'autre (pas de pastille ET un Colorway déjà présent).
  const colorway = trimmed(row.colorway)
  const colorFamily = trimmed(row.colorFamily)
  const swatch = paletteForColorFamily(colorFamily)
  const familyName = swatch ? paletteColorLabel(swatch.key) : colorFamily
  const colorNameFromFamily = !colorway && !!familyName
  if (colorFamily && !swatch && colorway) notesParts.push(`Color family : ${colorFamily}`)
  const colorAttributes = trimmed(row.colorAttributes)
  if (colorAttributes) notesParts.push(`Color attributes : ${colorAttributes}`)
  const purchaseDate = toDateString(row.purchaseDate)
  const rawPurchaseDate = row.purchaseDate instanceof Date ? '' : trimmed(row.purchaseDate)
  if (rawPurchaseDate && !purchaseDate) notesParts.push(`Purchase date : ${rawPurchaseDate}`)
  const tagList = trimmed(row.tagList)
  if (tagList) notesParts.push(`Tags : ${tagList}`)

  const yarn = {
    brand: mapBrand(row.brand),
    model: trimmed(row.model),
    colorName: colorway || familyName,
    color: swatch ? swatch.hsl : '',
    weight: mapWeight(row.weight),
    grams: toNumber(row.gramsPerSkein) ?? '',
    lengthM,
    quantity: toNumber(row.remainingSkeins) ?? 0,
    storedIn: trimmed(row.storedIn),
    notes: notesParts.join('\n'),
  }
  const purchase = {
    quantity: skeins ?? 0,
    bain: trimmed(row.dyeLot),
    date: purchaseDate,
    unitPrice,
    purchasedFrom: trimmed(row.purchasedAt),
  }
  return { yarn, purchase, colorNameFromFamily }
}
