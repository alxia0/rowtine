<script setup>
import { reactive, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/AppIcon.vue'
import ToolRow from '@/components/ToolRow.vue'
import { trapTabFocus, useDialogFocusReturn } from '@/composables/useFocusTrap'

// Question posée quand un projet change de statut et que des outils sont en jeu (logique dans
// useToolParking, ici seulement l'affichage). Un seul dialogue, deux modes (`mode`) :
// - 'pause' : le projet se met en pause, « libérer ses outils pour un autre projet ? ». Liste en
//   lecture seule ; « Libérer » émet `confirm` avec [] (rien à choisir), « Les garder » émet `cancel`.
// - 'resume' : le projet repart, « reprendre les outils mis de côté ? ». Une case par entrée,
//   cochée par défaut si l'outil est libre, désactivée sinon avec « pris par <projets> ».
//   « Reprendre » émet `confirm` avec les clés cochées, « Pas maintenant » émet `cancel`.
// Croix, voile et Échap valent « cancel » (même règle que YarnConsumptionDialog). Le Retour
// Android est géré par l'appelant (store tool-parking).
// Chaque entrée : { key, kind: 'tool' | 'kit', tool, sizeMm?, cableCm?, cableJoin?, free, takenBy }.
// Le libellé vient de ToolRow (mêmes textes que la fiche projet) : une prise de kit y dit
// « marque · 4 mm + 80 cm ».
const props = defineProps({
  open: { type: Boolean, default: false },
  mode: { type: String, default: 'pause' }, // 'pause' | 'resume'
  entries: { type: Array, default: () => [] },
})
const emit = defineEmits(['confirm', 'cancel'])
const { t } = useI18n()

const isResume = computed(() => props.mode === 'resume')

// { [clé]: coché ? }, remis au défaut (cochées si libres) à chaque ouverture.
const checked = reactive({})
function resetChecked() {
  for (const key of Object.keys(checked)) delete checked[key]
  for (const e of props.entries) checked[e.key] = !!e.free
}

function pickOf(e) {
  return e.kind === 'kit' ? { sizeMm: e.sizeMm, cableCm: e.cableCm, cableJoin: e.cableJoin } : null
}

function cancel() {
  emit('cancel')
}
function confirm() {
  // En pause rien n'est à choisir : on libère tout. En reprise, seules les cases cochées ET libres.
  emit(
    'confirm',
    isResume.value ? props.entries.filter((e) => e.free && checked[e.key]).map((e) => e.key) : [],
  )
}

function onKey(e) {
  if (e.key === 'Escape') cancel()
}
// Piège au Tab + restitution au déclencheur à la fermeture (composable partagé).
useDialogFocusReturn(() => props.open)
watch(
  () => props.open,
  (v) => {
    if (v) {
      resetChecked()
      document.addEventListener('keydown', onKey)
    } else {
      document.removeEventListener('keydown', onKey)
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <Transition name="fade">
    <div v-if="open" class="tpd">
      <div class="tpd__scrim" @click="cancel"></div>
      <div class="tpd__card" role="dialog" aria-modal="true" aria-labelledby="tpd-title" @keydown="trapTabFocus">
        <header class="tpd__head">
          <h2 id="tpd-title" class="tpd__title">{{ t(isResume ? 'toolParking.resumeTitle' : 'toolParking.pauseTitle') }}</h2>
          <button class="tpd__close" type="button" :aria-label="t('common.close')" @click="cancel">
            <AppIcon name="close" :size="18" />
          </button>
        </header>
        <p class="tpd__intro">{{ t(isResume ? 'toolParking.resumeIntro' : 'toolParking.pauseIntro') }}</p>
        <ul class="tpd__list">
          <li v-for="e in entries" :key="e.key" class="tpd__row">
            <label v-if="isResume" class="tpd__label" :class="{ 'tpd__label--taken': !e.free }">
              <input v-model="checked[e.key]" class="tpd__check" type="checkbox" :disabled="!e.free" />
              <span class="tpd__body">
                <ToolRow :tool="e.tool" :pick="pickOf(e)" :in-use-by="e.free ? null : (e.takenBy ?? []).join(', ')" as="span" />
              </span>
            </label>
            <ToolRow v-else :tool="e.tool" :pick="pickOf(e)" as="span" />
          </li>
        </ul>
        <div class="tpd__actions">
          <button type="button" class="btn btn--ghost tpd__cancel" @click="cancel">{{ t(isResume ? 'toolParking.notNow' : 'toolParking.keep') }}</button>
          <button type="button" class="btn btn--primary tpd__confirm" @click="confirm">{{ t(isResume ? 'toolParking.resume' : 'toolParking.release') }}</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.tpd { position: fixed; inset: 0; z-index: 80; display: flex; align-items: flex-end; justify-content: center; }
.tpd__scrim { position: absolute; inset: 0; background: rgba(58, 46, 40, 0.42); }
.tpd__card { position: relative; width: 100%; max-width: 480px; max-height: 82vh; overflow-y: auto; background: var(--bg); border-radius: var(--r-lg) var(--r-lg) 0 0; box-shadow: var(--e-3); padding: var(--sp-4) max(var(--sp-4), var(--sa-left)) max(var(--sp-4), var(--sa-bottom)); }
.tpd__head { display: flex; align-items: center; gap: var(--sp-2); }
.tpd__title { flex: 1; font-family: var(--font-display); font-size: 20px; margin: 0; }
.tpd__close { flex-shrink: 0; width: 44px; height: 44px; border: 1px solid var(--line); background: var(--tile); color: var(--ink); border-radius: var(--r-md); box-shadow: var(--clay-sm); }
.tpd__intro { color: var(--ink-55); font-size: 13px; margin: var(--sp-2) 0 var(--sp-3); }
.tpd__list { list-style: none; margin: 0 0 var(--sp-3); padding: 0; display: flex; flex-direction: column; gap: var(--sp-2); }
.tpd__label { display: flex; align-items: center; gap: var(--sp-3); min-height: 48px; cursor: pointer; }
.tpd__label--taken { cursor: default; opacity: 0.7; }
.tpd__check { flex-shrink: 0; width: 24px; height: 24px; accent-color: var(--brand-deep); }
.tpd__body { display: flex; flex-direction: column; gap: var(--sp-1); flex: 1; min-width: 0; }
.tpd__actions { display: flex; gap: var(--sp-2); }
.tpd__actions .btn { flex: 1; min-height: 44px; }
.fade-enter-active, .fade-leave-active { transition: opacity var(--motion-fast); }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
