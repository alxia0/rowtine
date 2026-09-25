// Formatage et conversion des quantités du stock de laines.
//
// Module PUR : locale, système d'unités et devise sont des PARAMÈTRES, jamais lus depuis un
// store. C'est ce qui le rend testable isolément — et donc vérifiable par mutation.
//
// DEUX NATURES DIFFÉRENTES, à ne pas confondre :
//
//   - Les unités (métrique/impérial) sont une CONVERSION réelle et réversible. 100 m SONT
//     109,361 yd. Les données restent stockées en mètres et en grammes ; on convertit à
//     l'affichage et à la saisie. Basculer de système n'abîme aucune fiche.
//   - La devise est une ÉTIQUETTE. « 12,50 » ne peut pas être à la fois 12,50 € et 12,50 $,
//     et il n'existe pas de taux de change hors ligne. On ne convertit JAMAIS un montant.
//
// Règles de bascule (décisions produit, 25/07) :
//   - métrique : au-delà de 1 000, unité supérieure avec 3 décimales max (précision au mètre
//     et au gramme près — règle « jamais perdre d'info ») ;
//   - impérial : les yards ne basculent jamais (personne ne mesure sa laine en miles), les
//     onces passent en livres à 16 oz.
// Zéros de fin supprimés partout : 2 000 m s'écrit « 2 km », jamais « 2,000 km ».
//
// DEUX PROFILS, parce qu'un cumul et une pelote n'ont pas les mêmes besoins :
//   - 'total'  : récap du stock, tuile d'accueil, poids cumulé d'une carte → bascule autorisée ;
//   - 'detail' : métrage d'une pelote, fiche détail → JAMAIS de bascule (« 1,2 km » pour un
//     écheveau serait absurde), mais des décimales en impérial car la conversion en produit.

import { parseDecimal } from '@/utils/decimal'

export const M_PER_YD = 0.9144 // exact par définition
export const G_PER_OZ = 28.349523125 // exact par définition
export const OZ_PER_LB = 16

const THRESHOLD = 1000 // seuil métrique m→km et g→kg
const MAX_DECIMALS = 3

// Tolère la virgule décimale : des fiches anciennes stockent parfois la saisie brute
// telle quelle (ex. `lengthM: '87,5'`, clavier numérique Android). `Number('87,5')` rend
// NaN — sans ce repli, une fiche ancienne à virgule s'affiche « 0 » au lieu de sa vraie
// valeur (perte d'info silencieuse, pas juste masquée). Cf. `parseDecimal`.
function num(value) {
  const n = parseDecimal(value)
  return Number.isFinite(n) ? n : 0
}

// Intl fournit gratuitement la virgule française, le point anglais, les séparateurs de
// milliers et la suppression des zéros de fin.
//
// `useGrouping` n'est explicité (à `false`) que sur le profil 'detail' : le métrage d'une
// pelote (ex. 1 200 m) est une valeur unique lue d'un coup d'œil, pas un cumul — le séparateur
// de milliers n'y ajoute rien et gênerait la lecture d'un nombre de toute façon court.
// Ailleurs, l'argument reste `undefined` : Intl retombe alors sur SON défaut par locale (pas
// forcément « toujours grouper » — l'espagnol par ex. ne groupe pas un nombre à 4 chiffres par
// défaut). Passer `true` explicitement changerait ce comportement pour les locales déjà
// livrées d'emblée ; seul `false` doit jamais être forcé ici.
function fmt(value, locale, maximumFractionDigits, useGrouping) {
  return new Intl.NumberFormat(locale || 'fr', { maximumFractionDigits, useGrouping }).format(
    value,
  )
}

function isImperial(system) {
  return system === 'imperial'
}

// Partagé par `formatLength` et `formatWeight` : la bascule métrique (unité simple vs unité
// ×1000) suit exactement la même règle pour les mètres/km que pour les grammes/kg, seuls les
// libellés d'unité changent. Les branches impériales, elles, diffèrent réellement (yards jamais
// convertis, once/livre au seuil 16) et restent propres à chaque fonction.
function formatMetricScaled(v, locale, profile, unitKey, scaledUnitKey) {
  const rounded = Math.round(v)
  // Le seuil se compare à la valeur ARRONDIE : sinon 999,5 reste « sous 1000 » pour la
  // bascule alors que l'affichage l'arrondit à 1 000 — un nombre à 4 chiffres avec la
  // mauvaise unité (correctif de revue finale).
  if (profile === 'detail' || Math.abs(rounded) < THRESHOLD) {
    const grouping = profile === 'detail' ? false : undefined
    return { text: fmt(rounded, locale, 0, grouping), unitKey }
  }
  return { text: fmt(v / THRESHOLD, locale, MAX_DECIMALS), unitKey: scaledUnitKey }
}

// --- Longueur ---------------------------------------------------------------

export function formatLength(meters, { locale, system, profile = 'total' } = {}) {
  const v = num(meters)
  if (isImperial(system)) {
    const yd = v / M_PER_YD
    // Jamais de mile : les milliers de yards se lisent au séparateur de milliers (profil total
    // seulement — le détail n'en a pas besoin, cf. `fmt`).
    const decimals = profile === 'detail' ? 2 : 0
    const grouping = profile === 'detail' ? false : undefined
    return { text: fmt(yd, locale, decimals, grouping), unitKey: 'yarn.unit.yd' }
  }
  return formatMetricScaled(v, locale, profile, 'yarn.unit.m', 'yarn.unit.km')
}

// --- Poids ------------------------------------------------------------------

export function formatWeight(grams, { locale, system, profile = 'total' } = {}) {
  const v = num(grams)
  if (isImperial(system)) {
    const oz = v / G_PER_OZ
    // Le profil détail reste en onces : « 0,5 lb » pour une pelote ne se dit pas.
    if (profile === 'detail') return { text: fmt(oz, locale, 2, false), unitKey: 'yarn.unit.oz' }
    if (oz < OZ_PER_LB) return { text: fmt(oz, locale, 1), unitKey: 'yarn.unit.oz' }
    return { text: fmt(oz / OZ_PER_LB, locale, MAX_DECIMALS), unitKey: 'yarn.unit.lb' }
  }
  return formatMetricScaled(v, locale, profile, 'yarn.unit.g', 'yarn.unit.kg')
}

// --- Saisie -----------------------------------------------------------------
//
// `toInput` et `fromInput` sont exactement symétriques : ce sont elles qui garantissent
// qu'un aller-retour par le formulaire ne perd rien. Elles ne formatent PAS pour la lecture
// (pas de séparateur de milliers, qui casserait la saisie) : elles préparent une valeur
// éditable.

// 3 décimales, pas 2 : avec seulement 2 décimales d'once, l'arrondi de saisie introduit
// jusqu'à ~0,14 g d'écart au retour en grammes (0,5 × 0,01 × G_PER_OZ) — trop pour un
// aller-retour fidèle. 3 décimales ramènent l'écart sous 0,02 g, largement sous le gramme.
const INPUT_DECIMALS = 3

export function toInput(canonical, { system, kind } = {}) {
  // Une valeur absente doit rendre un champ VIDE, jamais « 0 » : « 0 » ferait croire à une
  // valeur saisie et se retrouverait en base au premier enregistrement.
  if (canonical === '' || canonical == null) return ''
  // Tolère une valeur canonique stockée en chaîne à virgule décimale (fiches anciennes,
  // qui stockaient parfois la saisie brute telle quelle, ex. `grams: '4,5'`) —
  // symétrique de `fromInput` qui tolère déjà cette virgule. Sans ce repli, `Number('4,5')`
  // rend NaN et le champ s'afficherait VIDE pour une fiche existante : la seule vue où
  // cette valeur restait visible et corrigeable la ferait disparaître — perte
  // d'information silencieuse, pire encore que muette puisque le champ devenait alors
  // invidable (le vider aurait redonné la même chaîne que la référence).
  const v = parseDecimal(canonical)
  if (!Number.isFinite(v)) return ''
  // Décimale française partout dans les champs visibles, y compris en métrique (où seule
  // la représentation change, jamais la valeur) : les entiers restent sans décimale
  // (« 100 », pas « 100,0 »), `String(v)` n'a alors aucun point à remplacer.
  if (!isImperial(system)) return String(v).replace('.', ',')
  const converted = kind === 'weight' ? v / G_PER_OZ : v / M_PER_YD
  // Virgule décimale : c'est ce que le clavier numérique Android produit en français, et
  // `fromInput` la retolère de toute façon.
  return String(Number(converted.toFixed(INPUT_DECIMALS))).replace('.', ',')
}

export function fromInput(text, { system, kind } = {}) {
  if (text === '' || text == null) return ''
  // Tolère la virgule décimale (saisie FR, clavier Android).
  const v = parseDecimal(text)
  if (!Number.isFinite(v)) return ''
  if (!isImperial(system)) return v
  return kind === 'weight' ? v * G_PER_OZ : v * M_PER_YD
}

// --- Montants ---------------------------------------------------------------
//
// AUCUNE CONVERSION, JAMAIS. La devise décide du symbole affiché et de sa place ; le nombre
// est rendu tel qu'il a été saisi. Changer de devise re-libelle les montants existants sans
// les recalculer — c'est dit explicitement à l'utilisatrice au moment du changement.

// `narrowSymbol` donne « $ » plutôt que « $US ». Il n'existe pas sur les WebView Android
// anciens : repli sur `symbol`, puis sur le code brut, pour ne jamais faire écran blanc à
// cause d'un réglage.
export function currencySymbol(currency, locale) {
  for (const currencyDisplay of ['narrowSymbol', 'symbol']) {
    try {
      const parts = new Intl.NumberFormat(locale || 'fr', {
        style: 'currency',
        currency,
        currencyDisplay,
      }).formatToParts(0)
      const sym = parts.find((p) => p.type === 'currency')?.value
      if (sym) return sym
    } catch {
      // devise inconnue ou option non supportée : on tente le repli suivant
    }
  }
  return String(currency || '')
}

export function formatMoney(amount, { locale, currency, profile = 'total' } = {}) {
  const v = num(amount)
  if (profile === 'detail') {
    // Un montant ROND s'écrit sans centimes (« 1 475 € », jamais « 1 475,00 € ») ; un
    // montant à centimes garde ses deux décimales (« 12,50 € », jamais « 12,5 € », qui
    // perdrait le zéro de fin). Décision produit (revue du 26/07) : cette règle vaut
    // PARTOUT où le profil `detail` est utilisé, pas seulement à l'accueil — pas de 3ᵉ
    // profil. `minimumFractionDigits` seul varie ; `maximumFractionDigits` reste à 2 dans
    // les deux cas (jamais plus de 2 décimales affichées).
    const minFractionDigits = Number.isInteger(v) ? 0 : 2
    for (const currencyDisplay of ['narrowSymbol', 'symbol']) {
      try {
        const formatter = new Intl.NumberFormat(locale || 'fr', {
          style: 'currency',
          currency,
          currencyDisplay,
          maximumFractionDigits: 2,
          minimumFractionDigits: minFractionDigits,
        })
        const text = formatter.format(v)
        // `currencySymbol` (même fichier) plutôt qu'une extraction locale sur ce formateur :
        // même repli narrowSymbol → symbol → code brut, jamais '' si `formatToParts` échoue
        // à isoler la devise — un vrai gain de robustesse, pas seulement moins de code.
        return { text, unitKey: null, symbol: currencySymbol(currency, locale) }
      } catch {
        // repli
      }
    }
    return { text: `${fmt(v, locale, 2)} ${currency || ''}`.trim(), unitKey: null, symbol: '' }
  }
  // Total : le centime n'a pas de sens sur un cumul de stock. Le symbole part dans le
  // libellé sous le chiffre (« € dépensés »), pas dans le chiffre lui-même.
  return {
    text: fmt(Math.round(v), locale, 0),
    unitKey: 'yarn.spent',
    symbol: currencySymbol(currency, locale),
  }
}

// Montant NU, sans symbole : pour un champ dont le libellé porte déjà la devise (prix d'une
// pelote sur la fiche laine). Même règle de centimes que le profil 'detail' de `formatMoney` :
// un montant rond sans décimales, sinon deux décimales (« 3,20 », jamais « 3,2 »).
export function formatAmount(amount, { locale } = {}) {
  const v = num(amount)
  const digits = Number.isInteger(v) ? 0 : 2
  return new Intl.NumberFormat(locale || 'fr', {
    minimumFractionDigits: digits,
    maximumFractionDigits: 2,
  }).format(v)
}
