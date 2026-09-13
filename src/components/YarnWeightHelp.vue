<script setup>
import { watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { YARN_WEIGHTS } from '@/constants/catalog'
import AppIcon from '@/components/AppIcon.vue'
import { trapTabFocus, useDialogFocusReturn } from '@/composables/useFocusTrap'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['close'])
const { t } = useI18n()

// Piège au Tab + restitution au déclencheur à la fermeture (dette audit UX 16/07,
// composable partagé) : le voile ne bloque le Tab que visuellement.
useDialogFocusReturn(() => props.open)

function onKey(e) {
  if (e.key === 'Escape') emit('close')
}
watch(
  () => props.open,
  (v) => {
    if (v) document.addEventListener('keydown', onKey)
    else document.removeEventListener('keydown', onKey)
  },
  { immediate: true },
)
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <Transition name="fade">
    <div v-if="open" class="wg">
      <div class="wg__scrim" @click="emit('close')"></div>
      <div class="wg__card" role="dialog" aria-modal="true" aria-labelledby="wg-title" @keydown="trapTabFocus">
        <header class="wg__head">
          <h2 id="wg-title" class="wg__title">{{ t('yarn.weightGuideTitle') }}</h2>
          <button class="wg__close" type="button" :aria-label="t('common.close')" @click="emit('close')">
            <AppIcon name="close" :size="18" />
          </button>
        </header>
        <p class="wg__intro">{{ t('yarn.weightGuideIntro') }}</p>
        <ul class="wg__list">
          <li v-for="w in YARN_WEIGHTS" :key="w" class="wg__row">
            <div class="wg__name">{{ t(`yarn.weights.${w}`) }}</div>
            <div class="wg__cyc">{{ t(`yarn.weightGuide.${w}.cyc`) }}</div>
            <div class="wg__meta">{{ t(`yarn.weightGuide.${w}.needles`) }} · {{ t(`yarn.weightGuide.${w}.uses`) }}</div>
            <div class="wg__len">{{ t('yarn.weightGuideLen', { m50: t(`yarn.weightGuide.${w}.m50`), m100: t(`yarn.weightGuide.${w}.m100`) }) }}</div>
          </li>
        </ul>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.wg { position: fixed; inset: 0; z-index: 80; display: flex; align-items: flex-end; justify-content: center; }
.wg__scrim { position: absolute; inset: 0; background: rgba(58, 46, 40, 0.42); }
.wg__card { position: relative; width: 100%; max-width: 480px; max-height: 82vh; overflow-y: auto; background: var(--bg); border-radius: var(--r-lg) var(--r-lg) 0 0; box-shadow: var(--e-3); padding: var(--sp-4) max(var(--sp-4), var(--sa-left)) max(var(--sp-4), var(--sa-bottom)); }
.wg__head { display: flex; align-items: center; gap: var(--sp-2); }
.wg__title { flex: 1; font-family: var(--font-display); font-size: 20px; margin: 0; }
.wg__close { flex-shrink: 0; width: 44px; height: 44px; border: 1px solid var(--line); background: var(--tile); color: var(--ink); border-radius: var(--r-md); box-shadow: var(--clay-sm); }
.wg__intro { color: var(--ink-55); font-size: 13px; margin: var(--sp-2) 0 var(--sp-3); }
.wg__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-2); }
.wg__row { background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--sp-3); box-shadow: var(--clay-sm); }
.wg__name { font-weight: 700; color: var(--ink); }
.wg__cyc { font-size: 13px; color: var(--brand-deep); font-weight: 600; margin-top: 2px; }
.wg__meta { font-size: 13px; color: var(--ink-55); margin-top: 2px; }
.wg__len { font-size: 12.5px; color: var(--ink-70); margin-top: 2px; font-variant-numeric: tabular-nums; }
.fade-enter-active, .fade-leave-active { transition: opacity var(--motion-fast); }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
