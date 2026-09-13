<script setup>
import { computed, watch, onBeforeUnmount, ref, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/AppIcon.vue'
import { useSettingsStore } from '@/stores/settings'
import { usePurchasesStore } from '@/stores/purchases'
import { formatLength, formatWeight, currencySymbol } from '@/utils/units'
import { latestPurchaseDate, bainsOf } from '@/utils/purchases'
import { orderedLabels } from '@/constants/yarn-labels'
import { deduceOrigin } from '@/constants/fiber-origin'
import { compositionText } from '@/constants/compositions'
import { trapTabFocus, useDialogFocusReturn } from '@/composables/useFocusTrap'

// Fiche détail en lecture seule d'une laine (feuille du bas). Affiche TOUS les champs
// saisis à la création (règle « jamais perdre d'info ») ; « Modifier » émet `edit`
// (l'appelant ouvre le formulaire d'édition existant). Motif dialogue = YarnConsumptionDialog.
const props = defineProps({
  open: { type: Boolean, default: false },
  yarn: { type: Object, default: () => ({}) },
  usage: { type: Object, default: () => ({ state: 'free', used: 0, total: 0 }) },
})
const emit = defineEmits(['close', 'edit'])
const { t, locale } = useI18n()
const settings = useSettingsStore()
const purchasesStore = usePurchasesStore()
const closeBtn = ref(null)

// Bain et date d'achat ne sont plus des champs de la laine (retirés du formulaire lors
// des travaux précédents sur le budget) : ce sont des dérivés du registre d'achats de CETTE
// laine. `|| []` : filet pour un `forYarn` mocké par défaut (createTestingPinia), même
// motif que YarnPurchases.vue.
const purchaseLines = computed(() => purchasesStore.forYarn(props.yarn?.id) || [])

// Une ligne par champ non vide (les champs vides ne s'affichent pas — pas de « — »
// inutile). Ordre = ordre de saisie du formulaire.
const rows = computed(() => {
  const y = props.yarn || {}
  const out = []
  const push = (labelKey, value) => { if (value !== '' && value != null && !(Array.isArray(value) && !value.length)) out.push({ labelKey, value }) }
  push('yarn.brand', y.brand)
  push('yarn.model', y.model)
  push('yarn.colorName', y.colorName)
  push('yarn.colorType', y.colorType && y.colorType !== 'uni' ? t(`yarn.colorTypes.${y.colorType}`) : '')
  push('yarn.colorNotes', y.colorNotes)
  push('yarn.weight', y.weight ? t(`yarn.weights.${y.weight}`) : '')
  const imperial = settings.unitSystem === 'imperial'
  // Valeurs d'UNE pelote : profil 'detail' partout ici, jamais de bascule (cf.
  // src/utils/units.js). Recalculés à chaque changement de réglage (computed).
  const opts = { locale: locale.value, system: settings.unitSystem, profile: 'detail' }
  const len = y.lengthM ? formatLength(y.lengthM, opts) : null
  push(imperial ? 'yarn.lengthYd' : 'yarn.lengthM', len ? len.text : '')
  const wgt = y.grams ? formatWeight(y.grams, opts) : null
  push(imperial ? 'yarn.ounces' : 'yarn.grams', wgt ? wgt.text : '')
  push('yarn.quantity', y.quantity)
  push('yarn.priceWithSymbol', y.price)
  // Récapitulatif du registre d'achats (travaux sur le budget) — remplace les deux anciens
  // champs `yarn.bain`/`yarn.purchasedAt` de la fiche, retirés du formulaire lors des
  // travaux précédents : rien n'est perdu, bain et date se lisent maintenant sur TOUTES les
  // lignes d'achat plutôt que sur une seule paire de champs. Absent si le registre n'a
  // aucune ligne pour cette laine (rien à récapituler).
  const lines = purchaseLines.value
  if (lines.length) {
    push('yarn.purchasesCount', lines.length)
    push('yarn.bain', bainsOf(lines))
    push('yarn.lastPurchaseDate', latestPurchaseDate(lines))
  }
  // Traduit chaque matériau du catalogue dans la langue active plutôt que de pousser la clé
  // brute (toujours en français) : c'était le défaut visible sur les captures du guide en
  // allemand/anglais/espagnol (06/08/2026). Les compositions personnalisées
  // ressortent inchangées (compositionText délègue à compositionLabel).
  push('yarn.composition', compositionText(y.composition, t))
  return out
})
// Ordre canonique (YARN_LABELS), pas l'ordre de cochage — même helper que l'export tableur
// et la carte du stock (revue du 06/08/2026).
const labels = computed(() => orderedLabels(props.yarn?.labels))
const origine = computed(() => deduceOrigin(props.yarn?.composition))
const origineTexte = computed(() => {
  const o = origine.value
  if (!o.key) return ''
  if (o.key !== 'melange') return t(`yarn.origin.${o.key}`)
  // Mélange : on nomme les origines présentes plutôt que d'afficher « Mélange » seul, qui
  // désigne dans l'usage courant n'importe quel mélange de fibres et ne dirait rien de
  // l'origine — le sujet de la ligne.
  if (o.origins.length === 2 && o.origins.includes('animale') && o.origins.includes('vegetale'))
    return t('yarn.origin.melange')
  return o.origins.map((k) => t(`yarn.origin.${k}`)).join(' · ')
})
const usageLabel = computed(() => {
  const u = props.usage || {}
  const base = t(`yarn.usage.${u.state}`)
  return u.state !== 'free' && u.used < u.total ? `${base} · ${u.used}/${u.total}` : base
})

function onKey(e) { if (e.key === 'Escape') emit('close') }
// Piège au Tab + restitution au déclencheur à la fermeture (dette audit UX 16/07,
// composable partagé) : le voile ne bloque le Tab que visuellement.
useDialogFocusReturn(() => props.open)
watch(() => props.open, (v) => {
  if (v) { document.addEventListener('keydown', onKey); nextTick(() => closeBtn.value?.focus?.()) }
  else document.removeEventListener('keydown', onKey)
}, { immediate: true })
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <Transition name="fade">
    <div v-if="open" class="ydet">
      <div class="ydet__scrim" @click="emit('close')"></div>
      <div class="ydet__card" role="dialog" aria-modal="true" aria-labelledby="ydet-title" @keydown="trapTabFocus">
        <header class="ydet__head">
          <h2 id="ydet-title" class="ydet__title">{{ t('yarn.detailTitle') }}</h2>
          <button ref="closeBtn" class="ydet__close" type="button" :aria-label="t('common.close')" @click="emit('close')">
            <AppIcon name="close" :size="18" />
          </button>
        </header>

        <img v-if="yarn.photo" :src="yarn.photo" class="ydet__photo" :alt="[yarn.brand, yarn.colorName].filter(Boolean).join(' ')" />
        <div v-if="yarn.color" class="ydet__swatch"><span class="ydet__dot" :style="{ background: yarn.color }"></span>{{ yarn.colorName }}</div>

        <dl class="ydet__list">
          <template v-for="r in rows" :key="r.labelKey">
            <dt class="ydet__dt">{{ t(r.labelKey, { symbol: currencySymbol(settings.currency, locale) }) }}</dt>
            <dd class="ydet__dd">{{ r.value }}</dd>
          </template>
        </dl>

        <section v-if="origineTexte || labels.length" class="ydet__block">
          <h3 class="ydet__h3">{{ t('yarn.labelsTitle') }}</h3>
          <p v-if="origineTexte" class="ydet__origin">{{ origineTexte }}</p>
          <ul v-if="labels.length" class="ydet__labels">
            <li v-for="k in labels" :key="k">{{ t(`yarn.labels.${k}`) }}</li>
          </ul>
        </section>

        <div class="ydet__usage">
          <span class="tag" :class="`tag--${usage.state}`">{{ usageLabel }}</span>
        </div>

        <button type="button" class="btn btn--primary btn--block ydet__edit" @click="emit('edit')">
          <AppIcon name="edit" :size="17" /> {{ t('common.edit') }}
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.ydet { position: fixed; inset: 0; z-index: 80; display: flex; align-items: flex-end; justify-content: center; }
.ydet__scrim { position: absolute; inset: 0; background: rgba(58, 46, 40, 0.42); }
.ydet__card { position: relative; width: 100%; max-width: 480px; max-height: 82vh; overflow-y: auto; background: var(--bg); border-radius: var(--r-lg) var(--r-lg) 0 0; box-shadow: var(--e-3); padding: var(--sp-4) max(var(--sp-4), var(--sa-left)) max(var(--sp-4), var(--sa-bottom)); }
.ydet__head { display: flex; align-items: center; gap: var(--sp-2); margin-bottom: var(--sp-3); }
.ydet__title { flex: 1; font-family: var(--font-display); font-size: 20px; margin: 0; color: var(--ink); }
.ydet__close { flex-shrink: 0; width: 44px; height: 44px; border: 1px solid var(--line); background: var(--tile); color: var(--ink); border-radius: var(--r-md); box-shadow: var(--clay-sm); }
.ydet__photo { width: 100%; max-height: 200px; object-fit: cover; border-radius: var(--r-md); border: 1px solid var(--line); margin-bottom: var(--sp-3); }
.ydet__swatch { display: flex; align-items: center; gap: var(--sp-2); font-weight: 600; margin-bottom: var(--sp-3); }
.ydet__dot { width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--line); }
.ydet__list { display: grid; grid-template-columns: auto 1fr; gap: var(--sp-2) var(--sp-3); margin: 0 0 var(--sp-3); }
.ydet__dt { color: var(--ink-55); font-size: 13px; }
.ydet__dd { color: var(--ink); font-weight: 600; margin: 0; }
.ydet__block { margin-bottom: var(--sp-4); }
.ydet__h3 { font-family: var(--font-display); font-size: 15px; font-weight: 700; color: var(--ink); margin: 0 0 var(--sp-2); }
.ydet__origin { color: var(--ink-55); font-size: 13px; margin: 0 0 var(--sp-2); }
.ydet__labels { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin: 0; padding: 0; list-style: none; }
.ydet__labels li { font-size: 12px; font-weight: 600; color: var(--ink); background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-pill); padding: 3px 10px; }
.ydet__usage { margin-bottom: var(--sp-4); }
.tag { font-size: 11px; font-weight: 700; border-radius: var(--r-pill); padding: 2px 9px; border: 1px solid var(--line); color: var(--ink-55); }
.tag--reserved { color: var(--mustard-deep); }
.tag--free { color: var(--sage); }
.tag--used { color: var(--sage-deep); }
.tag--usedPartial { color: var(--ink-55); }
.fade-enter-active, .fade-leave-active { transition: opacity var(--motion-fast); }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
