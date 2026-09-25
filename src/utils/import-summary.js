// Bilan du patron tel qu'enregistré, pour la carte « Ton patron est importé » de l'écran
// d'import (LocalPdfImportView.vue, bloc de succès). Module PUR : ne lit que ce que les deux
// voies d'import (PDF et zip) posent dans `pattern.reader` — aucune dépendance au store, aucun
// accès DOM. Reçoit le patron TEL QUE PASSÉ À `patternsStore.add` (mêmes champs des deux
// voies, cf. le commentaire d'`ensureSaved` dans LocalPdfImportView.vue).
import { sectionIsChart } from './reader-correction'
import { readerProgress, isSingleSize } from './reader'

// { sections, steps, sizes, charts, singleSize } :
// - sections : sections de reader.sections HORS sections-diagramme (sectionIsChart) — une
//   grille promue (promote-grids.js) compte dans `charts`, jamais ici ;
// - steps : étapes cochables, tous rangs confondus (readerProgress(reader).total compte
//   EXACTEMENT ce que checkableStepsOf/isCheckable comptent section par section — une
//   section-diagramme n'y ajoute rien, son unique step `{chart:true}` n'est pas cochable) ;
// - sizes : nombre de libellés dans reader.sizeLabels, sentinelle « Taille unique » comprise
//   (elle compte alors pour 1, cf. singleSize ci-dessous — c'est l'appelant qui décide de la
//   présentation « 1 + taille unique ») ;
// - singleSize : isSingleSize(reader.sizeLabels), même prédicat que le reste de l'app ;
// - charts : sections QUE LE LECTEUR AFFICHE AVEC UN DIAGRAMME (sectionIsChart), jamais le
//   repli `reader.chart` seul — un `reader.chart` sans section correspondante n'est pas suivable
//   rang par rang, il ne doit donc pas gonfler ce compteur.
export function summarizeImportedPattern(pattern) {
  const reader = pattern?.reader
  const allSections = Array.isArray(reader?.sections) ? reader.sections : []
  const chartSections = allSections.filter(sectionIsChart)
  const sizeLabels = Array.isArray(reader?.sizeLabels) ? reader.sizeLabels : []
  return {
    sections: allSections.length - chartSections.length,
    steps: readerProgress(reader).total,
    sizes: sizeLabels.length,
    charts: chartSections.length,
    singleSize: isSingleSize(sizeLabels),
  }
}
