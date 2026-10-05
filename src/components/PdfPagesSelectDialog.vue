<script setup>
// Sélecteur des pages à importer d'un PDF qui contient plusieurs patrons (spec 2026-10-04) :
// miniatures à cocher, pages non contiguës admises (pages communes + pages d'une variante).
// Même poids visuel que PdfPagePickerDialog.vue, mais ici on CHOISIT un ensemble de pages
// au lieu d'en récupérer une image. Rend des numéros de page du PDF complet, triés.
// À chaque ouverture, la sélection repart de `initial` (vide par défaut).
import { ref, watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/AppIcon.vue'
import { renderPdfThumbnails } from '@/utils/pdf'
import { togglePage, normalizePageSelection } from '@/utils/pdf-import/page-subset'
import { trapTabFocus, useDialogFocusReturn } from '@/composables/useFocusTrap'

const props = defineProps({
  open: { type: Boolean, default: false },
  file: { type: null, default: null },
  // Pages cochées à l'ouverture (rouvrir après un refus : on retire une page, on ne recoche pas tout).
  initial: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:open', 'confirm'])
const { t } = useI18n()

useDialogFocusReturn(() => props.open)

const count = ref(0)
const thumbs = ref({})
const selected = ref([])
const failed = ref(false)
// Jeton de rendu : fermer (ou rouvrir) périme le rendu en cours, qui s'arrête à la page suivante.
let renderToken = 0

async function start() {
  const token = ++renderToken
  count.value = 0
  thumbs.value = {}
  selected.value = normalizePageSelection(props.initial)
  failed.value = false
  if (!props.file) return
  try {
    await renderPdfThumbnails(props.file, {
      maxWidth: 200,
      onCount: (n) => { if (token === renderToken) count.value = n },
      onThumb: (n, url) => { if (token === renderToken) thumbs.value = { ...thumbs.value, [n]: url } },
      isCancelled: () => token !== renderToken,
    })
  } catch {
    if (token === renderToken) failed.value = true
  }
}

watch(() => props.open, (open) => { if (open) start(); else renderToken++ }, { immediate: true })
onUnmounted(() => { renderToken++ })

const isOn = (n) => selected.value.includes(n)
function toggle(n) {
  selected.value = togglePage(selected.value, n)
}
function close() {
  emit('update:open', false)
}
function confirm() {
  if (!selected.value.length) return
  emit('confirm', [...selected.value])
  emit('update:open', false)
}
</script>

<template>
  <div v-if="open" class="pps" role="dialog" aria-modal="true" :aria-label="t('pagesSelect.title')" @keydown="trapTabFocus">
    <div class="pps__bar">
      <span class="pps__title">{{ t('pagesSelect.title') }}</span>
      <button type="button" class="pps__close" :aria-label="t('common.close')" @click="close">
        <AppIcon name="close" :size="20" />
      </button>
    </div>
    <div class="pps__body">
      <p class="pps__hint">{{ t('pagesSelect.hint') }}</p>
      <p v-if="failed" class="pps__err" role="alert">{{ t('pagesSelect.error') }}</p>
      <ul v-else class="pps__grid">
        <li v-for="n in count" :key="n">
          <button
            type="button"
            class="pps__page"
            :class="{ 'is-on': isOn(n) }"
            :aria-pressed="isOn(n) ? 'true' : 'false'"
            :aria-label="t('pagesSelect.pageLabel', { n })"
            @click="toggle(n)"
          >
            <img v-if="thumbs[n]" :src="thumbs[n]" alt="" class="pps__img" />
            <span v-else class="pps__ph" />
            <span v-if="isOn(n)" class="pps__check"><AppIcon name="check" :size="16" /></span>
            <span class="pps__num" aria-hidden="true">{{ n }}</span>
          </button>
        </li>
      </ul>
    </div>
    <div class="pps__foot">
      <p class="pps__count" aria-live="polite">{{ t('pagesSelect.count', selected.length) }}</p>
      <button type="button" class="btn btn--primary btn--block" :disabled="!selected.length" @click="confirm">
        <AppIcon name="import" :size="17" /> {{ t('pagesSelect.confirm') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.pps {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.pps__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-3) var(--sp-4);
  padding-top: max(var(--sp-3), var(--sa-top));
  border-bottom: 1px solid var(--line);
}
.pps__title {
  font-weight: 700;
  font-size: 15px;
}
.pps__close {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--ink-55);
  border-radius: var(--r-sm);
}
.pps__body {
  flex: 1;
  overflow: auto;
  padding: var(--sp-4);
}
.pps__hint {
  margin: 0 0 var(--sp-3);
  font-size: 14px;
  color: var(--ink-70);
}
.pps__err {
  color: var(--danger, var(--ink));
}
.pps__grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--sp-3);
}
@media (min-width: 600px) {
  .pps__grid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
}
.pps__page {
  position: relative;
  width: 100%;
  padding: 0;
  border: 2px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--bg);
  aspect-ratio: 3 / 4;
  overflow: hidden;
  cursor: pointer;
}
.pps__page.is-on {
  border: 3px solid var(--ink);
}
.pps__img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.pps__ph {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--line);
}
.pps__check {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--ink);
  color: var(--bg);
}
.pps__num {
  position: absolute;
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 12px;
  font-weight: 700;
  padding: 0 6px;
  border-radius: var(--r-sm);
  background: var(--bg);
  color: var(--ink);
}
.pps__foot {
  border-top: 1px solid var(--line);
  padding: var(--sp-3) var(--sp-4);
  padding-bottom: max(var(--sp-3), var(--sa-bottom));
  display: grid;
  gap: var(--sp-2);
}
.pps__count {
  margin: 0;
  font-size: 14px;
  color: var(--ink-70);
}
</style>
