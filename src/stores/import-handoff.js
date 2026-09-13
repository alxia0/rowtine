// Relais de fichier PDF entre l'écran Bibliothèque (où l'utilisateur choisit le fichier,
// geste nécessaire pour ouvrir le sélecteur natif) et l'écran de progression d'import.
// take() renvoie le fichier ET l'efface : jamais de fichier périmé réutilisé au montage.
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useImportHandoff = defineStore('import-handoff', () => {
  const pendingFile = ref(null)

  function set(file) {
    pendingFile.value = file || null
  }
  function take() {
    const f = pendingFile.value
    pendingFile.value = null
    return f
  }

  return { pendingFile, set, take }
})
