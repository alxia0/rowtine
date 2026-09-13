// Helpers purs d'édition d'un objet `reader` (Lot B3). Aucune dépendance Vue/DOM.
import { slug, fitSizeRowValues } from './reader'
import { sectionKind } from './section-kinds'

export function emptyReaderStep(type = 'row') {
  if (type === 'note') return { t: '', note: true }
  if (type === 'repeat') return { t: '', repeat: true, total: [] }
  return { t: '' }
}

export function stepType(step) {
  if (step?.chart) return 'chart'
  if (step?.note) return 'note'
  if (step?.repeat) return 'repeat'
  return 'row'
}

// Diffuse une valeur sur n tailles (min 1). Non-numérique → 0.
export function broadcast(value, n) {
  const v = Number(value) || 0
  return Array.from({ length: Math.max(1, n) }, () => v)
}

// Regex des placeholders {{i}}, partagée par `stepPlaceholders` et `compactStepCounts` plutôt
// que recompilée à chaque step (les deux sont appelées sur tous les steps à chaque
// enregistrement, cf. `normalizeReaderForSave`). Sûr à réutiliser : la boucle `exec` ci-dessous
// va toujours jusqu'à épuisement (aucun `break`), ce qui remet `lastIndex` à 0 en sortie.
const PLACEHOLDER_RE = /\{\{(\d+)\}\}/g

// Indices {{i}} distincts, dans l'ordre de 1re apparition.
export function stepPlaceholders(t) {
  const seen = []
  let m
  while ((m = PLACEHOLDER_RE.exec(String(t ?? '')))) {
    const i = Number(m[1])
    if (!seen.includes(i)) seen.push(i)
  }
  return seen
}

// Renumérote les {{i}} en 0..k-1 (ordre d'apparition) et réaligne c ; supprime c orphelin.
export function compactStepCounts(step) {
  if (step?.chart) return step
  const t = String(step.t ?? '')
  const order = stepPlaceholders(t)
  if (!order.length) {
    const { c: _drop, ...rest } = step
    return rest
  }
  const map = new Map(order.map((oldI, newI) => [oldI, newI]))
  const newT = t.replace(PLACEHOLDER_RE, (whole, d) => (map.has(Number(d)) ? `{{${map.get(Number(d))}}}` : whole))
  const oldC = Array.isArray(step.c) ? step.c : []
  const c = order.map((oldI) => (Array.isArray(oldC[oldI]) ? oldC[oldI] : []))
  return { ...step, t: newT, c }
}

// Ramène un tableau à longueur n (troncature, ou complétion — voir ci-dessous).
// Une valeur scalaire (non-tableau) est traitée comme un tableau à un élément, pour préserver
// la sémantique de l'ancien `broadcast` (ex. total: 4 → [4, 4, 4]).
//
// COMPLÉTION : DEUX SÉMANTIQUES, une seule invente (arbitrage propriétaire du projet,
// 20/08/2026 — I3).
//   - Vecteur SCALAIRE (un seul élément, ou aucun) : DIFFUSION, comportement conservé. Une
//     valeur unique vaut pour toutes les tailles — c'est l'ancien `broadcast` (total: 4 →
//     [4, 4, 4]), rien n'est inventé. Un vecteur VIDE reste comblé de zéros : c'est
//     l'artefact d'import déjà documenté (placeholder {{i}} sans aucune valeur par taille),
//     que `isBlankCount` (reader.js) reconnaît et n'affiche pas — le changer ne rendrait rien
//     de plus visible et déplacerait la sortie du moteur d'import sans bénéfice.
//   - Vecteur DÉJÀ MULTI-VALEURS mais plus court que n : complété par du VIDE (`''`).
//     Recopier la dernière valeur — « monter 10 (12) 14 m » qui devient « 10 (12) 14 (14) »
//     en passant à 4 tailles — présente comme une donnée du patron un chiffre que PERSONNE
//     n'a écrit. La grammaire de non-invention prime : l'utilisatrice doit VOIR qu'il manque
//     une valeur et la saisir.
// Pourquoi `''` et pas `0` ni `null` — vérifié, pas déduit (rendu observé le 20/08/2026) :
// `pickCount(['10','12','14',''], 3)` rend une case VIDE, `0` rend « 0 » (une fausse donnée :
// zéro maille) et `null` rend littéralement « null ». En notation toutes tailles,
// `formatSizes` donne « 10 (12) 14 () » : la case manquante se voit.
function padTo(arr, n) {
  const src = Array.isArray(arr) ? arr : arr != null ? [arr] : []
  // Number(v) échoue sur les décimales à la française ("9,5") : on les préserve telles quelles
  // (pas d'invention) plutôt que de les écraser à 0 ; seule une valeur ABSENTE (null/undefined)
  // devient 0.
  //
  // IDEMPOTENCE (I3) : une case vide `''` posée par la complétion ci-dessous doit RESSORTIR
  // vide. Elle était auparavant ramenée à 0 ici, à l'entrée — et cette fonction repasse sur
  // ses propres sorties (rouvrir « Corriger le patron » puis réenregistrer suffit : le carving
  // restaure le step de base, `normalizeReaderForSave` le repasse par ici). La valeur inventée
  // serait donc revenue au deuxième enregistrement, sous un visage pire encore : « 0 maille ».
  // `padTo(padTo(v, n), n)` doit valoir `padTo(v, n)` — c'est verrouillé par un test.
  const a = src.map((v) => {
    if (v == null) return 0
    if (v === '') return ''
    const num = Number(v)
    return Number.isNaN(num) ? v : num
  })
  if (a.length === n) return a
  if (a.length > n) return a.slice(0, n)
  // a.length <= 1 : diffusion (ou zéros pour un vecteur vide) ; au-delà : cases vides.
  const fill = a.length > 1 ? '' : a.length ? a[0] : 0
  return [...a, ...Array(Math.max(0, n - a.length)).fill(fill)]
}

// Ramène c[j] et total (REP) à n tailles.
export function resizeStepCounts(step, n) {
  const out = { ...step }
  if (Array.isArray(out.c)) out.c = out.c.map((col) => padTo(col, n))
  if (out.repeat) out.total = padTo(out.total, n)
  return out
}

// Ajuste les rangées du TABLEAU DES TAILLES (reference) à la largeur de `sizeLabels`.
//
// Correctif de revue (I2) : `normalizeReaderForSave` redimensionne les vecteurs c/total
// des steps mais jamais les rangées de `reference` — passer de 3 à 2 tailles enregistrait donc
// des rangées à 3 valeurs sous 2 en-têtes (ReaderSheet.vue boucle l'en-tête sur `sizeLabels`
// et les cellules sur `row.values` indépendamment : colonne orpheline, surlignage de la taille
// active décalé). Le chemin qui produit ce désalignement est réel et vérifié : quand le
// fragment relu ne contient AUCUN bloc de référence, `mdFragmentToReader` (fragment.js)
// retombe sur `baseReader.reference` — donc sur les rangées d'AVANT le changement de tailles.
//
// VOLONTAIREMENT HORS de `normalizeReaderForSave` : celle-ci est sur le chemin de tout le
// moteur d'import (parse.js, pdf-import/assemble.js), où `pdf-import/reference.js` pousse des
// rangées dont la longueur n'est pas garantie égale à n — y déplacer ce recadrage changerait
// la sortie de l'import et déplacerait le banc de mesure sur corpus, pour un invariant qui
// n'est pas « ne rien perdre » (celui-là est bien partagé) mais « la largeur des rangées suit
// celle de l'en-tête ». Cet invariant-là appartient au GESTE de correction, le seul endroit de
// l'app qui change `sizeLabels` après l'import (vérifié : aucun autre écran n'y touche).
//
// Ni invention ni perte : `fitSizeRowValues` (reader.js) complète par des cases vides et
// replie le surplus dans la dernière colonne.
export function resizeReferenceSizeTable(reader, sizeLabels = []) {
  const tabs = reader?.reference?.tabs
  if (!Array.isArray(tabs)) return reader
  const n = (sizeLabels || []).length
  const nextTabs = tabs.map((tab) => {
    if (tab?.id !== 'tailles' || !Array.isArray(tab.blocks)) return tab
    const blocks = tab.blocks.map((block) => {
      const rows = block?.sizeTable?.rows
      if (!Array.isArray(rows)) return block
      const nextRows = rows.map((row) => ({ ...row, values: fitSizeRowValues(row?.values, n) }))
      return { ...block, sizeTable: { ...block.sizeTable, rows: nextRows } }
    })
    return { ...tab, blocks }
  })
  return { ...reader, reference: { ...reader.reference, tabs: nextTabs } }
}

// Normalise un reader pour la sauvegarde. Préserve les champs riches non édités en B3.
export function normalizeReaderForSave(reader, sizes = []) {
  // Repli : si aucune taille métadonnée fournie, conserver les sizeLabels existants du reader
  // (évite d'écraser un patron riche et de désaligner ses tableaux c/total de longueur N).
  const provided = [...(sizes || [])].map(String).filter(Boolean)
  const sizeLabels = provided.length ? provided : [...(reader?.sizeLabels || [])].map(String)
  const n = sizeLabels.length
  const used = new Set()
  const sections = (reader?.sections || [])
    .map((sec, si) => {
      const steps = (sec.steps || [])
        // Un step est un contenu VALIDE s'il porte du texte, un diagramme, OU une image
        // ancrée (`imgs`) — ce dernier cas manquait (bug trouvé le 19/08/2026) :
        // demoteChartToImage (reader-correction.js) produit un step { imgs: [img] } SANS
        // texte ni `chart`, et un repassage par cette fonction (désormais systématique à
        // l'enregistrement dans CorrectionView.vue, pour redimensionner les tailles) le
        // faisait disparaître silencieusement — perte de la seule trace de l'image démotée.
        // Régression démontrée par tests/unit/CorrectionView.spec.js (D5.2 et le test de
        // renommage), corrigée ici plutôt que dans l'appelant : la garantie « pas de perte »
        // doit vivre dans la fonction partagée, pas être reconstruite à chaque appelant.
        .filter((st) => st.chart || (Array.isArray(st.imgs) && st.imgs.length) || String(st.t ?? '').trim())
        .map((st) => {
          if (st.chart) return st
          const trimmed = { ...st, t: st.t != null ? String(st.t).trim() : st.t }
          return resizeStepCounts(compactStepCounts(trimmed), n)
        })
      let id = slug(sec.title) || `sec${si}`
      while (used.has(id)) id = `${id}-${si}`
      used.add(id)
      return { id, kind: sectionKind(sec), title: String(sec.title ?? '').trim(), steps, ...(sec.chart ? { chart: sec.chart } : {}) }
    })
    .filter((sec) => sec.title || sec.steps.length)
  return { ...reader, sizeLabels, sections }
}
