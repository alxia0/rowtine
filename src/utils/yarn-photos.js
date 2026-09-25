import { boundedIndex } from './bounded-index'

// Galerie de photos d'une laine : `yarn.photos` (tableau de data URLs) + `yarn.coverIndex`,
// même forme que `project.photos`/`project.coverIndex` (src/stores/projects.js). Lecture
// tolérante de l'ANCIEN champ `photo` (chaîne unique, avant cette refonte) : une fiche
// déjà en base qui porte encore `photo` mais pas `photos` est lue comme une galerie à une
// seule photo, sans jamais être réécrite tant qu'elle n'est pas modifiée — même discipline
// que `reservationsOf`/`normalizeYarnReservations` (src/utils/yarn-usage.js).
export function photosOf(yarn) {
  if (Array.isArray(yarn?.photos) && yarn.photos.length) return yarn.photos
  if (yarn?.photo) return [yarn.photo]
  return []
}

// Photo de couverture : celle à `coverIndex`, repli sur la 1re si l'index est absent ou
// hors bornes (jamais d'exception, jamais de vignette qui disparaît pour un index invalide).
export function coverPhotoOf(yarn) {
  const photos = photosOf(yarn)
  if (!photos.length) return ''
  return photos[boundedIndex(yarn?.coverIndex, photos.length)]
}
