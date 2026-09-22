// Recherche, tri et export CSV du stock de laines — extraits de StashView/SettingsView
// pour être testables seuls.

import { YARN_WEIGHTS } from '@/constants/catalog'
import { reservedTotal } from '@/utils/yarn-usage'
import { compositionToText, normalizeComposition } from '@/constants/compositions'
import { COLOR_PALETTE, isCustomColor } from '@/constants/swatch'
import { M_PER_YD, currencySymbol } from '@/utils/units'
import { parseDecimal } from '@/utils/decimal'
import { latestPurchaseDate, bainsOf } from '@/utils/purchases'
import { normalizeLabels, orderedLabels } from '@/constants/yarn-labels'

export function matchesQuery(yarn, query, t) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return true
  // On retire les champs vides avant de joindre : un gabarit à trous laisserait un double
  // espace (« drops  bleu glacier ») et casserait les recherches à deux mots sur les laines
  // sans modèle — c.-à-d. tout le stock d'avant l'ajout du champ.
  // Type de coloris : on cherche sur le LIBELLÉ traduit (« moucheté »), pas le code interne
  // (« mouchete ») — c'est ce que l'utilisateur voit et tape. `t` optionnel : un appelant qui
  // ne le fournit pas perd juste cette dimension de recherche, sans planter.
  const colorTypeLabel = yarn.colorType && yarn.colorType !== 'uni' && t ? t(`yarn.colorTypes.${yarn.colorType}`) : ''
  // Caractéristiques : on cherche sur le LIBELLÉ traduit, pas la clé interne — même règle
  // que le type de coloris ci-dessus. `t` optionnel : sans lui, on perd juste cette
  // dimension de recherche, sans planter.
  const labelLabels = t ? normalizeLabels(yarn.labels).map((k) => t(`yarn.labels.${k}`)).join(' ') : ''
  const foin = [yarn.brand, yarn.model, yarn.colorName, yarn.colorNotes, colorTypeLabel, labelLabels]
    .filter(Boolean).join(' ').toLowerCase()
  return foin.includes(q)
}

// Filtre du menu déroulant. Une clé vide (« Toutes les laines ») retient tout.
export function matchesLabel(yarn, labelKey) {
  if (!labelKey) return true
  return normalizeLabels(yarn?.labels).includes(labelKey)
}

// Sentinelle du menu déroulant « Marque » : regroupe les laines sans marque enregistrée.
// Exportée pour être partagée telle quelle entre StashView et ProjectEditView (même chaîne,
// jamais retapée à deux endroits).
export const NO_BRAND = '__none__'

// Filtre du menu déroulant « Marque ». Une clé vide (« Toutes les marques ») retient tout ;
// NO_BRAND ne retient que les laines sans marque enregistrée.
export function matchesBrand(yarn, brandKey) {
  if (!brandKey) return true
  const brand = String(yarn?.brand || '').trim()
  if (brandKey === NO_BRAND) return !brand
  return brand === brandKey
}

// Filtre du menu déroulant « Épaisseur ». Une clé vide (« Toutes ») retient tout.
export function matchesWeight(yarn, weightKey) {
  if (!weightKey) return true
  return yarn?.weight === weightKey
}

// Filtre du menu déroulant « Métrage (g) ». Une valeur vide (« Tous ») retient tout ; sinon
// les DEUX côtés passent par parseDecimal — l'égalité est numérique, donc une fiche ancienne
// stockée en chaîne (« 50 ») rattrape le menu « 50 ». Une laine sans métrage exploitable
// (vide, espaces seuls, non numérique, absente) ne matche AUCUNE valeur choisie : la garde
// sur le champ brut, trimée comme dans matchesBrand, est indispensable car Number('') === 0
// au même titre que parseDecimal(' ') — sans elle, une fiche vide ou d'espaces seuls
// passerait pour un 0 g et resterait visible sous le menu « 0 » (on ne fabrique jamais un 0).
export function matchesGrams(yarn, gramsValue) {
  if (gramsValue === '' || gramsValue == null) return true
  const brut = yarn?.grams
  if (brut == null || String(brut).trim() === '') return false
  const grams = parseDecimal(brut)
  return Number.isFinite(grams) && grams === parseDecimal(gramsValue)
}

// État d'engagement (libre/réservée/utilisée/partiellement utilisée) : contrairement aux
// autres critères, ce matcher reçoit l'état DÉJÀ DÉRIVÉ (yarnUsageState(...).state), pas la
// laine brute — l'état dépend de `projectsById`, que ce module ne connaît pas et ne doit
// pas connaître (module pur, sans dépendance au store projets).
export function matchesUsageState(state, filterValue) {
  return !filterValue || state === filterValue
}

// Sentinelle du menu déroulant « Couleur » : regroupe les laines dont la couleur est hors
// palette. Même mécanique que NO_BRAND ci-dessus : exportée pour être partagée telle quelle
// entre les vues (même chaîne, jamais retapée à deux endroits).
export const COLOR_CUSTOM = '__custom__'

// Famille de couleur d'une laine : la clé de l'entrée de COLOR_PALETTE dont le hsl est
// exactement celui stocké (la palette est ce que l'utilisatrice a pu choisir) ; sinon
// COLOR_CUSTOM si une couleur perso hors palette est enregistrée ; sinon '' — pas de
// couleur du tout, ce qui n'est ni l'une ni l'autre (et ne matche donc aucun filtre).
export function colorFamily(yarn) {
  const couleur = yarn?.color
  const entree = COLOR_PALETTE.find((c) => c.hsl === couleur)
  if (entree) return entree.key
  if (isCustomColor(couleur)) return COLOR_CUSTOM
  return ''
}

// Filtre du menu déroulant « Couleur ». Une clé vide (« Toutes ») retient tout ; une laine
// sans couleur (colorFamily === '') ne matche rien — pas même COLOR_CUSTOM.
export function matchesColorFamily(yarn, familyKey) {
  if (!familyKey) return true
  return colorFamily(yarn) === familyKey
}

// Filtre du menu déroulant « Matière ». Une clé vide (« Toutes ») retient tout ; sinon la
// matière doit figurer dans la composition normalisée (trim + dédoublonnage déjà faits par
// normalizeComposition — un tableau saisi avec doublons ne gêne donc pas le filtre).
export function matchesComposition(yarn, material) {
  if (!material) return true
  return normalizeComposition(yarn?.composition).includes(material)
}

// Tri par épaisseur = ordre réel du fil (lace → super bulky), pas alphabétique.
export function weightOrder(w) {
  const i = YARN_WEIGHTS.indexOf(w)
  return i === -1 ? YARN_WEIGHTS.length : i
}

// Tri du stock. `purchasedAt` : plus récent d'abord ; les laines sans date finissent
// en dernier (elles restent visibles — on ne perd jamais une ligne de stock).
//
// `linesFor(yarnId)` (les travaux sur le budget) : la date d'achat n'est plus un champ de la
// laine, elle se dérive des lignes de son historique (`usePurchasesStore().forYarn`).
// AVANT ce changement, le tri lisait encore `yarn.purchasedAt` — un champ qu'AUCUNE fiche
// créée depuis ne porte plus jamais (il a quitté le formulaire
// auparavant) : toute laine neuve dégénérait silencieusement en fin de liste, pour
// toujours. `linesFor` optionnel (défaut : aucune ligne) pour rester utilisable sans
// crash par un appelant qui ne connaît pas encore le registre d'achats.
export function sortYarns(list, sortBy, linesFor) {
  const parMarque = (a, b) => String(a.brand || '').localeCompare(String(b.brand || ''))

  if (sortBy === 'purchasedAt') {
    // Dates précalculées UNE fois, avant le tri (revue du 01/08) : `linesFor` fait un
    // filter() + sort() sur TOUTE la table d'achats à chaque appel (`forYarn`, stores/
    // purchases.js) — l'appeler DANS le comparateur aurait recalculé ça pour chaque paire
    // comparée (de l'ordre de 2·M·log M appels pour M laines), donc à chaque frappe dans la
    // recherche du stock (`filtered` réévalue `sortYarns` à chaque changement de `search`,
    // StashView.vue). La Map indexée par id est calculée une seule fois par appel de
    // `sortYarns`, le comparateur n'y fait plus que des lectures.
    const dates = new Map(list.map((y) => [y.id, latestPurchaseDate(linesFor ? linesFor(y.id) : [])]))
    return [...list].sort((a, b) => {
      const da = dates.get(a.id)
      const db = dates.get(b.id)
      if (!da && !db) return parMarque(a, b)
      if (!da) return 1 // a sans date -> après
      if (!db) return -1 // b sans date -> après
      return db.localeCompare(da) || parMarque(a, b) // ISO YYYY-MM-DD : ordre lexical = ordre chrono
    })
  }

  if (sortBy === 'weight') {
    return [...list].sort((a, b) => weightOrder(a.weight) - weightOrder(b.weight) || parMarque(a, b))
  }

  return [...list].sort(parMarque)
}

// Précision de la longueur convertie en yards : 2 décimales, la même que le profil 'detail'
// de formatLength (src/utils/units.js) pour une pelote — assez pour rester fidèle, jamais
// une longue fraction du type « 229.65879265... » illisible dans un tableur.
const EXPORT_LENGTH_DECIMALS = 2

// Convertit la longueur pour l'export si le système est impérial ; sinon la valeur stockée
// telle quelle. Tolère une valeur vide/absente (ne fabrique jamais un 0) et une valeur non
// numérique (fiche ancienne stockée en chaîne) — symétrique des règles de `toInput`.
//
// La décimale suit la LOCALE de l'export, pas un défaut JS : un nombre JS converti en texte
// (`String(229.66)`) porte toujours un point, quelle que soit la locale — dans un CSV à
// point-virgule destiné à Excel francophone, ce point ferait lire la colonne longueur comme
// du TEXTE pendant que la colonne prix (déjà en virgule, saisie telle quelle) serait lue
// comme un nombre. Seul l'anglais utilise le point ; allemand et espagnol utilisent la
// virgule décimale comme le français (passage multilingue, 29/07) — un CSV dont le
// séparateur décimal ne correspond pas aux attentes du tableur de l'utilisatrice s'ouvre en
// colonnes cassées. Revue finale du 26/07.
function exportLength(lengthM, system, locale) {
  if (system !== 'imperial') return lengthM
  if (lengthM === '' || lengthM == null) return lengthM
  const meters = parseDecimal(lengthM)
  if (!Number.isFinite(meters)) return lengthM
  const factor = 10 ** EXPORT_LENGTH_DECIMALS
  const yards = Math.round((meters / M_PER_YD) * factor) / factor
  return locale === 'en' ? yards : String(yards).replace('.', ',')
}

// Construction du tableau CSV export « Stock de laines » (SettingsView). Testable seul : la
// seule chose qui garantit « jamais perdre d'info » ici, c'est que head.length ==
// rows[i].length ligne par ligne — un futur en-tête ajouté sans sa cellule correspondante
// dans `rows` (ou l'inverse) décale silencieusement les valeurs sous les mauvais titres sinon.
// `t` : fonction de traduction i18n, injectée par l'appelant — ce module ne dépend pas de
// vue-i18n. Les en-têtes passent TOUTES par `t(...)` (clés `settings.export.yarn.*`) : plus de
// booléen `en` figé sur deux langues, un futur appelant ne peut donc plus faire réapparaître
// des en-têtes français pour une langue tierce (allemand, espagnol...) en oubliant de le
// passer — la traduction est portée par la locale active de `t`, pas par un paramètre à part
// (passage multilingue, 29/07).
//
// `system`/`currency`/`locale` : l'export est un chemin SÉPARÉ des vues, qui
// construit ses propres en-têtes — sans ce passage explicite depuis l'appelant
// (SettingsView::exportYarns), il resterait silencieusement en métrique/euro quels que
// soient les réglages réels. La longueur est CONVERTIE (unité réelle, réversible) ; le prix
// n'est JAMAIS converti (la devise n'est qu'une étiquette, cf. src/utils/units.js) — seul
// son en-tête change pour porter le symbole choisi.
//
// `linesFor(yarnId)` (les travaux sur le budget) : bain et date d'achat viennent désormais du
// registre d'achats, pas des champs `yarn.bain`/`yarn.purchasedAt` (retirés du formulaire
// auparavant). Règle « jamais perdre d'info » : les bains de TOUTES les lignes
// sortent dédoublonnés et joints (`bainsOf`), la date exportée est la plus RÉCENTE
// (`latestPurchaseDate`) — aucun bain ni aucune date n'est tu par l'agrégation, ils
// changent seulement de forme (colonne unique au lieu d'une ligne par achat).
export function yarnExportTable(yarns, { t, system, currency, locale, linesFor } = {}) {
  // Longueur : deux clés distinctes (pas une seule avec un paramètre d'unité) car le mot
  // change de sens en français selon le système, pas seulement l'unité affichée entre
  // parenthèses — « Métrage » en mètres, mais « Longueur » en yards (asymétrie du texte
  // existant, conservée telle quelle).
  const lengthHeader = system === 'imperial' ? t('settings.export.yarn.lengthYd') : t('settings.export.yarn.lengthM')
  const priceSymbol = currency ? currencySymbol(currency, locale) : ''
  const priceHeader = priceSymbol ? `${t('settings.export.yarn.price')} (${priceSymbol})` : t('settings.export.yarn.price')
  const head = [
    t('settings.export.yarn.brand'), t('settings.export.yarn.model'), t('settings.export.yarn.color'),
    t('settings.export.yarn.colorType'), t('settings.export.yarn.colorNotes'), t('settings.export.yarn.weight'),
    lengthHeader, t('settings.export.yarn.quantity'), priceHeader, t('settings.export.yarn.usedSkeins'),
    t('settings.export.yarn.dyeLot'), t('settings.export.yarn.purchaseDate'), t('settings.export.yarn.composition'),
    t('settings.export.yarn.labels'),
  ]
  const rows = yarns.map((y) => {
    const lines = linesFor ? linesFor(y.id) : []
    return [
      y.brand, y.model || '', y.colorName, t(`yarn.colorTypes.${y.colorType || 'uni'}`), y.colorNotes || '',
      y.weight ? t(`yarn.weights.${y.weight}`) : '',
      exportLength(y.lengthM, system, locale), y.quantity, y.price, reservedTotal(y) || '', bainsOf(lines), latestPurchaseDate(lines),
      compositionToText(y.composition),
      // Ordre canonique (YARN_LABELS), pas l'ordre de cochage — même helper que la fiche
      // détaillée et la carte du stock (revue finale du 06/08/2026).
      orderedLabels(y.labels).map((k) => t(`yarn.labels.${k}`)).join(', '),
    ]
  })
  return { head, rows }
}
