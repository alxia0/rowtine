// Résolution de la photo de couverture d'un projet.
// Helper pur (pas de Vue) : `coverIndex` est un INDEX ENTIER dans project.photos, PAS une
// dataURL — on évite ainsi de dupliquer une photo (~2,7 Mo en base64) dans projet.json à la
// sauvegarde (cf. S2). Défaut : 1re photo du projet ; à défaut, couverture du patron lié.
import { patternCoverOf } from './pattern-cover'

/**
 * @param {object|null|undefined} project
 * @param {object|null|undefined} pattern
 * @returns {string} dataURL de la couverture résolue, ou '' si aucune photo disponible
 */
export function resolveCover(project, pattern) {
  const photos = project?.photos || []
  const idx = project?.coverIndex ?? 0
  return photos[idx] || photos[0] || patternCoverOf(pattern)
}
