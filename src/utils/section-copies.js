// Exemplaires d'une section répétable (paire de chaussettes, manches, pétales...).
// Pur JS, imports relatifs seulement (importé par reader.js, qui tourne sous Node nu).
import { sectionKind, isRepeatable, isPaired, canWorkSimultaneously, SIMULTANEOUS_KINDS } from './section-kinds'

export const MAX_COPIES = 99

export function copiesOf(sec) {
  const n = Math.trunc(Number(sec?.copies))
  if (!Number.isFinite(n) || n < 1) return 1
  if (!isRepeatable(sectionKind(sec))) return 1
  return Math.min(n, MAX_COPIES)
}

// Technique du projet pour une section : simultané seulement si le projet l'a choisi (`mode`,
// `readerState.copyMode`) et que la section s'y prête (chaussette à 2 exemplaires). Le mode
// n'est plus porté par la section (spec 2026-10-05).
export function copyModeOf(sec, mode) {
  return mode === 'simultaneous' && canWorkSimultaneously(sectionKind(sec), copiesOf(sec)) ? 'simultaneous' : 'sequential'
}

// Ce qu'on dit d'une section répétée (« 2 exemplaires, en même temps ») ; null à 1. Sans `mode`
// (aperçu d'un patron hors projet), jamais « en même temps ».
export function copiesSummary(sec, mode) {
  const n = copiesOf(sec)
  return n > 1 ? { n, together: copyModeOf(sec, mode) === 'simultaneous' } : null
}

// Parties de chaussette que concerne la technique du projet (chaussette à 2 exemplaires).
export function sockPairSections(sections) {
  return (sections || []).filter((s) => canWorkSimultaneously(sectionKind(s), copiesOf(s)))
}

// Vue { done, counters } de l'exemplaire `c` (1-based). Mêmes ids d'étape (`sec#i`)
// pour tous les exemplaires : seul le conteneur change.
export function copyView(state, c) {
  if (c <= 1) return { done: state?.done || {}, counters: state?.counters || {} }
  const s = state?.copyState?.[c]
  return { done: s?.done || {}, counters: s?.counters || {} }
}

export function withCopyView(state, c, view) {
  if (c <= 1) return { ...state, done: view.done, counters: view.counters }
  return { ...state, copyState: { ...state?.copyState, [c]: { done: view.done, counters: view.counters } } }
}

export function activeCopyOf(state, sec) {
  const n = Number(state?.activeCopy?.[sec?.id])
  return Number.isInteger(n) && n >= 1 && n <= copiesOf(sec) ? n : 1
}

export function laggingCopy(doneCounts) {
  let best = 0
  doneCounts.forEach((n, i) => { if (n < doneCounts[best]) best = i })
  return best + 1
}

// Simultané, compteur de répétitions d'une étape (`values[i]` : compteur de l'exemplaire i + 1).
// « + » vise l'exemplaire au compteur le plus bas (le premier à égalité) ; « − » celui au compteur
// le plus haut (le dernier à égalité), inverse exact de « + » : un « − » défait le dernier « + ».
export function counterCopy(values, delta) {
  if (delta >= 0) return laggingCopy(values)
  let best = 0
  values.forEach((n, i) => { if (n >= values[best]) best = i })
  return best + 1
}

// Id d'étape porté par l'appui de la notification : nu pour l'exemplaire 1 (même charge qu'avant
// les exemplaires), `<id>@<c>` pour c >= 2. Le natif le transporte comme une chaîne opaque.
export function copyStepId(id, c) {
  return c > 1 ? `${id}@${c}` : id
}

export function parseCopyStepId(raw) {
  const m = typeof raw === 'string' ? /^(.*)@(\d+)$/.exec(raw) : null
  const c = m ? Number(m[2]) : 1
  return m && c >= 2 ? { stepId: m[1], copy: c } : { stepId: raw, copy: 1 }
}

// Défaut à 2 exemplaires pour les types qui vont par paire (import, pur, ne mute pas).
// Jamais de copyMode ; une section qui a déjà `copies` reste intacte. Manche, membre, oreille et
// jambe sont doublés, même à plusieurs sections du même type (« Manches », « Poignets des
// manches »), sauf si le titre nomme un côté (`SIDE_RE` : « Manche gauche » / « Manche droite »,
// la paire est déjà écrite en deux sections). Les autres types chaussette, seulement avec au moins
// 3 types chaussette distincts dans le patron (écarte « Pointe du nez », les « Pieds » d'un hibou).
// Dans ce même patron de chaussettes, une `bordure` (Côtes, Cuff...) est le bord-côtes de la
// chaussette : requalifiée en `cotes`.
const SIDE_RE = /\b(gauches?|droite?s?|left|right|links|rechts|linke[nmrs]?|rechte[nmrs]?|izquierd[oa]s?|derech[oa]s?)\b/i
const PAIRED_ANYWHERE = ['manche', 'membre', 'oreille', 'jambe']
export function applyPairedDefaults(sections) {
  const sockKinds = new Set(sections.map((s) => sectionKind(s)).filter((k) => SIMULTANEOUS_KINDS.includes(k)))
  const isSockPattern = sockKinds.size >= 3
  const requalified = isSockPattern
    ? sections.map((s) => (sectionKind(s) === 'bordure' ? { ...s, kind: 'cotes' } : s))
    : sections
  return requalified.map((s) => {
    const k = sectionKind(s)
    if (s.copies != null || !isPaired(k) || SIDE_RE.test(String(s.title || ''))) return s
    const ok = PAIRED_ANYWHERE.includes(k) || isSockPattern
    return ok ? { ...s, copies: 2 } : s
  })
}
