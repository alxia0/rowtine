<script setup>
import { ref, computed, defineAsyncComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/AppIcon.vue'
import PatternGallery from '@/components/PatternGallery.vue'
import { openPdfExternally } from '@/utils/open-pdf'
import { trapTabFocus, useDialogFocusReturn } from '@/composables/useFocusTrap'

// Chargement différé : PdfViewer embarque pdfjs-dist (lourd), on ne le charge
// que lorsque l'aperçu PDF est réellement ouvert.
const PdfViewer = defineAsyncComponent(() => import('@/components/PdfViewer.vue'))

// `variant` sépare les deux parties : le PDF d'origine vit désormais sous le
// « Patron source » (onglet Détails), la galerie d'images reste dans l'onglet Galerie.
//  - 'full'    : PDF + galerie (compat.)
//  - 'pdf'     : uniquement le PDF d'origine
//  - 'gallery' : uniquement les images extraites
const props = defineProps({
  pdf: { type: String, default: '' },
  gallery: { type: Array, default: () => [] },
  variant: { type: String, default: 'full' },
})

const { t } = useI18n()
const showPdf = ref(false)
// Piège au Tab + restitution au déclencheur à la fermeture (dette audit UX 16/07,
// composable partagé) : le voile ne bloque le Tab que visuellement.
useDialogFocusReturn(showPdf)
const showPdfBlock = computed(() => props.variant !== 'gallery' && props.pdf)

// Résolu à l'usage (et non au setup) pour que le composant reste montable
// sans Pinia actif, comme PatternGallery.
async function openExternal() {
  const { useSnackbarStore } = await import('@/stores/snackbar')
  const snackbar = useSnackbarStore()
  try {
    await openPdfExternally(props.pdf, 'patron.pdf')
  } catch {
    snackbar.show(t('patternExtras.openError'))
  }
}
</script>

<template>
  <section v-if="showPdfBlock || (variant !== 'pdf' && gallery.length)" class="ppdfg">
    <h2 class="ppdfg__title">{{ variant === 'pdf' ? t('patternExtras.pdfFromPatternLabel') : t('patternExtras.fromPatternLabel') }}</h2>

    <div v-if="showPdfBlock" class="ppdfg__actions">
      <button class="btn" @click="showPdf = true"><AppIcon name="eye" :size="18" /> {{ t('patternExtras.preview') }}</button>
      <button class="btn" @click="openExternal">{{ t('patternExtras.openExternal') }}</button>
    </div>

    <PatternGallery v-if="variant !== 'pdf'" :images="gallery" />

    <div v-if="showPdf" class="ppdfg-overlay" role="dialog" aria-modal="true" @click.self="showPdf = false" @keydown="trapTabFocus">
      <div class="ppdfg-overlay__panel">
        <button class="ppdfg-overlay__close" :aria-label="t('common.close')" @click="showPdf = false"><AppIcon name="close" :size="22" /></button>
        <PdfViewer :pdf="pdf" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.ppdfg { margin-top: var(--sp-4); }
.ppdfg__title { font-family: var(--font-display); font-weight: 600; font-size: 16px; margin: 0 0 var(--sp-2); }
.ppdfg__actions { display: flex; gap: var(--sp-2); margin-bottom: var(--sp-3); }
.ppdfg__actions .btn { flex: 1; }
.ppdfg-overlay { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.6); padding: max(var(--sp-4), var(--sa-top)) var(--sp-4) max(var(--sp-4), var(--sa-bottom)); }
.ppdfg-overlay__panel { position: relative; width: 100%; max-width: 480px; background: var(--bg); border-radius: var(--r-md); padding: var(--sp-4); box-shadow: var(--clay-sm); }
.ppdfg-overlay__close { position: absolute; top: var(--sp-2); right: var(--sp-2); width: 40px; height: 40px; border: none; border-radius: var(--r-pill); background: var(--tile); color: var(--ink); box-shadow: var(--clay-sm); z-index: 1; }
</style>
