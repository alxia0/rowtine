// Recadrage in-app (promesse) — partagé par toutes les vues via une seule instance de
// <PhotoCropper> montée dans App.vue. `crop(dataUrl)` ouvre le recadreur et renvoie une
// promesse résolue avec la data URL recadrée (Valider) ou null (Annuler).
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useCropperStore = defineStore('cropper', () => {
  const open = ref(false)
  const src = ref('')
  let resolver = null

  function crop(dataUrl) {
    src.value = dataUrl
    open.value = true
    return new Promise((resolve) => {
      resolver = resolve
    })
  }
  // Appelé par le composant : `result` = data URL recadrée, ou null si annulé.
  function settle(result) {
    open.value = false
    src.value = ''
    const r = resolver
    resolver = null
    if (r) r(result)
  }

  return { open, src, crop, settle }
})
