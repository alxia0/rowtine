// Fabrique un petit store Pinia « ouvert/fermé » minimal : juste sa visibilité, sans payload.
// Partagée par les dialogues dont l'état applicatif vit ailleurs (StashView pour
// color-picker, le composable useProjectConsumption pour project-consumption) — cf. le
// commentaire de chaque store appelant pour le pourquoi de deux stores distincts plutôt
// qu'un seul partagé (le retour Android, App.vue, doit pouvoir fermer l'un sans toucher
// l'autre, et leurs conséquences à la fermeture diffèrent).
import { defineStore } from 'pinia'
import { ref } from 'vue'

export function defineToggleStore(id) {
  return defineStore(id, () => {
    const open = ref(false)
    function close() {
      open.value = false
    }
    return { open, close }
  })
}
