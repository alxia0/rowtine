// Relais entre l'écran de suivi (ReaderView) et l'écran de correction
// (CorrectionView), pour ce que l'URL ne peut pas porter : l'état du chrono à
// l'instant du départ. Même forme que import-handoff.js — set() / take(), take()
// EFFACE : jamais de relais périmé réutilisé au montage.
//
// `chronoWasRunning` est la pièce qui compte : au retour, ReaderView relance la
// session si elle tournait à l'aller. La fermeture, elle, n'est plus l'affaire
// d'aucun écran (lot « chrono unifié », 2026-08-30) : le garde « sortie de bulle »
// du routeur ferme en sortant du projet — et l'écran de correction est dans la
// bulle. L'ancien champ `chronoAdopted` (transport de l'état d'« adoption » de la
// session, restauré au retour pour éviter qu'elle ne dérive) a disparu avec le
// concept : plus aucune sortie d'écran ne ferme, plus rien à épargner.
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useCorrectionHandoff = defineStore('correction-handoff', () => {
  const pending = ref(null)

  function set(payload) {
    pending.value = payload || null
  }
  function take() {
    const p = pending.value
    pending.value = null
    return p
  }

  return { pending, set, take }
})
