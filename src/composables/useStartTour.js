// Lance la visite guidée du lecteur (lot « onboarding après import », 23/09/2026), depuis
// n'importe lequel de ses trois points d'entrée : la bienvenue du premier lancement
// (HomeView.vue), le bloc « Aide » des Réglages (SettingsView.vue) et la première section du
// Guide (GuideView.vue). Les trois se contentent d'appeler `startTour()` — toute la logique
// (retrouver/recréer le projet d'exemple, prévenir si besoin, naviguer) vit ici une seule
// fois.
//
// `ensureTourProject` (src/utils/tour-sample.js) fait le gros du travail : retrouve
// le projet « bonnet » déjà semé, ou le recrée si l'utilisatrice l'a supprimé ou restauré une
// sauvegarde antérieure à cette fonctionnalité. `null` en retour signifie que même la
// recréation a échoué (jeu d'exemples absent de la langue demandée) — la visite n'a alors
// rien à montrer, on le dit plutôt que de naviguer vers un lecteur cassé.
//
// CORRECTIF (revue, lot du 23/09/2026) : `ensureTourProject` n'a pas son propre filet — un
// rejet Dexie (quota, base fermée…) partait donc en silence jusqu'ici, sans snackbar ni
// trace, comme si personne n'avait appuyé sur le bouton. Un rejet est traité EXACTEMENT
// comme un `null` (même message `tour.unavailable`, aucune navigation), avec une trace
// `console.error` — même motif que `storage-guard.js`/`OnboardingView.vue`, qui journalisent
// ainsi les échecs Dexie inattendus plutôt que de les laisser remonter tels quels.
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import { useSnackbarStore } from '@/stores/snackbar'
import { ensureTourProject } from '@/utils/tour-sample'

export function useStartTour() {
  const router = useRouter()
  const { t } = useI18n()
  const settings = useSettingsStore()
  const snackbar = useSnackbarStore()
  // Garde anti double appui : les trois points d'entrée sont des boutons/confirmations
  // ordinaires, pas de désactivation visuelle pendant l'attente réseau — un second appui
  // pendant que le premier prépare encore le projet ne doit pas relancer une seconde
  // préparation (et donc, potentiellement, une seconde navigation).
  const starting = ref(false)

  async function startTour() {
    if (starting.value) return
    starting.value = true
    try {
      let result
      try {
        result = await ensureTourProject({ locale: settings.locale, technique: settings.defaultTechnique })
      } catch (err) {
        // Même trace, même issue qu'un `null` : voir le commentaire d'en-tête.
        console.error('[tour] échec de ensureTourProject', err)
        result = null
      }
      if (!result) {
        snackbar.show(t('tour.unavailable'))
        return
      }
      if (result.created) snackbar.show(t('tour.recreated'))
      await router.push({ name: 'project-read', params: { id: result.id }, query: { tour: '1' } })
    } finally {
      starting.value = false
    }
  }

  return { startTour }
}
