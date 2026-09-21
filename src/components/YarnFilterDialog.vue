<script setup>
// Popup générique « Filtrer » du stock de laines : une page liste les critères, un tap
// ouvre la page des options du critère, choisir une option émet `set-filter` et rebondit
// sur la liste des critères (on en enchaîne souvent plusieurs). Le composant ne connaît
// AUCUNE clé i18n métier : critères, options, libellés « toutes » et « Réinitialiser »
// arrivent déjà traduits par props — seules common.back et common.close (existantes ×4)
// sont utilisées ici.
//
// Fermeture légère, même idiome que YarnWeightHelp.vue : scrim cliquable + Échap + bouton
// Fermer. Piège au Tab + restitution au déclencheur (composable partagé, dette audit UX
// 16/07) : le voile ne bloque le Tab que visuellement.
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/AppIcon.vue'
import { trapTabFocus, useDialogFocusReturn } from '@/composables/useFocusTrap'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  // Libellé du bouton Réinitialiser ; vide → le bouton n'est jamais rendu.
  resetLabel: { type: String, default: '' },
  // [{ key, label, allLabel, options: [{ value, label, group? }] }] — `group` optionnel :
  // libellé d'en-tête, les options d'un même groupe arrivent contiguës.
  criteria: { type: Array, default: () => [] },
  // Valeur courante par critère ('' = aucun filtre).
  filters: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['close', 'set-filter', 'reset'])
const { t } = useI18n()

useDialogFocusReturn(() => props.open)

// Navigation interne à deux pages : la liste des critères, puis les options du critère actif.
const page = ref('criteria')
const activeKey = ref(null)
const activeCriterion = computed(() => props.criteria.find((c) => c.key === activeKey.value) || null)

// Échap, même motif que YarnWeightHelp.vue : écouteur posé à l'ouverture, retiré à la
// fermeture et au démontage.
function onKey(e) {
  if (e.key === 'Escape') emit('close')
}
watch(
  () => props.open,
  (v) => {
    if (v) {
      // Une popup rouverte repart de la liste des critères : jamais sur les options d'un
      // critère choisi lors de l'ouverture précédente.
      page.value = 'criteria'
      activeKey.value = null
      document.addEventListener('keydown', onKey)
    } else {
      document.removeEventListener('keydown', onKey)
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))

// « Réinitialiser » n'a de sens que s'il y a quoi réinitialiser : au moins une valeur non
// vide dans `filters` ET un libellé fourni par le parent.
const resetVisible = computed(() => Boolean(props.resetLabel) && Object.values(props.filters || {}).some((v) => v))
// Valeur courante du critère actif — lue deux fois dans le template (coche « toutes »,
// coche de chaque option) : un seul calcul, réutilisé aux deux endroits.
const activeValue = computed(() => props.filters?.[activeCriterion.value?.key] || '')

// Libellé secondaire d'un critère sur la page des critères : l'option choisie, ou le
// libellé « toutes » si aucun filtre (valeur '' ou valeur inconnue).
function currentLabel(criterion) {
  const value = props.filters?.[criterion.key] || ''
  if (!value) return criterion.allLabel
  const option = (criterion.options || []).find((o) => o.value === value)
  return option ? option.label : criterion.allLabel
}

function openOptions(criterion) {
  activeKey.value = criterion.key
  page.value = 'options'
}
function goBack() {
  page.value = 'criteria'
  activeKey.value = null
}
function choose(value) {
  // Quoi qu'on ait choisi (« toutes » comprise), on retourne à la liste des critères :
  // le geste suivant le plus probable est de filtrer sur un autre critère.
  emit('set-filter', activeKey.value, value)
  goBack()
}

// Liste d'affichage de la page options : les options du critère actif, entrecoupées d'un
// en-tête dès que le `group` change (contrat : les options d'un même groupe sont contiguës).
const optionRows = computed(() => {
  const rows = []
  let lastGroup
  for (const option of activeCriterion.value?.options || []) {
    if (option.group && option.group !== lastGroup) {
      rows.push({ kind: 'group', id: `group-${rows.length}`, label: option.group })
    }
    lastGroup = option.group
    rows.push({ kind: 'option', id: option.value, value: option.value, label: option.label })
  }
  return rows
})
</script>

<template>
  <Transition name="fade">
    <div v-if="open" class="yfd" data-test="yarn-filter-dialog">
      <div class="yfd__scrim" @click="emit('close')"></div>
      <div class="yfd__card" role="dialog" aria-modal="true" aria-labelledby="yfd-title" @keydown="trapTabFocus">
        <header class="yfd__head">
          <h2 id="yfd-title" class="yfd__title">{{ title }}</h2>
          <button class="yfd__close" type="button" :aria-label="t('common.close')" data-test="filter-close" @click="emit('close')">
            <AppIcon name="close" :size="18" />
          </button>
        </header>

        <div class="yfd__body">
          <!-- Page 1 : les critères, avec la valeur courante en texte secondaire. -->
          <template v-if="page === 'criteria'">
            <div class="yfd__list">
              <button
                v-for="c in criteria"
                :key="c.key"
                class="yfd__row"
                type="button"
                :data-test="`filter-crit-${c.key}`"
                @click="openOptions(c)"
              >
                <span class="yfd__row-main">
                  <span class="yfd__row-label">{{ c.label }}</span>
                  <span class="yfd__row-value">{{ currentLabel(c) }}</span>
                </span>
              </button>
            </div>
            <button v-if="resetVisible" class="yfd__reset" type="button" data-test="filter-reset" @click="emit('reset')">
              {{ resetLabel }}
            </button>
          </template>

          <!-- Page 2 : « toutes » en tête, puis les options (regroupées le cas échéant).
               La coche marque la valeur courante partout. -->
          <template v-else>
            <button class="yfd__back" type="button" data-test="filter-back" @click="goBack">{{ t('common.back') }}</button>
            <p class="yfd__sub">{{ activeCriterion.label }}</p>
            <div class="yfd__list">
              <button class="yfd__row" type="button" data-test="filter-all" @click="choose('')">
                <span class="yfd__row-label">{{ activeCriterion.allLabel }}</span>
                <AppIcon v-if="!activeValue" class="yfd__check" name="check" :size="18" />
              </button>
              <template v-for="row in optionRows" :key="row.id">
                <div v-if="row.kind === 'group'" class="yfd__group">{{ row.label }}</div>
                <button v-else class="yfd__row" type="button" data-test="filter-option" @click="choose(row.value)">
                  <span class="yfd__row-label">{{ row.label }}</span>
                  <AppIcon v-if="activeValue === row.value" class="yfd__check" name="check" :size="18" />
                </button>
              </template>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* Idiome YarnWeightHelp.vue : feuille du bas, scrim, carte aux tokens du projet, même
   z-index (80) et même fond de scrim. */
.yfd { position: fixed; inset: 0; z-index: 80; display: flex; align-items: flex-end; justify-content: center; }
.yfd__scrim { position: absolute; inset: 0; background: rgba(58, 46, 40, 0.42); }
.yfd__card { position: relative; width: 100%; max-width: 480px; max-height: 82vh; display: flex; flex-direction: column; background: var(--bg); border-radius: var(--r-lg) var(--r-lg) 0 0; box-shadow: var(--e-3); padding: var(--sp-4) max(var(--sp-4), var(--sa-left)) max(var(--sp-4), var(--sa-bottom)); }
.yfd__head { display: flex; align-items: center; gap: var(--sp-2); flex-shrink: 0; }
.yfd__title { flex: 1; font-family: var(--font-display); font-size: 20px; margin: 0; }
.yfd__close { flex-shrink: 0; width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--line); background: var(--tile); color: var(--ink); border-radius: var(--r-md); box-shadow: var(--clay-sm); }
/* La liste défile dans le corps : le titre et Retour restent visibles sur une longue
   liste de marques ou de matières. */
.yfd__body { overflow-y: auto; min-height: 0; margin-top: var(--sp-3); }
/* Options empilées pleine largeur (motif .pss__actions de PhotoSourceSheet) : cible
   tactile généreuse, un geste par ligne. */
.yfd__list { display: flex; flex-direction: column; gap: var(--sp-2); }
.yfd__row { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); width: 100%; min-height: 44px; text-align: left; font: inherit; color: var(--ink); background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--sp-3); box-shadow: var(--clay-sm); }
.yfd__row-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.yfd__row-label { font-weight: 600; }
.yfd__row-value { font-size: 13px; color: var(--ink-55); }
.yfd__check { color: var(--brand-deep); flex-shrink: 0; }
.yfd__group { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-55); margin-top: var(--sp-2); }
.yfd__reset { width: 100%; min-height: 44px; margin-top: var(--sp-3); font: inherit; font-weight: 600; color: var(--ink); background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-md); box-shadow: var(--clay-sm); }
.yfd__back { display: inline-flex; align-items: center; min-height: 44px; padding: 0 var(--sp-2); margin-left: calc(var(--sp-2) * -1); background: none; border: none; color: var(--brand-deep); font: inherit; font-weight: 600; }
.yfd__sub { font-size: 13px; color: var(--ink-55); margin: 0 0 var(--sp-2); }
.fade-enter-active, .fade-leave-active { transition: opacity var(--motion-fast); }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
