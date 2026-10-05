// Type sémantique d'une section de patron (`kind`) → icône-ligne dessinée.
// Remplace l'ancien champ `icon` (emoji libre) qui faisait « cheap ».
// Le rendu se fait via <AppIcon :name="kind" /> (les clés existent dans @/utils/icons).

// Ordre d'affichage (dans le sélecteur de l'éditeur), groupé par famille.
export const SECTION_KINDS = [
  // Vêtement
  { key: 'corps', families: ['vetement', 'accessoire'] },
  { key: 'manche', families: ['vetement'] },
  { key: 'encolure', families: ['vetement'] },
  { key: 'bordure', families: ['vetement', 'accessoire'] },
  { key: 'accessoires', families: ['vetement'] },
  // Amigurumi
  { key: 'tete', families: ['amigurumi'] },
  { key: 'corpsrond', families: ['amigurumi'] },
  { key: 'membre', families: ['amigurumi'] },
  { key: 'oreille', families: ['amigurumi'] },
  { key: 'museau', families: ['amigurumi'] },
  { key: 'queue', families: ['amigurumi'] },
  // Chaussette (une chaussette se découpe en parties que les patrons nomment). `cotes` double
  // `bordure` (« Bordure / côtes ») pour la chaussette : le bord-côtes s'y fait deux fois.
  { key: 'cotes', families: ['chaussette'] },
  { key: 'pointe', families: ['chaussette'] },
  { key: 'pied', families: ['chaussette'] },
  { key: 'talon', families: ['chaussette'] },
  { key: 'jambe', families: ['chaussette'] },
  { key: 'gousset', families: ['chaussette'] },
  // Motifs & technique
  { key: 'motif', families: ['technique'] },
  { key: 'dentelle', families: ['technique'] },
  { key: 'echantillon', families: ['technique'] },
  { key: 'diagramme', families: ['technique'] },
  { key: 'boutonniere', families: ['technique'] },
  // Accessoire (patron d'accessoire autonome : châle, sac, couverture, déco...)
  // `corps`/`bordure` ci-dessus sont DÉJÀ dans ce groupe (families multiples) —
  // pas de doublon de clé ici, seulement les 7 parties propres à ce contexte.
  { key: 'fond', families: ['accessoire'] },
  { key: 'rabat', families: ['accessoire'] },
  { key: 'poignee', families: ['accessoire'] },
  { key: 'bandouliere', families: ['accessoire'] },
  { key: 'anse', families: ['accessoire'] },
  { key: 'doublure', families: ['accessoire'] },
  { key: 'poche', families: ['accessoire'] },
  // Transversal
  { key: 'finitions', families: ['transversal'] },
  // Rubriques de service/conseils du patron importé (INFO ET CONSEILS, HÄKELTIPP,
  // ATENCIÓN… — un arbitrage, 03/09) : section consultable du flux de lecture, ni
  // référence (aide-mémoire) ni intro (Présentation).
  { key: 'infos', families: ['transversal'] },
  { key: 'autre', families: ['transversal'] },
  { key: 'pelote', families: ['transversal'] },
  // Section générique à répéter, choisie à la main quand aucun type répétable ne convient.
  { key: 'repetable', families: ['transversal'] },
]

export const SECTION_FAMILIES = ['vetement', 'accessoire', 'chaussette', 'amigurumi', 'technique', 'transversal']

// Types faits plusieurs fois (chaque exemplaire a sa propre progression). Les types
// appariés démarrent à 2 exemplaires ; le simultané n'existe que pour les chaussettes.
// `repetable` est répétable sans être apparié : l'import ne le pose jamais.
export const PAIRED_KINDS = ['manche', 'membre', 'oreille', 'cotes', 'pointe', 'pied', 'talon', 'jambe', 'gousset']
export const REPEATABLE_KINDS = [...PAIRED_KINDS, 'repetable']
export const SIMULTANEOUS_KINDS = ['cotes', 'pointe', 'pied', 'talon', 'jambe', 'gousset']

// Types chaussette : libellés « Chaussette n » plutôt qu'« Exemplaire n ».
export function isSockKind(kind) {
  return SIMULTANEOUS_KINDS.includes(kind)
}

export function isRepeatable(kind) {
  return REPEATABLE_KINDS.includes(kind)
}
export function isPaired(kind) {
  return PAIRED_KINDS.includes(kind)
}
// Choisi à la main, démarre à 2 exemplaires : les types appariés et `repetable` (qu'on ne
// choisit que pour répéter).
export function startsAtTwo(kind) {
  return isPaired(kind) || kind === 'repetable'
}
export function canWorkSimultaneously(kind, copies) {
  return SIMULTANEOUS_KINDS.includes(kind) && copies === 2
}

const KIND_KEYS = new Set(SECTION_KINDS.map((k) => k.key))

// Défaut d'une nouvelle section + repli quand un `kind` est inconnu/absent.
export const DEFAULT_KIND = 'pelote'

// Rétro-compat : anciennes sections stockées avec un emoji `icon`. Best-effort ;
// tout ce qui n'a pas d'équivalent net retombe sur le défaut (pelote).
const ICON_TO_KIND = {
  '🧶': 'pelote',
  '👕': 'corps',
  '💪': 'manche',
  '🧦': 'accessoires',
  '🧢': 'accessoires',
  '🪡': 'finitions',
  '🧵': 'finitions',
  '✨': 'finitions',
  '📈': 'diagramme',
  '📊': 'diagramme',
  '📐': 'echantillon',
  '🌀': 'motif',
  '⭕': 'encolure',
}

export function iconToKind(icon) {
  return ICON_TO_KIND[String(icon ?? '').trim()] || null
}

export function isKind(key) {
  return KIND_KEYS.has(key)
}

// Résout le `kind` d'une section quelle que soit son ancienneté :
// kind explicite > dérivé de l'ancien emoji > défaut.
export function sectionKind(sec) {
  if (sec && isKind(sec.kind)) return sec.kind
  const legacy = iconToKind(sec?.icon)
  return legacy || DEFAULT_KIND
}

// Clé i18n du libellé d'un kind (utilisée dans l'éditeur).
export function kindLabelKey(key) {
  return `reader.kind.${isKind(key) ? key : DEFAULT_KIND}`
}

// Vue groupée du menu de l'éditeur : familles affichées, alphabétique DANS chaque
// famille. Le tri se calcule sur le libellé TRADUIT (localeCompare) et jamais sur
// l'ordre de SECTION_KINDS : « Bordure » précède « Corps » en français, mais « Body »
// précède « Border » en anglais — un ordre figé serait faux dans une des deux langues.
// Fonction pure : `labels` est injecté (section-kinds.js ne connaît pas i18n).
export function groupedSectionKinds(labels, locale, { exclude = [] } = {}) {
  const skip = new Set(exclude)
  const byLabel = (a, b) => a.label.localeCompare(b.label, locale)
  const groups = []
  for (const family of SECTION_FAMILIES) {
    const items = SECTION_KINDS
      .filter((k) => k.families.includes(family) && !skip.has(k.key))
      .map((k) => ({ value: k.key, label: labels.kinds[k.key] }))
      .sort(byLabel)
    if (items.length) groups.push({ family, label: labels.families[family], items })
  }
  return groups
}
