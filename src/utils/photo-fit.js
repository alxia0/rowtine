// Taille "au repos" d'une photo dans la visionneuse plein écran (galeries
// zoomables, correctif du 09/08/2026) : helper pur (pas de Vue/DOM), testable sans jsdom.
//
// Le pincement fait grandir un conteneur défilant (`.lb__canvas` dans PhotoLightbox.vue) dont
// la taille pilote le déplacement (scrollLeft/scrollTop). Si ce conteneur affichait toujours
// l'image en `object-fit: contain` étiré à 100 % de sa propre taille, une petite photo (basse
// résolution, cas fréquent des photos extraites d'un PDF de patron) serait agrandie au-delà de
// sa taille naturelle DÈS le zoom 100 % — flou visible là où l'ancienne visionneuse
// (`max-width/max-height: 100%`, jamais d'agrandissement) restait nette.
//
// `fitWithinBox` reproduit le calcul d'`object-fit: scale-down` (ne jamais dépasser la taille
// naturelle, mais réduire si l'image est plus grande que la boîte disponible) — c'est la base
// « zoom 100 % ». Le composant multiplie ensuite cette base par `zoom / 100` pour la taille
// réelle du conteneur : la base ne bouge jamais, seul le zoom la fait grandir au-delà.

/**
 * @param {number} natW largeur intrinsèque de l'image (naturalWidth)
 * @param {number} natH hauteur intrinsèque de l'image (naturalHeight)
 * @param {number} boxW largeur disponible (viewport)
 * @param {number} boxH hauteur disponible (viewport)
 * @returns {{w:number,h:number}|null} taille de base (zoom 100 %), ou `null` si une dimension
 *   manque (image pas encore chargée, ou viewport pas encore mesurable) — l'appelant doit
 *   prévoir un repli tant que `null`.
 */
export function fitWithinBox(natW, natH, boxW, boxH) {
  if (!natW || !natH || !boxW || !boxH) return null
  const scale = Math.min(boxW / natW, boxH / natH, 1) // 1 = jamais agrandir au-delà du naturel
  return { w: natW * scale, h: natH * scale }
}

// ---------------------------------------------------------------------------
// Affichage pivoté d'une image PANORAMIQUE dans un viewport PORTRAIT (12/08/2026).
//
// Constat sur appareil : la capture « une année entière de grille calendaire » du guide
// (`07c-stats-annee.webp`, 1920 × 305) s'ouvre sur un téléphone tenu verticalement en une bande
// de quelques millimètres de haut — illisible tant qu'on n'a pas pincé. Une illustration ne
// devrait pas exiger un geste pour être comprise. La capture ne change pas : c'est la
// visionneuse qui l'accueille mieux, en la présentant d'un quart de tour (technique classique
// des visionneuses de plans et de panoramas), l'utilisatrice tournant ensuite son appareil.
//
// SEUIL 3.0, justifié dans DEUX directions indépendantes :
//
//  1. Les images réelles. Mesure du 12/08 sur les 200 fichiers de `src/content/guide/images*/` :
//     le panorama de l'année est à 6,30, et l'image suivante la plus large de tout le guide est
//     à 1,64 (captures de tablette 1440 × 876). Le trou entre 1,64 et 6,30 est immense ; 3,0 est
//     au milieu. Les formats courants des photos de l'utilisatrice restent tous en dessous :
//     4:3 = 1,33, 16:9 = 1,78, 2:1 = 2,00.
//  2. Un test existant fixe le plancher. `tests/unit/photo-lightbox-zoom.spec.js` place une image
//     de rapport 2,0 (2000 × 1000) dans un viewport portrait (300 × 800) et attend la taille
//     NON pivotée. Tout seuil ≤ 2,0 rendrait ce test faux : le seuil doit être > 2,0.
//
// TROISIÈME CLAUSE, l'image ne tient pas déjà en entier. Le rapport et l'orientation ne suffisent
// pas : la visionneuse sert aussi des photos extraites d'un PDF de patron, souvent en basse
// résolution. Une bandelette de 300 × 100 (rapport 3,0) tient déjà tout entière dans un viewport
// de téléphone : `fitWithinBox` la rend à sa taille naturelle (elle ne l'agrandit JAMAIS) dans
// les deux sens, la pivoter ne gagnerait pas un pixel et ne ferait que dérouter. Pas de nombre
// magique : on compare les dimensions naturelles à celles du viewport.
//
// ⚠️ Les trois clauses sont volontairement écrites SÉPARÉMENT, et chacune est observable seule.
// Une première version remplaçait cette troisième clause par une comparaison des surfaces rendues
// (« la rotation doit agrandir »). Elle donnait exactement les mêmes réponses — mais elle
// IMPLIQUAIT mathématiquement la clause d'orientation, qui devenait du code mort : supprimer
// `boxW >= boxH` ne faisait rougir aucun test (mutation vérifiée le 12/08). Ne pas revenir à
// cette forme : elle rend une clause du critère intestable.
export const PANORAMA_MIN_RATIO = 3

/**
 * Faut-il présenter cette image pivotée d'un quart de tour dans ce viewport ?
 *
 * @param {number} natW largeur intrinsèque de l'image (naturalWidth)
 * @param {number} natH hauteur intrinsèque de l'image (naturalHeight)
 * @param {number} boxW largeur disponible (viewport)
 * @param {number} boxH hauteur disponible (viewport)
 * @returns {boolean} vrai seulement si les TROIS clauses sont réunies : image nettement plus
 *   large que haute, viewport plus haut que large, et image qui ne tient pas déjà en entier.
 */
export function shouldRotatePanorama(natW, natH, boxW, boxH) {
  if (!natW || !natH || !boxW || !boxH) return false
  if (natW / natH < PANORAMA_MIN_RATIO) return false // pas assez panoramique
  if (boxW >= boxH) return false // viewport déjà en paysage : l'image s'y affiche bien telle quelle
  if (natW <= boxW && natH <= boxH) return false // tient déjà en entier : la pivoter ne gagne rien
  return true
}
