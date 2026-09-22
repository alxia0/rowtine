// Choix de la source d'une photo (feuille maison, décision produit du 04/09/2026 option
// (a)) — partagé par toutes les vues via une seule instance de <PhotoSourceSheet> montée
// dans App.vue. `askSource(extraLabel)` ouvre la feuille et renvoie une promesse résolue
// avec 'gallery' | 'camera' (bouton correspondant), 'extra' (4e bouton optionnel, affiché
// seulement si `extraLabel` est fourni, décision du 22/09/2026 pour unifier les menus
// d'ajout de photo du patron avec la feuille standard) ou null (Annuler).
// Pourquoi une promesse : pickImage() (utils/photo.js) est une fonction async hors
// composant et la feuille est un composant — la promesse est le seul pont entre les deux,
// l'await de l'appelant suspend son flux jusqu'au geste. Pourquoi un store : le composant
// est monté UNE FOIS dans App.vue, très loin des vues qui déclenchent l'ajout de photo ;
// le store porte l'état ouvert/fermé et le resolver, exactement comme cropper.js.
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const usePhotoSourceStore = defineStore('photo-source', () => {
  const open = ref(false)
  // Libellé du 4e bouton optionnel, ou null si aucun (feuille à 3 boutons, comportement
  // historique). Posé par askSource, relâché par settle : jamais de fuite entre deux
  // demandes successives (un askSource() sans argument après un askSource(label) ne doit
  // pas hériter du libellé précédent).
  const extra = ref(null)
  let resolver = null

  function askSource(extraLabel = null) {
    open.value = true
    extra.value = extraLabel
    return new Promise((resolve) => {
      // Remplace un éventuel resolver précédent (même sémantique que cropper.js :
      // singleton, la dernière demande gagne ; la feuille modale rend le double appel
      // simultané improbable en pratique).
      resolver = resolve
    })
  }
  // Appelé par le composant : `choice` = 'gallery' | 'camera' | 'extra' | null si annulé.
  function settle(choice) {
    open.value = false
    extra.value = null
    const r = resolver
    resolver = null
    if (r) r(choice)
  }

  return { open, extra, askSource, settle }
})
