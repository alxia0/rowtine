// Pop-up sélecteur de couleur (ColorPickerDialog) — état global minimal : juste son
// ouverture/fermeture. Sert à ce que le retour Android (App.vue) puisse fermer le pop-up
// en priorité au lieu de quitter l'écran et perdre le formulaire de laine en cours de
// saisie (régression vs l'ancien <input type=color> natif, dont le Back système fermait
// proprement le dialogue). Pas de payload ici : contrairement à chartZoom/lightbox,
// StashView reste propriétaire de la couleur en cours et du callback de sélection.
import { defineToggleStore } from '@/stores/toggle-store'

export const useColorPickerStore = defineToggleStore('colorPicker')
