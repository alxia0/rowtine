// Dialecte Rowtine-MD FR<->EN : source unique de vérité pour la
// traduction des kinds de travail, des blocs référence et du front-matter.
// Les kinds internes du moteur restent en français ; seule la frontière de
// sérialisation (serialize.js en écriture, parse.js en lecture) traduit.
// Module pur, aucun effet de bord.

// Kinds de travail (voir src/utils/section-kinds.js). `pelote` (défaut non
// balisé) est volontairement absent : il ne fait l'objet d'aucune balise EN.
export const KIND_TO_EN = {
  corps: 'body',
  manche: 'sleeve',
  encolure: 'neckline',
  bordure: 'border',
  accessoires: 'accessory',
  tete: 'head',
  corpsrond: 'round-body',
  membre: 'limb',
  oreille: 'ear',
  museau: 'muzzle',
  queue: 'tail',
  motif: 'motif',
  dentelle: 'lace',
  // Distinct de REF_TO_EN.echantillon ('gauge') : le kind de travail échantillon
  // (ex. « Carré d'échantillon » tagué dans ReaderSectionsEditor) doit rester une
  // section de travail à la sérialisation, jamais être absorbé dans le bloc
  // référence Échantillon (correctif C1 — perte silencieuse sinon).
  echantillon: 'swatch',
  diagramme: 'chart',
  boutonniere: 'buttonhole',
  // Accessoire (patron d'accessoire autonome)
  fond: 'base',
  rabat: 'flap',
  poignee: 'handle',
  bandouliere: 'strap',
  anse: 'loop-handle',
  doublure: 'lining',
  poche: 'pocket',
  // Transversal
  finitions: 'finishing',
  // Un arbitrage (03/09) : rubriques de service/conseils — tag `info`, DISTINCT du
  // `intro` de REF_TO_EN (espaces de balises disjoints : kinds de section `## X {…}`
  // vs blocs référence) — le round-trip KIND_TO_FR.info → 'infos' est sans collision.
  infos: 'info',
  autre: 'other',
}

export const KIND_TO_FR = Object.fromEntries(
  Object.entries(KIND_TO_EN).map(([fr, en]) => [en, fr])
)

// Blocs référence : clé interne -> balise EN. `mesures` et `tailles` sont
// deux clés internes historiques qui convergent toutes deux vers `measurements`
// (pas de sens inverse unique ici, donc pas de REF_TO_FR).
export const REF_TO_EN = {
  echantillon: 'gauge',
  fil: 'yarn',
  aiguilles: 'needles',
  materiel: 'materials',
  techniques: 'techniques',
  abbr: 'abbreviations',
  // Chantier « aide-mémoire sous-titres et faux titres » — bloc « Conseils »
  // (renvois vers des vidéos de technique, Harlow_Sweater_FR, corpus réel), sur le même
  // modèle que `materiel`/`materials` : clé interne FR distincte de la balise EN.
  conseils: 'tips',
  mesures: 'measurements',
  tailles: 'measurements',
  galerie: 'gallery',
  info: 'intro',
}

// Front-matter : `rowtine` (clé technique de version) est volontairement
// absente, elle n'est jamais traduite.
export const FRONTMATTER_TO_EN = {
  titre: 'title',
  auteur: 'author',
  lien: 'link',
  tailles: 'sizes',
  'sous-tailles': 'subsizes',
  aisance: 'ease',
}

export const FRONTMATTER_TO_FR = Object.fromEntries(
  Object.entries(FRONTMATTER_TO_EN).map(([fr, en]) => [en, fr])
)

// Helpers tolérants : une clé/kind absent(e) de la table est renvoyé(e) tel
// quel (balise inconnue, ou déjà FR/EN héritée).
//
// `Object.hasOwn` plutôt que la lecture nue : les quatre arguments viennent du DOCUMENT
// (`kindToFr(tm[2])` reçoit le tag d'un `## Titre {tag}`, `frontmatterKeyToEn` une clé de
// front-matter), donc `'constructor'` remonte la chaîne de prototype et rend la fonction
// `Object` — ni `??` ni `||` ne la voient passer, puisqu'elle n'est ni nulle ni fausse.
// `kind` valait alors une FONCTION au lieu d'une chaîne (`isKind` la rejette, mais elle
// voyageait jusque dans l'avertissement et la donnée). Même correctif que `RESERVED` /
// `REF_TAG_TO_KEY` (refblocks.js), ici au point de lecture puisque les tables sont
// exportées et relues ailleurs telles quelles.
export function kindToEn(frKind) {
  return Object.hasOwn(KIND_TO_EN, frKind) ? KIND_TO_EN[frKind] : frKind
}

export function kindToFr(enTag) {
  return Object.hasOwn(KIND_TO_FR, enTag) ? KIND_TO_FR[enTag] : enTag
}

export function frontmatterKeyToEn(key) {
  return Object.hasOwn(FRONTMATTER_TO_EN, key) ? FRONTMATTER_TO_EN[key] : key
}

export function frontmatterKeyToFr(key) {
  return Object.hasOwn(FRONTMATTER_TO_FR, key) ? FRONTMATTER_TO_FR[key] : key
}

// Sens de lecture d'un diagramme (reader.js : code interne 'rtl'/'ltr' depuis le 30/07,
// traduit à l'affichage par `readDirLabel`). Même principe que le tag {kind} ci-dessus,
// mais en sens inverse (ici l'interne est un CODE, la frontière MD un mot FR) : la ligne
// technique du format Rowtine-MD (« 18 m × 52 rangs · lecture … ») reste lisible pour
// l'utilisatrice — éditeur de correction, fichier patron.md sur disque — donc jamais le
// code brut seul ; le tag {rtl|ltr} qui suit le mot est ce que parse.js relit, pour un
// aller-retour save/reload fidèle au code (qui reste traduisible dans les 4 langues après
// relecture). Une valeur héritée (phrase déjà toute faite, patron importé avant ce format,
// ex. « von rechts nach links ») n'a jamais ce tag : `readDirFromMd` la ressort alors
// verbatim, sans réinterprétation — rien ne change pour elle, rien n'est perdu.
export const READ_DIR_TO_MD_WORD = { rtl: 'droite à gauche', ltr: 'gauche à droite' }

export function readDirToMd(readDir) {
  const word = READ_DIR_TO_MD_WORD[readDir]
  return word ? `${word} {${readDir}}` : readDir
}

// `(|.*?\S)` : même correctif anti-quadratique que TITLE_KIND_RE (md-line-type.js), dont ce
// motif est le jumeau — `.*?` et `\s*` se chevauchaient sur les blancs.
const READ_DIR_TAG_RE = /^(|.*?\S)\s*\{(rtl|ltr)\}$/

export function readDirFromMd(raw) {
  const m = READ_DIR_TAG_RE.exec(raw || '')
  return m ? m[2] : raw || ''
}

// Forme d'un diagramme non-linéaire (calage radial ou par tracé, 23/08/2026). Contrairement à
// `lecture` ci-dessus, aucun patron existant ne porte cette valeur : pas de legacy à préserver,
// donc pas besoin du double mot+tag — un mot suffit. Absent = comportement historique inchangé
// (diagramme linéaire), aucun patron existant n'est concerné.
const CHART_SHAPE_TO_MD_WORD = { 'radial-square': 'radial-carré', 'radial-circle': 'radial-rond', path: 'tracé' }
const CHART_SHAPE_FROM_MD_WORD = { 'radial-carré': 'radial-square', 'radial-rond': 'radial-circle', tracé: 'path' }

export function chartShapeToMd(shape) {
  return CHART_SHAPE_TO_MD_WORD[shape] || ''
}

export function chartShapeFromMd(word) {
  return CHART_SHAPE_FROM_MD_WORD[word] || undefined
}
