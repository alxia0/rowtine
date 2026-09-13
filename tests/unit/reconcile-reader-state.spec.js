// Unitaire — réconciliation de la progression (readerState) par CONTENU quand le
// patron.md est réédité en externe. Principe cardinal : jamais de
// fausse coche, jamais de fausse progression, jamais de perte silencieuse (tout
// écart est comptabilisé dans `report`).
import { describe, it, expect } from 'vitest'
import { reconcileReaderState } from '@/backup/reconcile-reader-state'

const R = (sections, sizeLabels = ['T']) => ({ sizeLabels, sections })
const S = (id, steps) => ({ id, title: id, kind: 'texte', steps })
// Section « grille » telle que la voit le lecteur (visibleChartSections) : elle résout
// vers une grille effective (sa `chart` propre, ou le repli `reader.chart`) ET porte au
// moins une étape diagramme (`st.chart`). rows/reps sont des NOMBRES simples portés par
// l'objet chart (cf. nextChartPosition dans utils/reader.js).
const CHART = (id, chart = {}, extraSteps = []) => ({
  id,
  title: id,
  kind: 'diagramme',
  chart,
  steps: [{ chart: true }, ...extraSteps],
})

describe('reconcileReaderState — done (coches)', () => {
  it('step inchangé → done transféré tel quel', () => {
    const oldR = R([S('corps', [{ t: 'monter' }, { t: 'rang endroit' }])])
    const oldSt = { size: 0, done: { 'corps#1': true }, counters: {}, chartRow: 0 }
    const newR = R([S('corps', [{ t: 'monter' }, { t: 'rang endroit' }])])
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    expect(state.done['corps#1']).toBe(true)
    expect(report.doneKept).toBe(1)
    expect(report.doneLost).toBe(0)
  })

  it('step inséré avant : la coche suit le texte, pas l’index', () => {
    const oldR = R([S('corps', [{ t: 'monter' }, { t: 'rang endroit' }])])
    const oldSt = { size: 0, done: { 'corps#1': true }, counters: {}, chartRow: 0 }
    const newR = R([S('corps', [{ t: 'monter' }, { t: 'NOUVEAU' }, { t: 'rang endroit' }])])
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    expect(state.done['corps#2']).toBe(true) // 'rang endroit' est maintenant à l'index 2
    expect(state.done['corps#1']).toBeUndefined()
    expect(report.doneKept).toBe(1)
    expect(report.doneLost).toBe(0)
  })

  it('texte modifié → done abandonné (jamais de fausse coche)', () => {
    const oldR = R([S('corps', [{ t: 'monter' }, { t: 'rang endroit' }])])
    const oldSt = { size: 0, done: { 'corps#1': true }, counters: {}, chartRow: 0 }
    const newR = R([S('corps', [{ t: 'monter' }, { t: 'rang endroit modifié' }])])
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    expect(Object.keys(state.done)).toHaveLength(0)
    expect(report.doneKept).toBe(0)
    expect(report.doneLost).toBe(1)
  })

  it('step supprimé → done abandonné', () => {
    const oldR = R([S('corps', [{ t: 'monter' }, { t: 'rang endroit' }])])
    const oldSt = { size: 0, done: { 'corps#1': true }, counters: {}, chartRow: 0 }
    const newR = R([S('corps', [{ t: 'monter' }])])
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    expect(Object.keys(state.done)).toHaveLength(0)
    expect(report.doneLost).toBe(1)
  })

  it('texte dupliqué → ambigu → abandonné (jamais de fausse coche)', () => {
    const oldR = R([S('corps', [{ t: 'rang endroit' }, { t: 'rang endroit' }])])
    const oldSt = { size: 0, done: { 'corps#0': true }, counters: {}, chartRow: 0 }
    const newR = R([S('corps', [{ t: 'rang endroit' }, { t: 'rang endroit' }])])
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    expect(Object.keys(state.done)).toHaveLength(0)
    expect(report.doneLost).toBe(1)
  })

  it('texte dupliqué côté NOUVEAU seulement (ancien unique) → ambigu → abandonné', () => {
    const oldR = R([S('corps', [{ t: 'rang endroit' }, { t: 'autre' }])])
    const oldSt = { size: 0, done: { 'corps#0': true }, counters: {}, chartRow: 0 }
    const newR = R([S('corps', [{ t: 'rang endroit' }, { t: 'rang endroit' }, { t: 'autre' }])])
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    expect(Object.keys(state.done)).toHaveLength(0)
    expect(report.doneLost).toBe(1)
  })

  it('même clé texte mais section différente → non trouvé → abandonné', () => {
    const oldR = R([S('corps', [{ t: 'monter' }]), S('manche', [{ t: 'autre' }])])
    const oldSt = { size: 0, done: { 'corps#0': true }, counters: {}, chartRow: 0 }
    const newR = R([S('manche', [{ t: 'monter' }, { t: 'autre' }])])
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    expect(Object.keys(state.done)).toHaveLength(0)
    expect(report.doneLost).toBe(1)
  })

  it('plusieurs steps cochés dans plusieurs sections → chacun réconcilié indépendamment', () => {
    const oldR = R([
      S('corps', [{ t: 'monter' }, { t: 'rang endroit' }]),
      S('manche', [{ t: 'monter manche' }]),
    ])
    const oldSt = {
      size: 0,
      done: { 'corps#0': true, 'corps#1': true, 'manche#0': true },
      counters: {},
      chartRow: 0,
    }
    const newR = R([
      S('corps', [{ t: 'INTRO' }, { t: 'monter' }, { t: 'rang endroit' }]),
      S('manche', [{ t: 'monter manche' }]),
    ])
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    expect(state.done['corps#1']).toBe(true)
    expect(state.done['corps#2']).toBe(true)
    expect(state.done['manche#0']).toBe(true)
    expect(report.doneKept).toBe(3)
    expect(report.doneLost).toBe(0)
  })

  it('la clé texte inclut les comptes (stepTextToMd(t,c)) : un compte différent = ligne différente', () => {
    const oldR = R(
      [S('corps', [{ t: 'monter {{0}}', c: [[10]] }])],
      ['T']
    )
    const oldSt = { size: 0, done: { 'corps#0': true }, counters: {}, chartRow: 0 }
    const newR = R([S('corps', [{ t: 'monter {{0}}', c: [[12]] }])], ['T'])
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    expect(Object.keys(state.done)).toHaveLength(0)
    expect(report.doneLost).toBe(1)
  })
})

describe('reconcileReaderState — counters (répétitions)', () => {
  it('repeat conservé, nouveau total plus grand (5) → valeur ancienne (3) conservée', () => {
    const oldR = R([S('corps', [{ t: 'répéter', repeat: true, total: [3] }])])
    const oldSt = { size: 0, done: {}, counters: { 'corps#0': 3 }, chartRow: 0 }
    const newR = R([S('corps', [{ t: 'répéter', repeat: true, total: [5] }])])
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    expect(state.counters['corps#0']).toBe(3)
    expect(report.countersKept).toBe(1)
    expect(report.countersLost).toBe(0)
  })

  it('repeat conservé, nouveau total plus petit (2) → clampé à 2', () => {
    const oldR = R([S('corps', [{ t: 'répéter', repeat: true, total: [3] }])])
    const oldSt = { size: 0, done: {}, counters: { 'corps#0': 3 }, chartRow: 0 }
    const newR = R([S('corps', [{ t: 'répéter', repeat: true, total: [2] }])])
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    expect(state.counters['corps#0']).toBe(2)
    expect(report.countersKept).toBe(1)
    expect(report.countersLost).toBe(0)
  })

  it('step devenu non-répétition → compteur abandonné', () => {
    const oldR = R([S('corps', [{ t: 'répéter', repeat: true, total: [3] }])])
    const oldSt = { size: 0, done: {}, counters: { 'corps#0': 3 }, chartRow: 0 }
    const newR = R([S('corps', [{ t: 'répéter' }])]) // ligne texte identique mais n'est plus un repeat
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    expect(state.counters['corps#0']).toBeUndefined()
    expect(report.countersKept).toBe(0)
    expect(report.countersLost).toBe(1)
  })

  it('step de repeat introuvable (texte modifié) → compteur abandonné', () => {
    const oldR = R([S('corps', [{ t: 'répéter', repeat: true, total: [3] }])])
    const oldSt = { size: 0, done: {}, counters: { 'corps#0': 3 }, chartRow: 0 }
    const newR = R([S('corps', [{ t: 'répéter modifié', repeat: true, total: [5] }])])
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    expect(Object.keys(state.counters)).toHaveLength(0)
    expect(report.countersLost).toBe(1)
  })

  it('step de repeat ambigu (texte dupliqué) → compteur abandonné', () => {
    const oldR = R([S('corps', [{ t: 'répéter', repeat: true, total: [3] }, { t: 'autre' }])])
    const oldSt = { size: 0, done: {}, counters: { 'corps#0': 3 }, chartRow: 0 }
    const newR = R([
      S('corps', [{ t: 'répéter', repeat: true, total: [5] }, { t: 'répéter', repeat: true, total: [5] }, { t: 'autre' }]),
    ])
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    expect(Object.keys(state.counters)).toHaveLength(0)
    expect(report.countersLost).toBe(1)
  })

  it('total par taille : clamp utilise la valeur pour la taille réconciliée', () => {
    const oldR = R([S('corps', [{ t: 'répéter', repeat: true, total: [3, 10] }])], ['S', 'L'])
    const oldSt = { size: 1, done: {}, counters: { 'corps#0': 8 }, chartRow: 0 }
    const newR = R([S('corps', [{ t: 'répéter', repeat: true, total: [2, 6] }])], ['S', 'L'])
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    // taille réconciliée = 'L' (index 1) → total[1] = 6
    expect(state.size).toBe(1)
    expect(state.counters['corps#0']).toBe(6)
    expect(report.countersKept).toBe(1)
  })

  it('repeat sans total résolvable → compteur abandonné (jamais de fausse progression)', () => {
    const oldR = R([S('corps', [{ t: 'répéter', repeat: true }])])
    const oldSt = { size: 0, done: {}, counters: { 'corps#0': 7 }, chartRow: 0 }
    const newR = R([S('corps', [{ t: 'répéter', repeat: true }])])
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    expect(state.counters['corps#0']).toBeUndefined()
    expect(report.countersKept).toBe(0)
    expect(report.countersLost).toBe(1)
  })
})

describe('reconcileReaderState — size', () => {
  it('label conservé mais décalé d’index → remappé sur le bon index', () => {
    const oldR = R([S('corps', [{ t: 'a' }])], ['S', 'M', 'L'])
    const oldSt = { size: 0, done: {}, counters: {}, chartRow: 0 } // 'S'
    const newR = R([S('corps', [{ t: 'a' }])], ['XS', 'S', 'M', 'L']) // 'S' est maintenant index 1
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    expect(state.size).toBe(1)
    expect(report.sizeReset).toBe(false)
  })

  it('label disparu → size 0 + sizeReset', () => {
    const oldR = R([S('corps', [{ t: 'a' }])], ['S', 'M', 'L'])
    const oldSt = { size: 2, done: {}, counters: {}, chartRow: 0 } // 'L'
    const newR = R([S('corps', [{ t: 'a' }])], ['S', 'M'])
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    expect(state.size).toBe(0)
    expect(report.sizeReset).toBe(true)
  })

  it('oldState.size invalide (hors bornes) → size 0 + sizeReset', () => {
    const oldR = R([S('corps', [{ t: 'a' }])], ['S', 'M'])
    const oldSt = { size: 99, done: {}, counters: {}, chartRow: 0 }
    const newR = R([S('corps', [{ t: 'a' }])], ['S', 'M'])
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    expect(state.size).toBe(0)
    expect(report.sizeReset).toBe(true)
  })
})

describe('reconcileReaderState — état par grille (chartRows / chartReps / chartFrames)', () => {
  // Cas 1 — Transfert nominal : les 3 maps survivent quand la section reste une grille.
  it('nominal : rang/répétition/calage transférés par section.id, *Kept incrémentés', () => {
    const oldR = R([CHART('grilleA', { rows: 20, reps: 4 })])
    const oldSt = {
      size: 0,
      done: {},
      counters: {},
      chartRows: { grilleA: 5 },
      chartReps: { grilleA: 2 },
      chartFrames: { grilleA: { top: 10, bottom: 90 } },
    }
    const newR = R([CHART('grilleA', { rows: 20, reps: 4 })])
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    expect(state.chartRows.grilleA).toBe(5)
    expect(state.chartReps.grilleA).toBe(2)
    expect(state.chartFrames.grilleA).toEqual({ top: 10, bottom: 90 })
    expect(report.chartRowsKept).toBe(1)
    expect(report.chartRepsKept).toBe(1)
    expect(report.chartFramesKept).toBe(1)
    expect(report.chartRowsLost).toBe(0)
    expect(report.chartRepsLost).toBe(0)
    expect(report.chartFramesLost).toBe(0)
    // jamais de chartRow nu en sortie (modèle purement nouveau)
    expect(state.chartRow).toBeUndefined()
  })

  // Cas 2 — Bornage : grille rétrécie → rang/rép clampés au nouveau total.
  it('bornage : oldRow/oldRep > nouveaux totaux → clampés à rows/reps', () => {
    const oldR = R([CHART('grilleA', { rows: 20, reps: 6 })])
    const oldSt = {
      size: 0,
      done: {},
      counters: {},
      chartRows: { grilleA: 18 },
      chartReps: { grilleA: 6 },
      chartFrames: {},
    }
    const newR = R([CHART('grilleA', { rows: 10, reps: 4 })])
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    expect(state.chartRows.grilleA).toBe(10)
    expect(state.chartReps.grilleA).toBe(4)
    expect(report.chartRowsKept).toBe(1)
    expect(report.chartRepsKept).toBe(1)
  })

  // Cas 3 — rows/reps inconnus : grille présente mais sans dimension → transfert tel quel.
  it('rows/reps inconnus (grille sans dimension) → valeurs transférées telles quelles', () => {
    const oldR = R([CHART('grilleA', {})])
    const oldSt = {
      size: 0,
      done: {},
      counters: {},
      chartRows: { grilleA: 7 },
      chartReps: { grilleA: 3 },
      chartFrames: {},
    }
    const newR = R([CHART('grilleA', {})]) // ni rows ni reps
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    expect(state.chartRows.grilleA).toBe(7)
    expect(state.chartReps.grilleA).toBe(3)
    expect(report.chartRowsKept).toBe(1)
    expect(report.chartRepsKept).toBe(1)
  })

  // Cas 3bis — durcissement : rows/reps === 0 est traité comme INCONNU (borne `> 0`), donc
  // transfert tel quel, JAMAIS `min(oldRow, 0) → 1` (une régression `> 0` → `>= 0` réinitialiserait
  // le rang en douce). Verrouille explicitement ce chemin (le Cas 3 teste `{}` → NaN, chemin distinct).
  it('rows/reps === 0 (dimension nulle) → traité comme inconnu, valeurs transférées telles quelles', () => {
    const oldR = R([CHART('grilleA', { rows: 0, reps: 0 })])
    const oldSt = {
      size: 0,
      done: {},
      counters: {},
      chartRows: { grilleA: 7 },
      chartReps: { grilleA: 3 },
      chartFrames: {},
    }
    const newR = R([CHART('grilleA', { rows: 0, reps: 0 })])
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    expect(state.chartRows.grilleA).toBe(7)
    expect(state.chartReps.grilleA).toBe(3)
    expect(report.chartRowsKept).toBe(1)
    expect(report.chartRepsKept).toBe(1)
  })

  // Cas 4 — Section disparue : les 3 maps abandonnent l'entrée + comptent la perte.
  it('section disparue → les 3 maps perdent l’entrée, *Lost incrémentés', () => {
    const oldR = R([CHART('grilleA', { rows: 20, reps: 4 })])
    const oldSt = {
      size: 0,
      done: {},
      counters: {},
      chartRows: { grilleA: 5 },
      chartReps: { grilleA: 2 },
      chartFrames: { grilleA: { top: 0, bottom: 100 } },
    }
    const newR = R([S('corps', [{ t: 'a' }])]) // plus de grilleA
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    expect(state.chartRows.grilleA).toBeUndefined()
    expect(state.chartReps.grilleA).toBeUndefined()
    expect(state.chartFrames.grilleA).toBeUndefined()
    expect(report.chartRowsLost).toBe(1)
    expect(report.chartRepsLost).toBe(1)
    expect(report.chartFramesLost).toBe(1)
    expect(report.chartRowsKept).toBe(0)
  })

  // Cas 5 — Section plus une grille : même id mais plus d'étape diagramme → abandon.
  it('section existe mais n’est plus une grille (plus d’étape diagramme) → abandon + *Lost', () => {
    const oldR = R([CHART('grilleA', { rows: 20, reps: 4 })])
    const oldSt = {
      size: 0,
      done: {},
      counters: {},
      chartRows: { grilleA: 5 },
      chartReps: { grilleA: 2 },
      chartFrames: { grilleA: { top: 0, bottom: 100 } },
    }
    // même id 'grilleA' mais devenue une section texte (aucune étape st.chart, pas de sec.chart)
    const newR = R([S('grilleA', [{ t: 'plus de diagramme' }])])
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    expect(state.chartRows.grilleA).toBeUndefined()
    expect(state.chartReps.grilleA).toBeUndefined()
    expect(state.chartFrames.grilleA).toBeUndefined()
    expect(report.chartRowsLost).toBe(1)
    expect(report.chartRepsLost).toBe(1)
    expect(report.chartFramesLost).toBe(1)
  })

  // Cas 6 — Multi-grilles : une survit, une disparaît → conservation + perte indépendantes.
  it('multi-grilles : grilleA survit (conservée), grilleB disparue (perdue+comptée)', () => {
    const oldR = R([CHART('grilleA', { rows: 20, reps: 4 }), CHART('grilleB', { rows: 12, reps: 2 })])
    const oldSt = {
      size: 0,
      done: {},
      counters: {},
      chartRows: { grilleA: 5, grilleB: 3 },
      chartReps: { grilleA: 2, grilleB: 1 },
      chartFrames: { grilleA: { top: 5, bottom: 95 }, grilleB: { top: 0, bottom: 100 } },
    }
    const newR = R([CHART('grilleA', { rows: 20, reps: 4 })]) // grilleB retirée
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    expect(state.chartRows.grilleA).toBe(5)
    expect(state.chartRows.grilleB).toBeUndefined()
    expect(state.chartReps.grilleA).toBe(2)
    expect(state.chartFrames.grilleA).toEqual({ top: 5, bottom: 95 })
    expect(report.chartRowsKept).toBe(1)
    expect(report.chartRowsLost).toBe(1)
    expect(report.chartRepsKept).toBe(1)
    expect(report.chartRepsLost).toBe(1)
    expect(report.chartFramesKept).toBe(1)
    expect(report.chartFramesLost).toBe(1)
  })

  // Cas 8 — frame seul : calage conservé même sans rang courant (la calibration ne dépend
  // pas d'une progression).
  it('frame seul (chartFrames sans chartRows) → calage conservé si la section reste une grille', () => {
    const oldR = R([CHART('grilleA', { rows: 20 })])
    const oldSt = {
      size: 0,
      done: {},
      counters: {},
      chartRows: {},
      chartReps: {},
      chartFrames: { grilleA: { top: 5, bottom: 95 } },
    }
    const newR = R([CHART('grilleA', { rows: 20 })])
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    expect(state.chartFrames.grilleA).toEqual({ top: 5, bottom: 95 })
    expect(state.chartRows.grilleA).toBeUndefined()
    expect(report.chartFramesKept).toBe(1)
    expect(report.chartRowsLost).toBe(0)
  })

  // Résidu chartRow : la migration legacy (`chartRow` nu → 1re grille) a été retirée le
  // 13/08/2026 (nettoyage avant la 1.0, réserve produit acceptée — 0/63 projets réels dans les 30
  // sauvegardes archivées). `reconcileReaderState` ne lit plus QUE `oldState.chartRows` (la
  // map) ; un champ `chartRow` résiduel, quelle que soit sa valeur, est désormais purement et
  // simplement ignoré — ni migré, ni compté en perte.
  it('un chartRow nu résiduel (sans chartRows) est ignoré, aucune migration, aucune fausse perte', () => {
    const oldR = R([S('corps', [{ t: 'a' }])])
    const oldSt = { size: 0, done: {}, counters: {}, chartRow: 5 } // AUCUN chartRows
    const newR = R([CHART('grilleA', { rows: 20, reps: 4 })])
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    expect(Object.keys(state.chartRows)).toHaveLength(0)
    expect(state.chartRow).toBeUndefined()
    expect(report.chartRowsKept).toBe(0)
    expect(report.chartRowsLost).toBe(0)
  })

  it('chartRows (map) présent ET chartRow nu résiduel : la map fait foi, le résidu est ignoré', () => {
    const oldR = R([CHART('grilleA', { rows: 20, reps: 4 })])
    const oldSt = {
      size: 0,
      done: {},
      counters: {},
      chartRows: { grilleA: 8 },
      chartReps: {},
      chartFrames: {},
      chartRow: 3, // résidu hérité qui NE doit PAS écraser la map
    }
    const newR = R([CHART('grilleA', { rows: 20, reps: 4 })])
    const { state } = reconcileReaderState(oldR, oldSt, newR)
    expect(state.chartRows.grilleA).toBe(8)
    expect(state.chartRow).toBeUndefined()
  })
})

describe('reconcileReaderState — rideau de progression (chartCurtains)', () => {
  it('transféré tel quel si la section reste une grille, *Kept incrémenté', () => {
    const oldR = R([CHART('grilleA', { rows: 20, reps: 4 })])
    const oldSt = {
      size: 0,
      done: {},
      counters: {},
      chartRows: {},
      chartReps: {},
      chartFrames: {},
      chartCurtains: { grilleA: { x: 40, side: 'right' } },
    }
    const newR = R([CHART('grilleA', { rows: 20, reps: 4 })])
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    expect(state.chartCurtains.grilleA).toEqual({ x: 40, side: 'right' })
    expect(report.chartCurtainsKept).toBe(1)
    expect(report.chartCurtainsLost).toBe(0)
  })

  it('perdu (compté) si la grille disparaît du nouveau reader', () => {
    const oldR = R([CHART('grilleA', { rows: 20 })])
    const oldSt = {
      size: 0,
      done: {},
      counters: {},
      chartRows: {},
      chartReps: {},
      chartFrames: {},
      chartCurtains: { grilleA: { x: 40, side: 'right' } },
    }
    const newR = R([S('corps', [{ t: 'monter' }])])
    const { state, report } = reconcileReaderState(oldR, oldSt, newR)
    expect(state.chartCurtains.grilleA).toBeUndefined()
    expect(report.chartCurtainsLost).toBe(1)
  })
})

describe('reconcileReaderState — robustesse (jamais de throw, jamais de perte silencieuse)', () => {
  it('oldState vide/undefined → state neuf cohérent, report à zéro', () => {
    const newR = R([S('corps', [{ t: 'a' }])])
    const { state, report } = reconcileReaderState(undefined, undefined, newR)
    expect(state).toEqual({ size: 0, done: {}, counters: {}, chartRows: {}, chartReps: {}, chartFrames: {}, chartCurtains: {} })
    expect(report).toEqual({
      doneKept: 0,
      doneLost: 0,
      countersKept: 0,
      countersLost: 0,
      sizeReset: false,
      chartRowsKept: 0,
      chartRowsLost: 0,
      chartRepsKept: 0,
      chartRepsLost: 0,
      chartFramesKept: 0,
      chartFramesLost: 0,
      chartCurtainsKept: 0,
      chartCurtainsLost: 0,
    })
  })

  it('oldReader sans sections → pas de throw, state neuf', () => {
    const newR = R([S('corps', [{ t: 'a' }])])
    const oldSt = { size: 0, done: { x: true }, counters: { y: 1 }, chartRow: 3 }
    expect(() => reconcileReaderState({}, oldSt, newR)).not.toThrow()
    const { state } = reconcileReaderState({}, oldSt, newR)
    expect(state.done).toEqual({})
  })

  it('newReader sans sections → pas de throw, done/counters tous perdus (comptabilisés)', () => {
    const oldR = R([S('corps', [{ t: 'a' }, { t: 'b', repeat: true, total: [3] }])])
    const oldSt = { size: 0, done: { 'corps#0': true }, counters: { 'corps#1': 2 }, chartRow: 0 }
    expect(() => reconcileReaderState(oldR, oldSt, {})).not.toThrow()
    const { state, report } = reconcileReaderState(oldR, oldSt, {})
    expect(state.done).toEqual({})
    expect(state.counters).toEqual({})
    expect(report.doneLost).toBe(1)
    expect(report.countersLost).toBe(1)
  })

  it('newReader complètement null/undefined → pas de throw', () => {
    expect(() => reconcileReaderState(undefined, undefined, undefined)).not.toThrow()
    const { state, report } = reconcileReaderState(undefined, undefined, undefined)
    expect(state.size).toBe(0)
    expect(state.done).toEqual({})
    expect(report.sizeReset).toBe(false)
  })
})
