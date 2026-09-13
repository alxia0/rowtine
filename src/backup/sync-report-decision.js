// Rowtine — décision d'affichage du rapport de synchro MD. Pur :
// prend le `report` produit par `syncPatronMd` et décide, PROPORTIONNÉ à
// ce qu'il y a à dire :
//   - 'none'     : rien à synchroniser (aucun merged/skipped-avec-motif/erreur) → pas d'UI.
//   - 'snackbar' : au moins une fusion, et TOUTES propres (rien perdu/à signaler),
//                  aucun skipped ni erreur → une ligne discrète.
//   - 'modal'    : au moins une chose à signaler (progression perdue, avertissement,
//                  asset manquant, taille/ligne de grille réinitialisée, dossier
//                  ignoré avec motif, erreur) → la modale `SyncReportDialog`.
// Tolère les formes dégradées (`{ skipped: 'running' }` du drapeau in-progress de
// `syncPatronMd`, `report` null/absent) : traitées comme 'none', jamais de crash.
export function isMergedEntryFlagged(m) {
  if (!m) return false
  const r = m.reconcile || {}
  return (
    (r.doneLost || 0) > 0 ||
    (r.countersLost || 0) > 0 ||
    !!r.sizeReset ||
    // Perte d'état par grille (rang/répétition/calage/rideau non conservés à la re-synchro) :
    // remplace l'ancien `chartRowReset` (la réconciliation n'émet plus ce booléen, mais
    // quatre compteurs de perte). Une seule perte suffit à forcer la modale.
    (r.chartRowsLost || 0) + (r.chartRepsLost || 0) + (r.chartFramesLost || 0) + (r.chartCurtainsLost || 0) > 0 ||
    (Array.isArray(m.warnings) && m.warnings.length > 0) ||
    (Array.isArray(m.missingAssets) && m.missingAssets.length > 0)
  )
}

export function classifySyncReport(report) {
  if (!report || typeof report !== 'object') return { kind: 'none' }

  const merged = Array.isArray(report.merged) ? report.merged : []
  const skipped = Array.isArray(report.skipped) ? report.skipped : []
  const errors = Array.isArray(report.errors) ? report.errors : []
  const skippedWithReason = skipped.filter((s) => s && s.reason)

  if (merged.length === 0 && skippedWithReason.length === 0 && errors.length === 0) {
    return { kind: 'none' }
  }

  const anyFlagged = merged.some(isMergedEntryFlagged)
  if (merged.length > 0 && !anyFlagged && skippedWithReason.length === 0 && errors.length === 0) {
    return { kind: 'snackbar', count: merged.length }
  }

  return { kind: 'modal' }
}
