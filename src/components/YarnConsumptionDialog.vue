<script setup>
import { reactive, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/AppIcon.vue'
import { trapTabFocus, useDialogFocusReturn } from '@/composables/useFocusTrap'
import { filtrerSaisieDecimale, parseDecimal } from '@/utils/decimal'
import { roundSkeins } from '@/utils/yarn-usage'
import { formatSkeins } from '@/utils/units'

// Question posée quand un projet passe à Terminé OU Abandonné (K2 + R3), SI ce projet
// réserve des pelotes : « combien as-tu réellement utilisées ? ». Un seul dialogue, deux
// modes (`mode` prop) :
// - 'done' (défaut) : le cas normal, tout le réservé a été tricoté → défaut = reserved.
// - 'abandoned' : le cas normal est qu'on détricote tout (on frogue) → défaut = 0 ; on ne
//   saisit que ce qui est VRAIMENT perdu (pelotes entamées non détricotées).
// Règle (décision produit) : un bouton Annuler existe, et croix, voile, Échap (et le Retour
// Android, géré par l'appelant via le store project-consumption) valent TOUS Annuler :
// `cancel` est émis, rien n'est consommé, le statut ne change pas. Seul « Valider » émet
// `confirm`, avec les valeurs saisies (champs pré-remplis au défaut du mode). Cette règle
// remplace l'ancienne « pas d'Annuler, fermer applique le défaut », qui faisait consommer
// des pelotes à qui voulait seulement refermer la fenêtre.
// Plafond de saisie = ce qui est DISPONIBLE pour ce projet (`y.available` : sa réservation
// plus le stock libre), pas le réservé : on peut avoir tricoté plus que prévu, jamais plus que
// ce qui est à soi. Pas non plus le stock total : les pelotes réservées par d'autres projets ne
// sont pas à prendre (même plafond que consumeProjectReservation). Au-delà, la saisie est
// ramenée au disponible et un avertissement propose de corriger le stock (`fix-stock`).
const props = defineProps({
  open: { type: Boolean, default: false },
  yarns: { type: Array, default: () => [] },
  mode: { type: String, default: 'done' }, // 'done' | 'abandoned'
})
const emit = defineEmits(['confirm', 'cancel', 'fix-stock'])
const { t, locale } = useI18n()

const titleKey = computed(() => (props.mode === 'abandoned' ? 'project.abandonTitle' : 'project.consumeTitle'))
const introKey = computed(() => (props.mode === 'abandoned' ? 'project.abandonIntro' : 'project.consumeIntro'))
const hintKey = computed(() => (props.mode === 'abandoned' ? 'project.abandonHint' : 'project.consumeHint'))

// Défaut par mode : tout le réservé (compté comme tricoté) si 'done', sinon 0 (on
// détricote tout, on ne récupère que ce qui est explicitement saisi comme perdu). En 'done',
// jamais au-dessus du disponible : le stock a pu baisser sous la réservation depuis (stock
// corrigé à la main), et un champ pré-rempli au réservé montrerait une valeur que l'écriture
// tronquerait ensuite en silence.
function defaultFor(y) {
  return props.mode === 'abandoned' ? 0 : Math.min(y.reserved, y.available ?? 0)
}

// { [yarnId]: quantité saisie }, réinitialisé au défaut du mode à chaque ouverture.
const used = reactive({})
// yarnId -> texte tapé dans le champ, miroir d'affichage (même motif que `yarnQtyText`,
// ProjectEditView.vue) : `used` change à chaque caractère décimal valide, donc lier `:value`
// à `defaultFor(y)` seul re-régresse le champ sous le doigt dès que `props.yarns` est
// recalculé (nouveau tableau, même contenu — ex. changement de langue), alors que `used`
// garde la vraie saisie. Ce tampon reste calé sur ce qui a été tapé ; seule une saisie
// BORNÉE (au-dessus du réservé) l'écrase.
const usedText = reactive({})
// yarnId -> true tant que la dernière saisie dépassait le disponible (effacé à la saisie suivante,
// et au champ vidé).
const overStock = reactive({})
function resetDefaults() {
  for (const key of Object.keys(used)) delete used[key]
  for (const key of Object.keys(usedText)) delete usedText[key]
  for (const key of Object.keys(overStock)) delete overStock[key]
  for (const y of props.yarns) {
    used[y.id] = defaultFor(y)
    // Réservé au-dessus du disponible : le défaut vient d'être ramené à la borne, ce qui doit
    // se dire dès l'ouverture (avec « Corriger le stock »), pas seulement après une frappe. Le
    // mode Abandonné part de 0, rien n'y est ramené.
    if (props.mode !== 'abandoned' && y.reserved > (y.available ?? 0)) overStock[y.id] = true
  }
}

// Rend `null` — jamais 0 — quand la saisie n'est PAS un nombre utilisable. `Number('')` vaut
// 0 ET passe `Number.isFinite`, donc l'ancien garde ne se déclenchait jamais : vider le champ
// pour retaper valait « 0 pelote consommée », et un Valider à cet instant rendait au stock
// toute la réserve d'un projet pourtant terminé — exactement ce que cette fenêtre existe pour
// empêcher. Le plafond est le disponible pour ce projet. Seul appelant : `onInput` ci-dessous. `filtrerSaisieDecimale` tolère la virgule ET
// laisse tomber un signe moins (même règle que le prix) : une quantité négative n'existe pas.
function clampFor(id, raw) {
  const max = props.yarns.find((y) => y.id === id)?.available ?? 0
  const filtre = filtrerSaisieDecimale(raw)
  if (filtre === '') return null
  const n = parseDecimal(filtre)
  return Number.isFinite(n) ? roundSkeins(Math.max(0, Math.min(n, max))) : null
}
function onInput(id, e) {
  // Un caractère refusé (lettre, signe moins) est retiré de l'affichage tout de suite,
  // comme `onPrixLaine` : « 2a » devient « 2 », « -5 » devient « 5 ». La virgule seule
  // survit (filtrerSaisieDecimale la garde) pour que « 2, » reste tapable jusqu'à « 2,5 ».
  const filtre = filtrerSaisieDecimale(e.target.value)
  if (filtre !== e.target.value) e.target.value = filtre
  // `usedText` est mis à jour AVANT tout retour anticipé (même motif que `yarnQtyText`,
  // ProjectEditView.vue) : c'est lui, pas `used`, que `:value` lit.
  usedText[id] = filtre
  const next = clampFor(id, filtre)
  // Champ vidé/illisible : on GARDE la valeur courante (l'état ne change pas, donc Vue ne
  // repeint pas le champ sous le doigt) et la frappe suivante la remplacera normalement.
  // L'avertissement, lui, tombe : il parlait d'une saisie qui n'est plus là. Le champ vide n'est
  // jamais lu comme 0 pour autant (`used` reste tel quel).
  if (next === null) {
    delete overStock[id]
    return
  }
  used[id] = next
  // Dépassement du disponible : refusé (champ ramené à la borne) mais dit, avec une issue.
  const brut = roundSkeins(parseDecimal(filtre))
  if (brut > next) overStock[id] = true
  else delete overStock[id]
  // Ne réécrire QUE si le nombre tapé a vraiment été borné (au-dessus du disponible) : comparer
  // au texte tapé casserait « 2, » (reformaté en "2" avant que la virgule n'ait pu rejoindre
  // son « 5 »).
  if (brut !== next) {
    const texte = formatSkeins(next, { locale: locale.value, grouping: false })
    usedText[id] = texte
    e.target.value = texte
  }
}

// Fermer sans valider = annuler : le parent ne consomme rien et ne change pas le statut.
function cancel() {
  emit('cancel')
}
function confirmEdited() {
  emit(
    'confirm',
    props.yarns.map((y) => ({ id: y.id, used: used[y.id] ?? defaultFor(y) })),
  )
}

function onKey(e) {
  if (e.key === 'Escape') cancel()
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
      <div class="ycn__scrim" @click="cancel"></div>
      <div class="ycn__card" role="dialog" aria-modal="true" aria-labelledby="ycn-title" @keydown="trapTabFocus">
        <header class="ycn__head">
          <h2 id="ycn-title" class="ycn__title">{{ t(titleKey) }}</h2>
          <button class="ycn__close" type="button" :aria-label="t('common.close')" @click="cancel">
            <AppIcon name="close" :size="18" />
          </button>
        </header>
        <p class="ycn__intro">{{ t(introKey) }}</p>
        <ul class="ycn__list">
          <li v-for="y in yarns" :key="y.id" class="ycn__row">
            <div class="ycn__meta">
              <span class="ycn__name">{{ y.name }}</span>
              <span class="ycn__reserved">{{ t('project.consumeReserved', { n: formatSkeins(y.reserved, { locale }) }) }}</span>
            </div>
            <input
              class="ycn__input"
              inputmode="decimal"
              :aria-label="y.name"
              :value="usedText[y.id] ?? formatSkeins(defaultFor(y), { locale, grouping: false })"
              @input="onInput(y.id, $event)"
            />
            <p v-if="overStock[y.id]" class="ycn__over" role="alert">
              {{ t(y.othersReserved ? 'project.consumeOverStock' : 'project.consumeOverStockPlain', { n: formatSkeins(y.available, { locale }) }) }}
              <button type="button" class="ycn__fix" @click="emit('fix-stock', y.id)">{{ t('project.consumeFixStock') }}</button>
            </p>
          </li>
        </ul>
        <p class="ycn__hint">{{ t(hintKey) }}</p>
        <div class="ycn__actions">
          <button type="button" class="btn btn--ghost ycn__cancel" @click="cancel">{{ t('common.cancel') }}</button>
          <button type="button" class="btn btn--primary ycn__confirm" @click="confirmEdited">
            {{ t('project.consumeConfirm') }}
          </button>
        </div>
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
.ycn__row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--sp-3); background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--sp-3); box-shadow: var(--clay-sm); }
.ycn__meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ycn__name { font-weight: 700; color: var(--ink); }
.ycn__reserved { font-size: 12.5px; color: var(--ink-55); }
.ycn__input { flex-shrink: 0; width: 64px; height: 44px; text-align: center; font-size: 16px; font-variant-numeric: tabular-nums; border: 1px solid var(--line); background: var(--bg); color: var(--ink); border-radius: var(--r-md); box-shadow: var(--clay-press); }
.ycn__hint { font-size: 12.5px; color: var(--ink-55); margin: 0 0 var(--sp-3); }
.ycn__over { flex-basis: 100%; margin: 0; font-size: 12.5px; color: var(--ink); }
.ycn__fix { display: block; margin-top: var(--sp-1); min-height: 44px; padding: 0 var(--sp-3); border: 1px solid var(--line); background: var(--bg); color: var(--ink); border-radius: var(--r-md); font-weight: 700; }
.ycn__actions { display: flex; gap: var(--sp-2); }
.ycn__actions .btn { flex: 1; min-height: 44px; }
.fade-enter-active, .fade-leave-active { transition: opacity var(--motion-fast); }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
