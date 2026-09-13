<script setup>
// Boîte de dialogue plein écran pour choisir une page du PDF d'origine du patron comme
// image de galerie (retour terrain 25/08/2026 : récupérer un diagramme perdu SANS sortir
// de l'app). Même poids visuel que PhotoCropper.vue (overlay plein écran, barre d'action en
// bas) — mais un composant SÉPARÉ : PhotoCropper est piloté par un store PROMESSE global
// (une seule instance montée dans App.vue, consommée par N écrans très différents) ; ce
// picker n'a que 2 appelants (PatternForm.vue, CorrectionView.vue), tous deux détenteurs
// directs du patron — un simple `v-model:open` + prop `pdf` local à chaque écran suffit,
// sans dupliquer le mécanisme de store pour un besoin qui ne le justifie pas.
//
// AUCUN recadrage ici : la page choisie sort telle quelle via `pick` — c'est à l'APPELANT
// de la recadrer (cropper.crop()), pour garder ce composant agnostique du geste qui suit
// (cf. Tâches 5/6, qui enchaînent sur cropper.crop() après réception de `pick`).
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/AppIcon.vue'
import PdfViewer from '@/components/PdfViewer.vue'
import { trapTabFocus, useDialogFocusReturn } from '@/composables/useFocusTrap'

const props = defineProps({
  open: { type: Boolean, default: false },
  pdf: { type: String, required: true },
})
const emit = defineEmits(['update:open', 'pick'])
const { t } = useI18n()

// Piège au Tab + restitution au déclencheur à la fermeture (dette audit UX 16/07,
// composable partagé) : le voile ne bloque le Tab que visuellement.
useDialogFocusReturn(() => props.open)

function onPick(dataUrl) {
  emit('pick', dataUrl)
  emit('update:open', false)
}
function close() {
  emit('update:open', false)
}
</script>

<template>
  <div v-if="open" class="ppd" role="dialog" aria-modal="true" :aria-label="t('patternExtras.pdfPickerTitle')" @keydown="trapTabFocus">
    <div class="ppd__bar">
      <span class="ppd__title">{{ t('patternExtras.pdfPickerTitle') }}</span>
      <button type="button" class="ppd__close" :aria-label="t('common.close')" @click="close">
        <AppIcon name="close" :size="20" />
      </button>
    </div>
    <div class="ppd__body">
      <PdfViewer :pdf="pdf" pickable @pick="onPick" />
    </div>
  </div>
</template>

<style scoped>
.ppd {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.ppd__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-3) var(--sp-4);
  padding-top: max(var(--sp-3), var(--sa-top));
  border-bottom: 1px solid var(--line);
}
.ppd__title {
  font-weight: 700;
  font-size: 15px;
}
.ppd__close {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--ink-55);
  border-radius: var(--r-sm);
}
.ppd__body {
  flex: 1;
  overflow: auto;
  padding: var(--sp-4);
  padding-bottom: max(var(--sp-4), var(--sa-bottom));
}
</style>
