// Recadrage in-app (promesse) — partagé par toutes les vues via une seule instance de
// <PhotoCropper> montée dans App.vue. `crop(dataUrl, ratio)` ouvre le recadreur et renvoie une
// promesse résolue avec la data URL recadrée (Valider) ou null (Annuler). `ratio` (largeur /
// hauteur) est optionnel : omis, le recadrage reste libre (comportement d'origine inchangé) ;
// fourni, le cadre est contraint à ce ratio (badge, §4 de la spec 2026-09-16).
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useCropperStore = defineStore('cropper', () => {
  const open = ref(false)
  const src = ref('')
  const aspect = ref(null)
  let resolver = null

  function crop(dataUrl, ratio = null) {
    src.value = dataUrl
    aspect.value = ratio
    open.value = true
    return new Promise((resolve) => {
      resolver = resolve
    })
  }
  // Appelé par le composant : `result` = data URL recadrée, ou null si annulé.
  function settle(result) {
    open.value = false
    src.value = ''
    aspect.value = null
    const r = resolver
    resolver = null
    if (r) r(result)
  }

  return { open, src, aspect, crop, settle }
})
