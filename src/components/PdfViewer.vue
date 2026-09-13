<script setup>
// Visionneuse PDF in-app : rend les pages à la demande via pdfjs. 100 % hors-ligne.
import { ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/AppIcon.vue'
import { renderPdfPageToDataUrl, pdfPageCount } from '@/utils/pdf'
import { base64ToBytes } from '@/utils/base64'
import { parseDataUrl } from '@/backup/naming'

const props = defineProps({
  pdf: { type: String, required: true },
  // Mode sélection (PdfPagePickerDialog.vue) : ajoute un bouton "Utiliser cette
  // page" à la barre de navigation existante, qui émet `pick` avec la page COURANTE déjà
  // rendue (`img.value`). Défaut `false` : `ProjectPdfGallery.vue` (seul appelant actuel,
  // lecture seule) ne voit aucun changement.
  pickable: { type: Boolean, default: false },
})
const emit = defineEmits(['pick'])
const { t } = useI18n()

// `parseDataUrl` (src/backup/naming.js) + `base64ToBytes` (src/utils/base64.js) au lieu
// d'une découpe/regex mime et d'une boucle base64→octets recopiées ici (3e copie du même
// motif avec src/utils/open-pdf.js) — `pdf` est toujours une data URL bien formée produite
// par l'app elle-même (FileReader.readAsDataURL à l'import), donc `parseDataUrl` ne renvoie
// jamais `null` en pratique ; repli `application/pdf` conservé par prudence.
function dataUrlToFile(dataUrl) {
  const parsed = parseDataUrl(dataUrl)
  const mime = parsed?.mime || 'application/pdf'
  const bytes = parsed ? base64ToBytes(parsed.base64) : new Uint8Array()
  return new Blob([bytes], { type: mime })
}

const total = ref(0)
const page = ref(1)
const img = ref('')
const loading = ref(true)
let file = null

async function render() {
  if (!file) return
  loading.value = true
  img.value = await renderPdfPageToDataUrl(file, page.value, 1400)
  loading.value = false
}

function go(delta) {
  const next = page.value + delta
  if (next < 1 || next > total.value) return
  page.value = next
  render()
}

function pick() {
  if (img.value) emit('pick', img.value)
}

async function load() {
  file = dataUrlToFile(props.pdf)
  page.value = 1
  total.value = await pdfPageCount(file)
  await render()
}

onMounted(load)
watch(() => props.pdf, load)
</script>

<template>
  <div class="pdfv">
    <div class="pdfv__stage">
      <img v-if="img" :src="img" class="pdfv__page" :alt="t('pdfViewer.page', { n: page, total })" />
      <p v-if="loading" class="pdfv__loading">{{ t('pdfViewer.loading') }}</p>
    </div>
    <div class="pdfv__bar">
      <button class="btn" data-test="prev" :disabled="page <= 1" @click="go(-1)">
        <AppIcon name="chevronLeft" :size="18" /> {{ t('pdfViewer.prev') }}
      </button>
      <span class="pdfv__count">{{ t('pdfViewer.page', { n: page, total }) }}</span>
      <button class="btn" data-test="next" :disabled="page >= total" @click="go(1)">
        {{ t('pdfViewer.next') }} <AppIcon name="chevronRight" :size="18" />
      </button>
    </div>
    <button v-if="pickable" type="button" class="btn btn--primary pdfv__pick" data-test="pick" :disabled="!img" @click="pick">
      {{ t('patternExtras.pdfPickerUse') }}
    </button>
  </div>
</template>

<style scoped>
.pdfv {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.pdfv__stage {
  position: relative;
  overflow: auto;
  max-height: 70vh;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
}
.pdfv__page {
  width: 100%;
  height: auto;
  display: block;
}
.pdfv__loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--ink-55);
  font-size: 13px;
}
.pdfv__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
}
.pdfv__count {
  font-size: 13px;
  color: var(--ink-70);
  font-variant-numeric: tabular-nums;
}
.pdfv__pick {
  width: 100%;
}
</style>
