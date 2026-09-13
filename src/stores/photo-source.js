// Choix de la source d'une photo (feuille maison, décision produit du 04/09/2026 option
// (a)) — partagé par toutes les vues via une seule instance de <PhotoSourceSheet> montée
// dans App.vue. `askSource()` ouvre la feuille et renvoie une promesse résolue avec
// 'gallery' | 'camera' (bouton correspondant) ou null (Annuler).
// Pourquoi une promesse : pickImage() (utils/photo.js) est une fonction async hors
// composant et la feuille est un composant — la promesse est le seul pont entre les deux,
// l'await de l'appelant suspend son flux jusqu'au geste. Pourquoi un store : le composant
// est monté UNE FOIS dans App.vue, très loin des vues qui déclenchent l'ajout de photo ;
// le store porte l'état ouvert/fermé et le resolver, exactement comme cropper.js.
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const usePhotoSourceStore = defineStore('photo-source', () => {
  const open = ref(false)
  let resolver = null

  function askSource() {
    open.value = true
    return new Promise((resolve) => {
      // Remplace un éventuel resolver précédent (même sémantique que cropper.js :
      // singleton, la dernière demande gagne ; la feuille modale rend le double appel
      // simultané improbable en pratique).
      resolver = resolve
    })
  }
  // Appelé par le composant : `choice` = 'gallery' | 'camera' | null si annulé.
  function settle(choice) {
    open.value = false
    const r = resolver
    resolver = null
    if (r) r(choice)
  }

  return { open, askSource, settle }
})
