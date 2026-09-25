// MODULE DE PRODUCTION. Écrit par l'éditeur (src/components/cm/cm-editor.js,
// src/utils/pattern-md/md-retag.js) via emitStepCounter, et désormais LU par le suivi
// du projet : parse.js consomme parseStepCounter (feature 2026-07-17 — les compteurs
// {×N}/{cadence X×N} posés dans l'éditeur deviennent de vrais compteurs à la lecture,
// au lieu de rester du texte brut).
// L'app connaît donc deux notations de répétition qui coexistent : le `×N` nu hérité
// (parse.js, import/corpus + detectChartReps pdf-import/index.js → chart.reps) et ce
// dialecte balisé de l'éditeur ci-dessous. Aucune n'est retirée. Depuis D2 (défaut
// vague 2), ce module héberge aussi l'échelle de RELECTURE de la puce legacy « - × … »
// (legacyRepeatTotal ci-dessous), source unique partagée par parse.js et serialize.js.
//
// Marqueurs compteurs Rowtine-MD (design §5). × = U+00D7.
// Répétition : {×N} — refaire N fois. Cadence : {cadence X×N} — tous les X rangs, N fois.
import { broadcast } from '../reader-edit'

const REP_RE = /^\{×(\d+)\}\s*/
const CADENCE_RE = /^\{cadence\s+(\d+)×(\d+)\}\s*/

export function parseStepCounter(content) {
  const src = String(content ?? '')
  const cad = CADENCE_RE.exec(src)
  if (cad) return { counter: { kind: 'cadence', every: Number(cad[1]), times: Number(cad[2]) }, rest: src.slice(cad[0].length) }
  const rep = REP_RE.exec(src)
  if (rep) return { counter: { kind: 'repetition', times: Number(rep[1]) }, rest: src.slice(rep[0].length) }
  return { rest: src }
}

export function emitStepCounter(counter) {
  if (!counter) return ''
  if (counter.kind === 'cadence') return `{cadence ${counter.every}×${counter.times}} `
  if (counter.kind === 'repetition') return `{×${counter.times}} `
  return ''
}

const SECTION_REP_RE = /^(.*?)\s*\{×(\d+)\}\s*$/

export function parseSectionRepeat(title) {
  const m = SECTION_REP_RE.exec(String(title ?? ''))
  return m ? { title: m[1].trim(), repeat: Number(m[2]) } : { title: String(title ?? '').trim() }
}

export function emitSectionRepeat(repeat) {
  return repeat ? ` {×${repeat}}` : ''
}

// Échelle de relecture d'une puce legacy « - × … » — SOURCE UNIQUE partagée par parse.js
// (lecture) et serialize.js (prédicat legacyRepeatIsLossless). REP_KW étendu (D2, défaut
// vague 2) aux unités admises à l'IMPORT (REP_RE, pdf-import/steps.js) : gange/ganger/gånger,
// kertaa, mal, veces, volte, keer, razy — sans quoi « Ripeti queste 2 righe 7 volte » était
// relu « 2 » (premier nombre). « x » nu EXCLU : collision mesurée « 110 x 110 cm »
// (peacock-shawl-in-kid-silk-en, tests/unit/pdf-import-reference.spec.js G4d).
// On lit sur st.t (jetons {{i}} déjà posés), pas sur le texte brut, pour distinguer un
// compte PAR TAILLE (« {{i}} times » → st.c[i]) d'un compte SCALAIRE (« 5 times » →
// broadcast). Le vecteur peut avoir des mots de liaison (autres/more/etc.) entre lui et
// l'unité. Repli historique : 1er vecteur (st.c[0]), puis 1er nombre du texte hors
// placeholders — cf. Roni « 5 times (= 80 … sts) » où le 1er vecteur est le décompte de
// mailles et où seule l'unité désigne le VRAI compte.
export const REP_KW = String.raw`\b(?:times?|fois|gange?|ganger|g[åa]nger|kertaa|mal|veces|volte|keer|razy)\b`
const MODIFIER_KW = String.raw`(?:autres?|more|additional|further|extra|supplémentaires?|nouvelles?)`
export const REP_COUNT_VEC_RE = new RegExp(String.raw`\{\{(\d+)\}\}\s*(?:${MODIFIER_KW}\s*)?${REP_KW}`, 'i')
export const REP_COUNT_SCALAR_RE = new RegExp(String.raw`(\d+)\s*(?:${MODIFIER_KW}\s*)?${REP_KW}`, 'i')
// Unité « x » : VECTEUR seulement (« {{i}} x »), jamais nombre nu (collision « 110 x 110 cm »
// ci-dessus). L'import PDF l'admet (REP_RE_UNIT_VECTOR_RE, pdf-import/steps.js) et pose
// total = c[i] ; sans cette lecture, « Rep the last 4 (6) 8 rows 3 (4) 5 x. » retombait sur
// c[0], la forme legacy était jugée non sûre, et le marqueur {×N} ne gardait que total[0]
// (3 (4) 5 → 3 partout). Consulté APRÈS les unités explicites : rien de ce qu'elles
// résolvaient déjà ne change.
const REP_COUNT_VEC_X_RE = new RegExp(String.raw`\{\{(\d+)\}\}\s*(?:${MODIFIER_KW}\s*)?x\b`, 'i')

export function legacyRepeatTotal(st, n) {
  const t = st?.t || ''
  const vecRep = REP_COUNT_VEC_RE.exec(t)
  if (vecRep && st.c?.[Number(vecRep[1])]) return st.c[Number(vecRep[1])]
  const scalRep = REP_COUNT_SCALAR_RE.exec(t)
  if (scalRep) return broadcast(scalRep[1], Math.max(1, n))
  const vecX = REP_COUNT_VEC_X_RE.exec(t)
  if (vecX && st.c?.[Number(vecX[1])]) return st.c[Number(vecX[1])]
  if (st.c?.length) return st.c[0]
  const num = /\d+/.exec(t.replace(/\{\{\d+\}\}/g, ''))
  if (num) return broadcast(num[0], Math.max(1, n))
  return null
}
