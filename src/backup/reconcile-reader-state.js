// Réconciliation de la progression du lecteur (readerState) quand un patron.md a été
// édité en externe et reparsé. Les steps n'ont AUCUN id stable ; l'id d'exécution
// `${section.id}#${index}` change dès qu'un step est inséré/supprimé/réordonné.
// Identité de réconciliation = (section.id) × (clé texte normalisée du step),
// l'index ne sert qu'à départager. Principe cardinal : jamais de fausse coche,
// jamais de fausse progression, jamais de perte silencieuse — tout écart est
// compté dans `report` plutôt que deviné.
import { stepTextToMd } from '@/utils/pattern-md/line'

function freshState() {
  // Sortie = modèle vivant PUR (multi-grilles 09/07 + calage 10/07) : trois maps
  // indexées par `section.id`. Plus de `chartRow` nu hérité — `persist()`
  // (ReaderView.vue) ne l'écrit plus, et la migration legacy correspondante a été
  // retirée le 13/08/2026 (ménage pré-1.0, réserve produit acceptée).
  return { size: 0, done: {}, counters: {}, chartRows: {}, chartReps: {}, chartFrames: {}, chartCurtains: {} }
}

function freshReport() {
  return {
    doneKept: 0,
    doneLost: 0,
    countersKept: 0,
    countersLost: 0,
    sizeReset: false,
    // État par grille : Kept/Lost par map (remplacent l'unique `chartRowReset`).
    chartRowsKept: 0,
    chartRowsLost: 0,
    chartRepsKept: 0,
    chartRepsLost: 0,
    chartFramesKept: 0,
    chartFramesLost: 0,
    chartCurtainsKept: 0,
    chartCurtainsLost: 0,
  }
}

// Grille effective d'une section : sa grille propre `sec.chart`, ou le repli global
// `reader.chart` (patrons hérités seedés/persistés avant le multi-grilles : SABAI,
// Twist Loop). Reproduit `effectiveChart` du lecteur (ReaderView.vue).
function effectiveChart(sec, reader) {
  return (sec && sec.chart) || (reader && reader.chart) || null
}

// Une section du NOUVEAU reader « est une grille » exactement comme le lecteur la
// rend (`visibleChartSections` dans ReaderView.vue) : elle résout vers une grille
// effective ET porte au moins une étape diagramme (`st.chart`). On NE reprend PAS le
// filtre par taille (`chartVisible`) : l'état par grille existe indépendamment de la
// taille couramment affichée — un prédicat plus large ici est conservateur (il ne
// peut jamais REJETER une section qui détient de l'état → « jamais perdre »).
function isChartSection(sec, reader) {
  if (!effectiveChart(sec, reader)) return false
  const steps = Array.isArray(sec?.steps) ? sec.steps : []
  return steps.some((st) => st?.chart)
}

// Total de rangs `rows` d'une grille (nombre simple, cf. nextChartPosition). Renvoie
// le nombre s'il est fini et strictement positif ; sinon null → borne inconnue, la
// valeur ancienne est transférée telle quelle (conservateur, ne pas perdre).
function chartRowsBound(chart) {
  const r = Number(chart?.rows)
  return Number.isFinite(r) && r > 0 ? r : null
}

// Total de répétitions `reps` d'une grille (nombre simple ; 0/absent = pas de
// répétition → borne inconnue).
function chartRepsBound(chart) {
  const t = Number(chart?.reps)
  return Number.isFinite(t) && t > 0 ? t : null
}

// Clé texte d'un step : le texte inclut les comptes ({{i}} résolus) → toute
// modification de ligne (y compris un simple changement de chiffre) rend le step
// "différent" et fait tomber le done/counter associé — comportement volontaire
// et conservateur.
function textKey(step) {
  return stepTextToMd(step?.t, step?.c).trim()
}

// Construit, pour un reader donné, une map sectionId → Map(cléTexte → [index...]).
// Une clé associée à plusieurs index dans la même section est AMBIGUË.
function buildIndex(reader) {
  const bySection = new Map()
  for (const sec of reader?.sections || []) {
    const byKey = new Map()
    ;(sec.steps || []).forEach((st, i) => {
      const k = textKey(st)
      if (!byKey.has(k)) byKey.set(k, [])
      byKey.get(k).push(i)
    })
    bySection.set(sec.id, byKey)
  }
  return bySection
}

// Retrouve dans newIndex/newReader l'unique step correspondant à (sectionId, clé)
// tel qu'observé dans oldIndex (pour vérifier l'ambiguïté aussi côté ancien).
// Renvoie { newIndex, newStep } ou null si introuvable/ambigu d'un côté ou de l'autre.
function resolveMatch(sectionId, key, oldIndex, newIndex, newReader) {
  const oldHits = oldIndex.get(sectionId)?.get(key) || []
  const newHits = newIndex.get(sectionId)?.get(key) || []
  if (oldHits.length !== 1 || newHits.length !== 1) return null
  const idx = newHits[0]
  const newSection = (newReader?.sections || []).find((s) => s.id === sectionId)
  const newStep = newSection?.steps?.[idx]
  if (!newStep) return null
  return { idx, newStep, sectionId }
}

// Total d'un step repeat pour une taille donnée. `total` peut être :
//  - un tableau indexé par taille (modèle nominal du reader) → total[sizeIndex] ;
//  - un nombre unique → utilisé tel quel ;
//  - absent/non exploitable → renvoie null. Le compteur n'est alors PAS transféré
//    (voir le point 4 plus bas) : un total non résolvable ne permet pas de vérifier
//    que la valeur ancienne reste dans les bornes, donc on l'abandonne plutôt que de
//    garder une progression non vérifiable (principe cardinal : jamais de fausse
//    progression — choix de l'implémentation, ce n'est pas une citation de la spec).
function repeatTotalForSize(step, sizeIndex) {
  if (Array.isArray(step?.total)) {
    const v = Number(step.total[sizeIndex ?? 0])
    return Number.isFinite(v) ? v : null
  }
  if (typeof step?.total === 'number' && Number.isFinite(step.total)) return step.total
  return null
}

function isRepeatStep(step) {
  return !!(step?.repeat || step?.total != null)
}

export function reconcileReaderState(oldReader, oldState, newReader) {
  const state = freshState()
  const report = freshReport()

  const safeOldReader = oldReader && typeof oldReader === 'object' ? oldReader : {}
  const safeNewReader = newReader && typeof newReader === 'object' ? newReader : {}
  const safeOldState = oldState && typeof oldState === 'object' ? oldState : {}

  const oldSections = Array.isArray(safeOldReader.sections) ? safeOldReader.sections : []
  // Résolution O(1) par id (au lieu d'un `.find` relançant un scan linéaire de
  // oldSections à chaque entrée `done`/`counters` ci-dessous) — même idiome que
  // `newSectionById` plus bas, appliqué côté ancien reader.
  const oldSectionById = new Map(oldSections.map((s) => [s.id, s]))
  const oldSizeLabels = Array.isArray(safeOldReader.sizeLabels) ? safeOldReader.sizeLabels : []
  const newSizeLabels = Array.isArray(safeNewReader.sizeLabels) ? safeNewReader.sizeLabels : []

  // --- 1) size : remappage par LABEL, jamais par index brut. ---------------
  // Pas d'ancien état / pas d'anciennes tailles → rien à perdre : c'est un état
  // NEUF (report à zéro), pas une réinitialisation (« oldState vide → state
  // neuf cohérent, report à zéro »), distinct du cas où l'ancienne taille existait
  // mais son libellé a disparu du nouveau reader (là, sizeReset=true).
  const hadOldState = oldState != null
  const hadOldSizeLabels = oldSizeLabels.length > 0
  if (hadOldState && hadOldSizeLabels) {
    const oldSizeIdx = typeof safeOldState.size === 'number' ? safeOldState.size : 0
    const oldLabel = oldSizeLabels[oldSizeIdx]
    const remapped = oldLabel != null ? newSizeLabels.indexOf(oldLabel) : -1
    if (remapped >= 0) {
      state.size = remapped
    } else {
      state.size = 0
      report.sizeReset = true
    }
  }

  // --- 2) index des deux readers pour la résolution par contenu. -----------
  const oldIndex = buildIndex(safeOldReader)
  const newIndex = buildIndex(safeNewReader)

  // --- 3) done -------------------------------------------------------------
  const oldDone = safeOldState.done && typeof safeOldState.done === 'object' ? safeOldState.done : {}
  for (const [oldId, val] of Object.entries(oldDone)) {
    if (!val) continue
    const sectionId = oldId.split('#')[0]
    const oldStepIndex = Number(oldId.slice(sectionId.length + 1))
    const oldSection = oldSectionById.get(sectionId)
    const oldStep = oldSection?.steps?.[oldStepIndex]
    if (!oldStep) continue
    const key = textKey(oldStep)
    const match = resolveMatch(sectionId, key, oldIndex, newIndex, safeNewReader)
    if (match) {
      state.done[`${sectionId}#${match.idx}`] = true
      report.doneKept++
    } else {
      report.doneLost++
    }
  }

  // --- 4) counters -----------------------------------------------------------
  const oldCounters =
    safeOldState.counters && typeof safeOldState.counters === 'object' ? safeOldState.counters : {}
  for (const [oldId, val] of Object.entries(oldCounters)) {
    const sectionId = oldId.split('#')[0]
    const oldStepIndex = Number(oldId.slice(sectionId.length + 1))
    const oldSection = oldSectionById.get(sectionId)
    const oldStep = oldSection?.steps?.[oldStepIndex]
    if (!oldStep) continue
    const key = textKey(oldStep)
    const match = resolveMatch(sectionId, key, oldIndex, newIndex, safeNewReader)
    if (match && isRepeatStep(match.newStep)) {
      const newTotal = repeatTotalForSize(match.newStep, state.size)
      if (newTotal == null) {
        // Total non résolvable → on ne peut pas vérifier que la valeur ancienne reste
        // dans les bornes. Conservateur : abandon plutôt que fausse progression.
        report.countersLost++
      } else {
        state.counters[`${sectionId}#${match.idx}`] = Math.min(val, newTotal)
        report.countersKept++
      }
    } else {
      report.countersLost++
    }
  }

  // --- 5) état par grille (chartRows / chartReps / chartFrames) --------------
  // Modèle vivant depuis le multi-grilles (09/07) + calage (10/07) : trois maps
  // indexées par `section.id` (clé STABLE — pas d'ambiguïté d'index contrairement à
  // done/counters, donc réconciliation directe par id). On transfère vers les sections
  // du NOUVEAU reader qui « sont une grille » (même prédicat que le lecteur), en bornant
  // rang/répétition aux dimensions de la nouvelle grille ; toute entrée non transférable
  // est ABANDONNÉE et COMPTÉE (jamais de perte silencieuse, jamais de fausse progression).
  const newSections = Array.isArray(safeNewReader.sections) ? safeNewReader.sections : []
  const newSectionById = new Map(newSections.map((s) => [s.id, s]))

  // Source des rangs à transférer : la map `chartRows` du modèle actuel (multi-grilles
  // depuis le 09/07/2026). La compat avec l'ancien `chartRow` nu (< 09/07) a été retirée
  // le 13/08/2026 (ménage pré-1.0) : « 0 sur 63 » projets réels dans les 30 sauvegardes
  // archivées, réserve produit acceptée (fenêtre de mesure commençant après la
  // migration — voir le message de commit).
  const sourceChartRows =
    safeOldState.chartRows && typeof safeOldState.chartRows === 'object' ? safeOldState.chartRows : {}

  // chartRows[secId] : rang courant (1-based). Section survit + grille → min(oldRow, R)
  // si R connu, sinon oldRow tel quel ; sinon abandon + chartRowsLost.
  for (const [secId, rawRow] of Object.entries(sourceChartRows)) {
    const sec = newSectionById.get(secId)
    const oldRow = Number(rawRow)
    if (!sec || !isChartSection(sec, safeNewReader) || !Number.isFinite(oldRow)) {
      report.chartRowsLost++
      continue
    }
    const R = chartRowsBound(effectiveChart(sec, safeNewReader))
    state.chartRows[secId] = R != null ? Math.max(1, Math.min(oldRow, R)) : oldRow
    report.chartRowsKept++
  }

  // chartReps[secId] : répétition courante (1-based). Idem avec le total reps=T si connu.
  const oldChartReps =
    safeOldState.chartReps && typeof safeOldState.chartReps === 'object' ? safeOldState.chartReps : {}
  for (const [secId, rawRep] of Object.entries(oldChartReps)) {
    const sec = newSectionById.get(secId)
    const oldRep = Number(rawRep)
    if (!sec || !isChartSection(sec, safeNewReader) || !Number.isFinite(oldRep)) {
      report.chartRepsLost++
      continue
    }
    const T = chartRepsBound(effectiveChart(sec, safeNewReader))
    state.chartReps[secId] = T != null ? Math.max(1, Math.min(oldRep, T)) : oldRep
    report.chartRepsKept++
  }

  // chartFrames[secId] : calage géométrique (marges). Transfert TEL QUEL si la section
  // reste une grille — PAS de bornage (c'est une calibration, pas une progression) et
  // l'absence de rang courant n'empêche pas de garder le calage. Sinon abandon + Lost.
  const oldChartFrames =
    safeOldState.chartFrames && typeof safeOldState.chartFrames === 'object' ? safeOldState.chartFrames : {}
  for (const [secId, frame] of Object.entries(oldChartFrames)) {
    const sec = newSectionById.get(secId)
    if (!sec || !isChartSection(sec, safeNewReader)) {
      report.chartFramesLost++
      continue
    }
    state.chartFrames[secId] = frame
    report.chartFramesKept++
  }

  // chartCurtains[secId] : repère de progression horizontale dans le rang (rideau).
  // Transfert TEL QUEL si la section reste une grille — même traitement que chartFrames
  // (repère de lecture, pas une progression bornée par rows/cols). Sinon abandon + Lost.
  const oldChartCurtains =
    safeOldState.chartCurtains && typeof safeOldState.chartCurtains === 'object' ? safeOldState.chartCurtains : {}
  for (const [secId, curtain] of Object.entries(oldChartCurtains)) {
    const sec = newSectionById.get(secId)
    if (!sec || !isChartSection(sec, safeNewReader)) {
      report.chartCurtainsLost++
      continue
    }
    state.chartCurtains[secId] = curtain
    report.chartCurtainsKept++
  }

  return { state, report }
}
