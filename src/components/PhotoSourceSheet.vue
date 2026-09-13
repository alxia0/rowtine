<script setup>
// La feuille de choix de source photo (décision produit du 04/09/2026, option (a)) : elle
// remplace le prompt natif CameraSource.Prompt du plugin @capacitor/camera. Pourquoi
// remplace-t-elle : sur le chemin galerie, LegacyCameraFlow.java (v8.2.2) ré-encode TOUT
// en JPEG côté natif SANS remplissage — un PNG transparent devient un JPEG opaque fond
// noir avant d'atteindre la webview (mesuré sur appareil le 04/09 : octets identiques
// avec et sans fillRect en aval, l'alpha est cuite dans les pixels) ; le seul contournement
// est de ne PAS passer par le plugin pour la galerie. La feuille dispatche donc vers
// l'input fichier (galerie, cf. utils/photo.js) ou le plugin natif (appareil photo).
// Montée UNE FOIS dans App.vue, pilotée par le store photo-source (promesse), au motif
// exact de PhotoCropper.vue. AUCUNE clé i18n nouvelle : photo.add/cameraChoose/cameraTake
// et common.cancel existent déjà dans les 4 locales.
import { watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePhotoSourceStore } from '@/stores/photo-source'
import { lockBodyScroll, unlockBodyScroll } from '@/utils/body-scroll-lock'
import { trapTabFocus, useDialogFocusReturn } from '@/composables/useFocusTrap'

const source = usePhotoSourceStore()
const { t } = useI18n()

// Piège au Tab + restitution au déclencheur à la fermeture (dette audit UX 16/07,
// composable partagé). La fermeture STRICTE (ni clic-fond ni Échap, cf. template) reste
// inchangée : le keydown ne fait que boucler le Tab dans la feuille.
useDialogFocusReturn(() => source.open)

// Verrou de défilement, même motif que PhotoCropper.vue : la feuille est modale, le fond
// ne doit pas défiler dessous ; relâché à la fermeture (watch open, pas de nettoyage au
// démontage nécessaire — le settle referme toujours avant). Passé par le compteur partagé
// (refermer ICI ne doit plus déverrouiller le fond tant qu'une autre
// modale le tient) ; `verrouPose` : on ne libère que ce qu'on a posé.
let verrouPose = false
watch(
  () => source.open,
  (v) => {
    if (v) {
      verrouPose = true
      lockBodyScroll()
    } else if (verrouPose) {
      verrouPose = false
      unlockBodyScroll()
    }
  },
)
</script>

<template>
  <!--
    Fermeture STRICTE, même règle que la porte du dossier (OnboardingFolderPrompt) : ni
    clic-fond ni Échap ne ferment — un tap accidentel hors feuille ne doit pas annuler un
    choix en cours ; seul le bouton Annuler tranche. D'où un overlay sans aucun écouteur.
    Accessibilité : role="dialog" + aria-modal + aria-labelledby vers le titre « Ajouter
    une photo » (photo.add, clé existante pertinente — un titre visible valait mieux qu'un
    aria-label nu : il annonce le contexte aux voyantes comme aux lecteurs d'écran, sans
    exiger de nouvelle clé i18n).
  -->
  <div
    v-if="source.open"
    class="pss-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="photo-source-title"
    data-test="photo-source-sheet"
    @keydown="trapTabFocus"
  >
    <div class="pss-overlay__panel">
      <h2 id="photo-source-title" class="pss__title">{{ t('photo.add') }}</h2>
      <div class="pss__actions">
        <!-- Galerie en bouton PRINCIPAL (premier et btn--primary) : c'est le geste le plus
             courant (photos de pelotes/patrons déjà prises), et celui que ce lot répare. -->
        <button
          class="btn btn--primary"
          data-test="photo-source-gallery"
          @click="source.settle('gallery')"
        >
          {{ t('photo.cameraChoose') }}
        </button>
        <button class="btn" data-test="photo-source-camera" @click="source.settle('camera')">
          {{ t('photo.cameraTake') }}
        </button>
        <button class="btn" data-test="photo-source-cancel" @click="source.settle(null)">
          {{ t('common.cancel') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Panneau modal centré, motif et styles repris de LocalRestoreOffer.vue (overlay + panneau
   aux tokens du projet) — cohérent avec les feuilles/modales existantes de l'app.
   Z-index 1100, même rang que PhotoCropper/ChartFullscreen : la feuille se ferme TOUJOURS
   avant que le recadeur ne s'ouvre (le settle précède le pick puis le crop — jamais
   superposés), et elle reste SOUS les portes/bandeaux à 1200 (onboarding, décision
   sauvegarde), qui prime sur tout choix utilisateur. Cf. commentaire d'empilement App.vue. */
.pss-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  padding: max(var(--sp-4), var(--sa-top)) var(--sp-4) max(var(--sp-4), var(--sa-bottom));
}
.pss-overlay__panel {
  position: relative;
  width: 100%;
  max-width: 420px;
  background: var(--bg);
  border-radius: var(--r-md);
  padding: var(--sp-4);
  box-shadow: var(--clay-sm);
}
.pss__title {
  font-size: 18px;
  margin-bottom: var(--sp-4);
}
/* Choix exclusifs : boutons empilés pleine largeur (cible tactile généreuse, un geste
   par ligne — pas une rangée où le pouce rate). */
.pss__actions {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.pss__actions .btn {
  width: 100%;
}
</style>
