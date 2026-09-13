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
]

export const SECTION_FAMILIES = ['vetement', 'accessoire', 'amigurumi', 'technique', 'transversal']

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
  const skip = new Set([...exclude, DEFAULT_KIND])
  const byLabel = (a, b) => a.label.localeCompare(b.label, locale)
  const groups = [{
    family: null,
    label: null,
    items: [{ value: DEFAULT_KIND, label: labels.kinds[DEFAULT_KIND] }],
  }]
  for (const family of SECTION_FAMILIES) {
    const items = SECTION_KINDS
      .filter((k) => k.families.includes(family) && !skip.has(k.key))
      .map((k) => ({ value: k.key, label: labels.kinds[k.key] }))
      .sort(byLabel)
    if (items.length) groups.push({ family, label: labels.families[family], items })
  }
  return groups
}
