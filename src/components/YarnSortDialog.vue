<script setup>
// Popup générique « Trier » du stock de laines : une liste d'options exclusive, un tap
// émet `update:modelValue` puis referme (le choix tranche toujours). Le composant ne
// connaît AUCUNE clé i18n métier : titre et options arrivent déjà traduits par props —
// seule common.close (existante ×4) est utilisée ici.
//
// Fermeture légère, même idiome que YarnWeightHelp.vue : scrim cliquable + Échap + bouton
// Fermer. Piège au Tab + restitution au déclencheur (composable partagé, dette audit UX
// 16/07) : le voile ne bloque le Tab que visuellement.
import { watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/AppIcon.vue'
import { trapTabFocus, useDialogFocusReturn } from '@/composables/useFocusTrap'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  // Valeur de tri courante.
  modelValue: { type: String, default: '' },
  // [{ value, label }] — déjà traduites par le parent.
  options: { type: Array, default: () => [] },
})
const emit = defineEmits(['close', 'update:modelValue'])
const { t } = useI18n()

useDialogFocusReturn(() => props.open)

// Échap, même motif que YarnWeightHelp.vue : écouteur posé à l'ouverture, retiré à la
// fermeture et au démontage.
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

function choose(value) {
  // Le choix tranche : on émet la nouvelle valeur puis on referme — même un tap sur
  // l'option déjà courante ferme la popup (l'utilisatrice a fini son geste).
  emit('update:modelValue', value)
  emit('close')
}
</script>

<template>
  <Transition name="fade">
    <div v-if="open" class="ysd" data-test="yarn-sort-dialog">
      <div class="ysd__scrim" @click="emit('close')"></div>
      <div class="ysd__card" role="dialog" aria-modal="true" aria-labelledby="ysd-title" @keydown="trapTabFocus">
        <header class="ysd__head">
          <h2 id="ysd-title" class="ysd__title">{{ title }}</h2>
          <button class="ysd__close" type="button" :aria-label="t('common.close')" data-test="sort-close" @click="emit('close')">
            <AppIcon name="close" :size="18" />
          </button>
        </header>
        <div class="ysd__body">
          <!-- Options empilées pleine largeur (motif .pss__actions de PhotoSourceSheet) :
               cible tactile généreuse, un geste par ligne. La liste défile si longue. -->
          <div class="ysd__list">
            <button
              v-for="o in options"
              :key="o.value"
              class="ysd__row"
              type="button"
              :data-test="`sort-option-${o.value}`"
              @click="choose(o.value)"
            >
              <span class="ysd__row-label">{{ o.label }}</span>
              <AppIcon v-if="modelValue === o.value" class="ysd__check" name="check" :size="18" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* Idiome YarnWeightHelp.vue : feuille du bas, scrim, carte aux tokens du projet, même
   z-index (80) et même fond de scrim. */
.ysd { position: fixed; inset: 0; z-index: 80; display: flex; align-items: flex-end; justify-content: center; }
.ysd__scrim { position: absolute; inset: 0; background: rgba(58, 46, 40, 0.42); }
.ysd__card { position: relative; width: 100%; max-width: 480px; max-height: 82vh; display: flex; flex-direction: column; background: var(--bg); border-radius: var(--r-lg) var(--r-lg) 0 0; box-shadow: var(--e-3); padding: var(--sp-4) max(var(--sp-4), var(--sa-left)) max(var(--sp-4), var(--sa-bottom)); }
.ysd__head { display: flex; align-items: center; gap: var(--sp-2); flex-shrink: 0; }
.ysd__title { flex: 1; font-family: var(--font-display); font-size: 20px; margin: 0; }
.ysd__close { flex-shrink: 0; width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--line); background: var(--tile); color: var(--ink); border-radius: var(--r-md); box-shadow: var(--clay-sm); }
.ysd__body { overflow-y: auto; min-height: 0; margin-top: var(--sp-3); }
.ysd__list { display: flex; flex-direction: column; gap: var(--sp-2); }
.ysd__row { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); width: 100%; min-height: 44px; text-align: left; font: inherit; color: var(--ink); background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--sp-3); box-shadow: var(--clay-sm); }
.ysd__row-label { font-weight: 600; }
.ysd__check { color: var(--brand-deep); flex-shrink: 0; }
.fade-enter-active, .fade-leave-active { transition: opacity var(--motion-fast); }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
