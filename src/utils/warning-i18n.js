// Traduction d'un avertissement du moteur à l'AFFICHAGE. Vit côté application (le moteur,
// lui, reste zéro-dépendance i18n — cf. warning-codes.js).
//
// Tolérant à la chaîne brute : certains « motifs » du rapport de synchronisation viennent
// d'ailleurs que du moteur (`patron-md-sync.js:204` transporte une erreur de résolution de
// fichier). Une chaîne passe telle quelle plutôt que de disparaître — ne jamais perdre
// d'information est plus important que la pureté du format.
import { isStructuredWarning, fallbackWarningText } from '@/utils/pattern-md/warning-codes'

export function warningText(w, t) {
  if (typeof w === 'string') return w
  if (isStructuredWarning(w)) {
    const params = { ...w.params }
    // Le moteur transporte la CLÉ du bloc (`blockKey`) ; le libellé affiché est traduit ici —
    // sinon « Abréviations » ressortirait en français au milieu d'un écran allemand (piège
    // mesuré : vue-i18n efface silencieusement un paramètre `{block}` jamais fourni si on
    // laissait passer `blockKey` tel quel).
    if (params.blockKey) params.block = t(`warnings.blockName.${params.blockKey}`)
    return t(`warnings.${w.code}`, params)
  }
  return fallbackWarningText(w)
}
