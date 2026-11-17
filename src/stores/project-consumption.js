// Pop-up « combien de pelotes as-tu réellement utilisées ? » (YarnConsumptionDialog) —
// état global minimal : juste son ouverture/fermeture. Même motif que color-picker.js :
// sert à ce que le retour Android (App.vue) puisse fermer ce dialogue en priorité au lieu
// de quitter l'écran. Pas de payload ici : le composable `useProjectConsumption` (appelé
// depuis ProjectDetailView / ProjectCard, les deux points d'entrée qui peuvent clore un
// projet) reste propriétaire des laines concernées et du statut à appliquer. Règle
// (décision produit) : comme colorPicker, fermer CE dialogue (y compris via ce `close()`,
// donc le Retour Android) vaut Annuler : rien n'est consommé et le statut ne change pas ; le
// composable traduit cette fermeture en annulation.
import { defineToggleStore } from '@/stores/toggle-store'

export const useProjectConsumptionStore = defineToggleStore('projectConsumption')
