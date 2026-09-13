import { ref, onBeforeUnmount } from 'vue'

// Seuil du lecteur à deux volets — SOURCE DE VÉRITÉ UNIQUE.
// La hauteur fait partie du seuil : sans elle, un grand téléphone tourné en paysage
// (915×412) basculerait en deux volets sur 412 px de haut, inutilisable.
// Hauteur à 500 (et non 560) depuis le 28/07 (2e mesure du jour) : le seuil à 560, posé
// plus tôt le même jour après la mesure CDP sur la tablette cible (Nexus 7, Android 11,
// 1200×1920 physiques @320dpi, innerHeight = 584 px en paysage en mode gestuel, barre de
// navigation Android = 16 px de hauteur CSS), ne laissait que 24 px de marge. Or la barre
// de navigation Android en mode 3 boutons occupe 48 px CSS, pas 16 : sur cette même
// tablette, la hauteur retomberait alors à environ 552 px — sous 560, donc le même bug
// (mode deux volets inatteignable) réapparaîtrait au premier changement de réglage système
// de l'utilisatrice. 500 conserve 84 px de marge sur la tablette cible dans les deux modes
// de navigation, sans faire passer aucun téléphone connu (Mate 20 Pro : 780 px de large en
// paysage, échoue déjà sur la largeur ; Pixel 5 : 915×412, échoue déjà sur la hauteur, avec
// 88 px de marge sous le nouveau seuil).
// Le mode est lu en JS et non en CSS parce qu'il ne change pas que la mise en page : le
// fil remplace le diagramme épinglé par une ligne de renvoi. Deux seuils (un CSS, un JS)
// dériveraient tôt ou tard — la classe .reader--split est donc pilotée par ce booléen.
export const SPLIT_QUERY = '(min-width: 900px) and (min-height: 500px)'

export function useSplitReader() {
  const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(SPLIT_QUERY) : null
  const wide = ref(!!mq?.matches)
  const onChange = (e) => { wide.value = e.matches }
  // addListener : repli pour les WebView anciennes (Chrome < 63) — addEventListener sur
  // MediaQueryList n'y existe pas. La WebView de la tablette de référence est en 114, mais
  // l'app cible des appareils Android plus anciens.
  if (mq?.addEventListener) mq.addEventListener('change', onChange)
  else mq?.addListener?.(onChange)
  onBeforeUnmount(() => {
    if (mq?.removeEventListener) mq.removeEventListener('change', onChange)
    else mq?.removeListener?.(onChange)
  })
  return { wide }
}
