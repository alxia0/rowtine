// Visionneuse photo plein écran (lightbox) — état global partagé par toutes les vues.
// Une seule instance de <PhotoLightbox> est montée dans App.vue ; n'importe quelle photo
// peut l'ouvrir via open(photos, index).
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useLightboxStore = defineStore('lightbox', () => {
  const photos = ref([]) // tableau de data URLs (ou URLs)
  const index = ref(0)
  const open = ref(false)

  const current = computed(() => photos.value[index.value] || '')
  const hasMany = computed(() => photos.value.length > 1)

  function show(list, i = 0) {
    const arr = (Array.isArray(list) ? list : [list]).filter(Boolean)
    if (!arr.length) return
    photos.value = arr
    index.value = Math.min(Math.max(0, i), arr.length - 1)
    open.value = true
  }
  function close() {
    open.value = false
  }
  function next() {
    if (photos.value.length) index.value = (index.value + 1) % photos.value.length
  }
  function prev() {
    if (photos.value.length) index.value = (index.value - 1 + photos.value.length) % photos.value.length
  }

  return { photos, index, open, current, hasMany, show, close, next, prev }
})
