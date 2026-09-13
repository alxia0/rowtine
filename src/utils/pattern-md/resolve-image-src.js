// resolveImageSrc — résout le chemin d'image porté par une ligne Rowtine-MD
// (`![alt](chemin)`) vers une URL affichable dans l'éditeur CM6, à partir
// d'une map basename → URL construite au chargement local des fichiers
// images (`_images/`, cf. main.js). Pur, sans IO, sans DOM.
//
// Règle de résolution : comparaison par BASENAME (dernier segment après `/`)
// du chemin du MD contre les clés de la map. Le MD porte des chemins
// relatifs au PDF (`_images/p01-1.png`, `img/photo-<hash>.png`) qui ne
// correspondent à aucune arborescence réelle une fois chargés côté
// navigateur (un <input webkitdirectory> ne donne accès qu'à un nom de
// fichier, jamais à un chemin absolu résoluble) — seul le nom de fichier
// final est donc un identifiant fiable.
//
// Un chemin déjà en `data:` (image déjà résolue en base64, ex. après
// extraction PDF) est renvoyé tel quel : il n'y a rien à résoudre.
export function resolveImageSrc(mdPath, imageMap) {
  const path = String(mdPath ?? '')
  if (path.startsWith('data:')) return path
  if (!imageMap) return null
  // App : la map est clée par chemin d'asset complet (img/photo-<hash>.png).
  // Banc : la map est clée par basename (webkitdirectory ne donne que le nom).
  // Essayer le chemin tel quel d'abord, puis le basename — les deux résolvent.
  if (imageMap.get(path)) return imageMap.get(path)
  const basename = path.split('/').pop()
  if (!basename) return null
  return imageMap.get(basename) || null
}
