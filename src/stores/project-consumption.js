// Pop-up « combien de pelotes as-tu réellement utilisées ? » (YarnConsumptionDialog) —
// état global minimal : juste son ouverture/fermeture. Même motif que color-picker.js :
// sert à ce que le retour Android (App.vue) puisse fermer ce dialogue en priorité au lieu
// de quitter l'écran. Pas de payload ici : le composable `useProjectConsumption` (appelé
// depuis ProjectDetailView / ProjectCard, les deux points d'entrée qui peuvent clore un
// projet) reste propriétaire des laines concernées et du statut à appliquer. PIÈGE
// (décision produit) : contrairement à colorPicker dont fermer = Annuler (aucun effet),
// fermer CE dialogue — y compris via ce `close()`, donc via le Retour Android — consomme
// TOUT le réservé ; c'est le composable qui traduit cette fermeture en cette conséquence
// (jamais un cancel silencieux).
import { defineToggleStore } from '@/stores/toggle-store'

export const useProjectConsumptionStore = defineToggleStore('projectConsumption')
