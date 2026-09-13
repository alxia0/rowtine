// Vrai dès qu'il y a quelque chose à perdre : texte de l'éditeur modifié par rapport au
// snapshot d'ouverture, OU l'état de travail des diagrammes (workingReader) diffère de
// baseReader (actions image immédiates, retour terrain 27/08/2026 — remplace l'ancien
// pendingOps, une simple intention en attente). Pur → testable, réutilisable par la garde
// de sortie de CorrectionView.
export function isDirty(mdInitial, draftMd, chartsChanged) {
  if (draftMd !== mdInitial) return true
  return !!chartsChanged
}
