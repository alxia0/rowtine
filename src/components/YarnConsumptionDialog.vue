<script setup>
import { reactive, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/AppIcon.vue'
import { trapTabFocus, useDialogFocusReturn } from '@/composables/useFocusTrap'

// Question posée quand un projet passe à Terminé OU Abandonné (K2 + R3), SI ce projet
// réserve des pelotes : « combien as-tu réellement utilisées ? ». Un seul dialogue, deux
// modes (`mode` prop) :
// - 'done' (défaut) : le cas normal, tout le réservé a été tricoté → défaut = reserved.
// - 'abandoned' : le cas normal est qu'on détricote tout (on frogue) → défaut = 0 ; on ne
//   saisit que ce qui est VRAIMENT perdu (pelotes entamées non détricotées).
// PIÈGE UX (décision produit) : pas de bouton Annuler — il mentirait, car fermer la
// question applique TOUJOURS le défaut du mode. Une seule action, « Valider » ; les
// champs sont pré-remplis au défaut du mode ; TOUTE fermeture (croix, scrim, Échap — et
// le Retour Android, géré par l'appelant via le store project-consumption) émet `confirm`
// avec ces valeurs par défaut, jamais un cancel.
const props = defineProps({
  open: { type: Boolean, default: false },
  yarns: { type: Array, default: () => [] },
  mode: { type: String, default: 'done' }, // 'done' | 'abandoned'
})
const emit = defineEmits(['confirm'])
const { t } = useI18n()

const titleKey = computed(() => (props.mode === 'abandoned' ? 'project.abandonTitle' : 'project.consumeTitle'))
const introKey = computed(() => (props.mode === 'abandoned' ? 'project.abandonIntro' : 'project.consumeIntro'))
const hintKey = computed(() => (props.mode === 'abandoned' ? 'project.abandonHint' : 'project.consumeHint'))

// Défaut par mode : tout le réservé (compté comme tricoté) si 'done', sinon 0 (on
// détricote tout, on ne récupère que ce qui est explicitement saisi comme perdu).
function defaultFor(y) {
  return props.mode === 'abandoned' ? 0 : y.reserved
}

// { [yarnId]: quantité saisie }, réinitialisé au défaut du mode à chaque ouverture.
const used = reactive({})
function resetDefaults() {
  for (const key of Object.keys(used)) delete used[key]
  for (const y of props.yarns) used[y.id] = defaultFor(y)
}

// Rend `null` — jamais 0 — quand la saisie n'est PAS un nombre utilisable. `Number('')` vaut
// 0 ET passe `Number.isFinite`, donc l'ancien garde ne se déclenchait jamais : vider le champ
// pour retaper valait « 0 pelote consommée », et un Valider à cet instant rendait au stock
// toute la réserve d'un projet pourtant terminé — exactement ce que cette fenêtre existe pour
// empêcher. Seul appelant : `onInput` ci-dessous.
function clampFor(id, raw) {
  const reserved = props.yarns.find((y) => y.id === id)?.reserved ?? 0
  const s = String(raw).trim()
  if (s === '') return null
  const n = Math.floor(Number(s))
  return Number.isFinite(n) ? Math.max(0, Math.min(n, reserved)) : null
}
function onInput(id, e) {
  const next = clampFor(id, e.target.value)
  // Champ vidé/illisible : on GARDE la valeur courante (l'état ne change pas, donc Vue ne
  // repeint pas le champ sous le doigt) et la frappe suivante la remplacera normalement.
  if (next === null) return
  used[id] = next
}

// Toute fermeture applique le défaut du mode (« jamais perdre l'info » : fermer la
// fenêtre ne doit jamais se lire comme une annulation silencieuse).
function confirmDefaults() {
  emit(
    'confirm',
    props.yarns.map((y) => ({ id: y.id, used: defaultFor(y) })),
  )
}
function confirmEdited() {
  emit(
    'confirm',
    props.yarns.map((y) => ({ id: y.id, used: used[y.id] ?? defaultFor(y) })),
  )
}

function onKey(e) {
  if (e.key === 'Escape') confirmDefaults()
}
// Piège au Tab + restitution au déclencheur à la fermeture (dette audit UX 16/07,
// composable partagé) : le voile ne bloque le Tab que visuellement.
useDialogFocusReturn(() => props.open)
watch(
  () => props.open,
  (v) => {
    if (v) {
      resetDefaults()
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
    <div v-if="open" class="ycn">
      <div class="ycn__scrim" @click="confirmDefaults"></div>
      <div class="ycn__card" role="dialog" aria-modal="true" aria-labelledby="ycn-title" @keydown="trapTabFocus">
        <header class="ycn__head">
          <h2 id="ycn-title" class="ycn__title">{{ t(titleKey) }}</h2>
          <button class="ycn__close" type="button" :aria-label="t('common.close')" @click="confirmDefaults">
            <AppIcon name="close" :size="18" />
          </button>
        </header>
        <p class="ycn__intro">{{ t(introKey) }}</p>
        <ul class="ycn__list">
          <li v-for="y in yarns" :key="y.id" class="ycn__row">
            <div class="ycn__meta">
              <span class="ycn__name">{{ y.name }}</span>
              <span class="ycn__reserved">{{ t('project.consumeReserved', { n: y.reserved }) }}</span>
            </div>
            <input
              class="ycn__input"
              type="number"
              inputmode="numeric"
              min="0"
              :max="y.reserved"
              :aria-label="y.name"
              :value="used[y.id] ?? defaultFor(y)"
              @input="onInput(y.id, $event)"
            />
          </li>
        </ul>
        <p class="ycn__hint">{{ t(hintKey) }}</p>
        <button type="button" class="btn btn--primary btn--block ycn__confirm" @click="confirmEdited">
          {{ t('project.consumeConfirm') }}
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.ycn { position: fixed; inset: 0; z-index: 80; display: flex; align-items: flex-end; justify-content: center; }
.ycn__scrim { position: absolute; inset: 0; background: rgba(58, 46, 40, 0.42); }
.ycn__card { position: relative; width: 100%; max-width: 480px; max-height: 82vh; overflow-y: auto; background: var(--bg); border-radius: var(--r-lg) var(--r-lg) 0 0; box-shadow: var(--e-3); padding: var(--sp-4) max(var(--sp-4), var(--sa-left)) max(var(--sp-4), var(--sa-bottom)); }
.ycn__head { display: flex; align-items: center; gap: var(--sp-2); }
.ycn__title { flex: 1; font-family: var(--font-display); font-size: 20px; margin: 0; }
.ycn__close { flex-shrink: 0; width: 44px; height: 44px; border: 1px solid var(--line); background: var(--tile); color: var(--ink); border-radius: var(--r-md); box-shadow: var(--clay-sm); }
.ycn__intro { color: var(--ink-55); font-size: 13px; margin: var(--sp-2) 0 var(--sp-3); }
.ycn__list { list-style: none; margin: 0 0 var(--sp-3); padding: 0; display: flex; flex-direction: column; gap: var(--sp-2); }
.ycn__row { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3); background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--sp-3); box-shadow: var(--clay-sm); }
.ycn__meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ycn__name { font-weight: 700; color: var(--ink); }
.ycn__reserved { font-size: 12.5px; color: var(--ink-55); }
.ycn__input { flex-shrink: 0; width: 64px; height: 44px; text-align: center; font-size: 16px; font-variant-numeric: tabular-nums; border: 1px solid var(--line); background: var(--bg); color: var(--ink); border-radius: var(--r-md); box-shadow: var(--clay-press); }
.ycn__hint { font-size: 12.5px; color: var(--ink-55); margin: 0 0 var(--sp-3); }
.ycn__confirm { min-height: 44px; }
.fade-enter-active, .fade-leave-active { transition: opacity var(--motion-fast); }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
