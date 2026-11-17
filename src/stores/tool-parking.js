// Pop-up « outils à libérer à la pause / à reprendre » (ToolParkingDialog) : état global
// minimal, juste son ouverture/fermeture. Même motif que project-consumption.js : sert à ce
// que le Retour Android (App.vue) ferme ce dialogue en priorité au lieu de quitter l'écran.
// Fermer ce dialogue sans valider (Retour Android compris) vaut Annuler ; le composable
// `useToolParking` traduit cette fermeture en annulation.
import { defineToggleStore } from '@/stores/toggle-store'

export const useToolParkingStore = defineToggleStore('toolParking')
