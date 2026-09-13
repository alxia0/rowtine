<script setup>
// Barre de progression d'un import PDF : présentationnel (le calcul vit dans
// useImportProgress + utils/import-progress). Affiche % + libellé de phase + temps
// écoulé, et « page X / N » quand le total est connu (local).
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import KnittingLoader from '@/components/KnittingLoader.vue'
import { useSettingsStore } from '@/stores/settings'

const props = defineProps({
  pct: { type: Number, default: 0 },
  labelKey: { type: String, default: '' },
  elapsedSec: { type: Number, default: 0 },
  page: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
})

const { t } = useI18n()
const settings = useSettingsStore()
const elapsedLabel = computed(() => {
  const s = props.elapsedSec
  if (s < 60) return `${s} s`
  return `${Math.floor(s / 60)} min ${s % 60}s`
})
</script>

<template>
  <div class="iprog" role="status" aria-live="polite">
    <div class="iprog__loader">
      <KnittingLoader :technique="settings.defaultTechnique" :size="56" />
    </div>
    <div class="iprog__track"><span class="iprog__fill" :style="{ width: pct + '%' }"></span></div>
    <div class="iprog__row">
      <span class="iprog__label">{{ labelKey ? t(labelKey) : '' }}</span>
      <span class="iprog__pct">{{ pct }} %</span>
    </div>
    <p class="iprog__hint">
      {{ elapsedLabel }}
      <template v-if="total > 0"> · {{ t('import.pageOf', { n: page, total }) }}</template>
    </p>
  </div>
</template>

<style scoped>
.iprog { margin-top: var(--sp-3); }
.iprog__loader { display: flex; justify-content: center; margin-bottom: var(--sp-2); }
.iprog__track { height: 10px; border-radius: 999px; background: var(--line); overflow: hidden; }
.iprog__fill { display: block; height: 100%; background: var(--brand); border-radius: 999px; transition: width 0.3s ease; }
.iprog__row { display: flex; align-items: baseline; justify-content: space-between; margin-top: 6px; }
.iprog__label { font-size: 13.5px; color: var(--ink-70); font-weight: 600; }
.iprog__pct { font-size: 13px; color: var(--ink-55); font-variant-numeric: tabular-nums; }
.iprog__hint { margin: 2px 0 0; font-size: 12.5px; color: var(--ink-55); }
</style>
