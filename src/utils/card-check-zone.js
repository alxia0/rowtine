// Zone d'appui qui coche une carte du lecteur : le premier tiers gauche de la
// carte, sur toute sa hauteur. En tricotant, on vise la case sans précision ;
// un appui juste à côté d'elle doit cocher, pas ouvrir le voile de correction.
// Borne droite exclue (tiers exact = hors zone). Une largeur non mesurable
// (0, négative, absente : jsdom, carte non rendue) ne coche jamais, le geste
// retombe alors sur le comportement par défaut de la carte.
export function inCheckZone(clientX, left, width) {
  if (!(width > 0) || !Number.isFinite(clientX) || !Number.isFinite(left)) return false
  const x = clientX - left
  return x >= 0 && x < width / 3
}
