<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/AppIcon.vue'
import { useSettingsStore } from '@/stores/settings'
import { usePurchasesStore } from '@/stores/purchases'
import { useSnackbarStore } from '@/stores/snackbar'
import { formatMoney, currencySymbol } from '@/utils/units'
import {
  emptyPurchase,
  lineAmount,
  totalsByCurrency,
  totalSkeins,
  acquiredFromStock,
  acquiredFromLines,
  stockGap,
  isPriceUnknown,
} from '@/utils/purchases'
import { consumedOf } from '@/utils/yarn-usage'
import { ymdLocal } from '@/utils/time-periods'
// Même règle que #yarn-price : ce champ portait le même défaut.
import { filtrerSaisieDecimale } from '@/utils/decimal'

// Bloc « Achats et cadeaux » d'une fiche de laine (travaux sur le budget, 31/07) :
// liste repliable des lignes d'historique, total (par devise), alerte d'écart
// stock/historique avec correction dans les DEUX sens. Le store `purchases` est
// normalement déjà chargé au démarrage de l'app (App.vue) — mais correctif final
// (réouverture du 01/08) : ce composant garde désormais son
// PROPRE filet (`if (!loaded) load()`, même motif que HomeView.vue et
// ExpensesView.vue), car toute exception AVANT la reprise du budget dans la
// chaîne `onMounted` d'App.vue laisserait sinon ce store vide sur TOUTES les
// fiches de laine tant que l'accueil ou l'écran Dépenses n'ont pas été visités —
// une fiche qui n'affiche aucun achat alors qu'elle en a est le pire mensonge
// possible pour ce lot, et déclenche en plus une alerte d'écart à tort.
//
// L'ajustement du stock N'ÉCRIT RIEN ici : il émet `update:quantity`, c'est
// l'appelante (fiche laine) qui sait comment traduire ce nombre dans SON propre
// formulaire. Ajouter la ligne manquante, à l'inverse, écrit
// directement dans `purchases` — c'est bien le rôle de ce composant, qui possède
// déjà tout le CRUD des lignes (édition, suppression).
const props = defineProps({
  yarnId: { type: Number, default: null },
  yarn: { type: Object, default: () => ({}) },
  yarnLabel: { type: String, default: '' },
})
const emit = defineEmits(['update:quantity'])
const { t, locale } = useI18n()
const settings = useSettingsStore()
const purchasesStore = usePurchasesStore()
const snackbar = useSnackbarStore()

onMounted(() => {
  if (!purchasesStore.loaded) purchasesStore.load()
})

// `|| []` : filet, pas un cas nominal — un test qui monte ce composant sous
// `createTestingPinia` (actions auto-stubbées, cf. StashView) reçoit
// `undefined` d'un `forYarn` mocké par défaut ; sans ce filet, `visibleLines`
// plus bas ferait `undefined.slice(...)` et planterait le montage.
const lines = computed(() => purchasesStore.forYarn(props.yarnId) || [])

// Trois dernières visibles (déjà triées plus récentes d'abord par `forYarn`) ; le
// reste replié derrière un bouton qui annonce le nombre exact restant.
const VISIBLE_DEFAULT = 3
const expanded = ref(false)
const hiddenCount = computed(() => Math.max(0, lines.value.length - VISIBLE_DEFAULT))
const visibleLines = computed(() => (expanded.value ? lines.value : lines.value.slice(0, VISIBLE_DEFAULT)))

const totals = computed(() => totalsByCurrency(lines.value))
const totalCurrencies = computed(() => Object.keys(totals.value))
const skeins = computed(() => totalSkeins(lines.value))

function moneyStat(currency) {
  return formatMoney(totals.value[currency], { locale: locale.value, currency, profile: 'total' })
}

// Écart : positif si le stock sous-entend plus de pelotes acquises que l'historique
// n'en enregistre (achat oublié, ou cadeau jamais noté) ; négatif si l'historique
// en compte plus que le stock (pelotes sorties sans passer par un projet). Dans les
// deux cas, l'alerte n'est SIMPLEMENT PAS RENDUE quand l'écart est nul — pas juste
// masquée par du CSS (« pas seulement masquée »).
const stockAcquired = computed(() => acquiredFromStock(props.yarn))
const historyAcquired = computed(() => acquiredFromLines(lines.value))
const gap = computed(() => stockGap(props.yarn, lines.value))

// Ce que « ajuster le stock » doit VRAIMENT écrire : `yarn.quantity` est un RESTANT, pas
// un total acquis — `historyAcquired` (un total, au même titre que `stockAcquired`) ne
// peut pas s'y substituer tel quel. Revue (01/08) : le cahier des
// charges d'origine demandait d'émettre `historyAcquired` brut, mais sur son propre jeu
// d'essai (12 restantes + 3 tricotées, historique 12) ce nombre est DÉJÀ la quantité en
// stock — le bouton n'aurait rien changé et l'alerte serait restée affichée après le
// clic. Le bon nombre est l'historique MOINS ce qui a déjà été tricoté (déjà déduit de
// `quantity`, cf. `acquiredFromStock`), borné à 0 (une consommation qui dépasserait
// l'historique corrigé ne doit jamais produire une quantité négative).
const consumedTotal = computed(() =>
  Object.values(consumedOf(props.yarn)).reduce((a, n) => a + (Number(n) || 0), 0),
)
const adjustedQuantity = computed(() => Math.max(0, historyAcquired.value - consumedTotal.value))

const correctingOpen = ref(false)
function toggleCorrect() {
  correctingOpen.value = !correctingOpen.value
}
// L'appelante n'a plus rien à recalculer : ce composant émet directement la quantité en
// stock à écrire, pas un total acquis à traduire — ce composant n'écrit rien lui-même.
function adjustStock() {
  emit('update:quantity', adjustedQuantity.value)
  correctingOpen.value = false
}

// Formulaire d'ajout/édition, réutilisé pour : « ajouter la ligne manquante »
// (préremplie avec l'écart) et l'édition d'une ligne existante.
const formMode = ref(null) // null | 'add' | 'edit'
const editingId = ref(null)
const submitting = ref(false) // verrou anti double-appui d'`submitForm` (cf. son commentaire)
const form = reactive(emptyPurchase())

// Même règle et même raison que `onPrixLaine` dans StashView.vue : la valeur filtrée est
// réécrite dans le champ, sans quoi un symbole tapé après un montant propre y resterait.
function onPrixUnitaire(event) {
  const propre = filtrerSaisieDecimale(event.target.value)
  event.target.value = propre
  form.unitPrice = propre
}

function openAddMissing() {
  Object.assign(form, emptyPurchase(), {
    yarnId: props.yarnId,
    yarnLabel: props.yarnLabel,
    kind: 'buy',
    quantity: Math.abs(gap.value) || 1,
    currency: settings.currency,
    // Jour LOCAL : en UTC, l'achat oublié se proposait daté de la veille.
    date: ymdLocal(new Date()),
  })
  formMode.value = 'add'
  editingId.value = null
}
function openEdit(line) {
  Object.assign(form, emptyPurchase(), line)
  formMode.value = 'edit'
  editingId.value = line.id
}
function closeForm() {
  formMode.value = null
  editingId.value = null
}
async function submitForm() {
  // `form` est réutilisé entre édition et ajout : `openEdit` y copie `line.id`, et
  // `Object.assign` ne le retire jamais (une clé absente des sources d'un assign n'efface
  // pas une clé déjà présente sur la cible). Sans ce retrait explicite, un cycle
  // « Modifier » (Annuler) puis « Ajouter l'achat manquant » enverrait l'id de la ligne
  // éditée à `purchasesStore.add()`, qui écrirait sur une clé primaire déjà prise
  // (ConstraintError Dexie côté ajout) — silencieusement, rien n'est écrit.
  // Verrou anti double-appui, même motif que `removingIds` plus bas et que
  // `saving`/`resolvingPurchase` (StashView) : `add()` attend une écriture Dexie PUIS un
  // `load()` complet, et `closeForm()` ne vient qu'après les deux — le bouton reste donc
  // monté et actif pendant tout ce temps. Un second appui sur appareil lent écrivait une
  // DEUXIÈME ligne identique : budget doublé, `stockGap` inversé, et la bannière de
  // correction revenait proposer d'ajuster le stock d'un écart qu'elle venait de créer.
  if (submitting.value) return
  submitting.value = true
  try {
    const { id: _staleId, ...payload } = form
    if (payload.kind === 'gift') payload.unitPrice = ''
    if (formMode.value === 'edit') {
      await purchasesStore.update(editingId.value, payload)
    } else {
      await purchasesStore.add(payload)
    }
    closeForm()
    correctingOpen.value = false
  } finally {
    submitting.value = false
  }
}

// Verrou anti double-appui (même motif que `saving`/`resolvingPurchase`, StashView.vue) :
// sans lui, un double-tap enchaînerait deux suppressions Dexie concurrentes — la seconde
// (get + delete sur une ligne déjà partie) renvoie `undefined`, qu'un « Annuler » ultérieur
// écrirait tel quel en base (exception), en plus d'afficher deux bandeaux. Par id de ligne
// (pas un verrou global) : supprimer une AUTRE ligne pendant que celle-ci est en vol reste
// possible.
const removingIds = reactive(new Set())
async function removeLine(line) {
  if (removingIds.has(line.id)) return
  removingIds.add(line.id)
  try {
    const removed = await purchasesStore.remove(line.id)
    snackbar.show(t('purchases.deleted'), {
      actionLabel: t('common.undo'),
      onAction: () => purchasesStore.restore(removed),
    })
  } finally {
    removingIds.delete(line.id)
  }
}

function lineAmountText(line) {
  return formatMoney(lineAmount(line), { locale: locale.value, currency: line.currency, profile: 'detail' }).text
}
</script>

<template>
  <section class="ypur">
    <h2 class="ypur__title">{{ t('purchases.title') }}</h2>

    <div v-if="gap !== 0" class="ypur__gap" data-test="purchases-gap" role="status">
      <AppIcon name="warning" :size="18" class="ypur__gap-icon" />
      <div class="ypur__gap-body">
        <p class="ypur__gap-msg">{{ t('purchases.gapMessage', { stock: stockAcquired, history: historyAcquired }) }}</p>
        <button type="button" class="btn ypur__gap-btn" data-test="purchases-correct" @click="toggleCorrect">
          {{ t('purchases.correct') }}
        </button>
        <div v-if="correctingOpen" class="ypur__correct">
          <!-- « Ajouter l'achat manquant » n'a de sens QUE si le stock DÉPASSE l'historique
               (achat oublié, cadeau jamais noté) : sur un écart négatif (historique déjà
               supérieur au stock), le champ se préremplirait avec |écart| et un clic
               DOUBLERAIT l'écart au lieu de le corriger — un achat qui n'a jamais eu lieu
               gonflerait le budget. « Ajuster le stock », lui, reste correct dans les deux
               sens (il ne fait que réconcilier `yarn.quantity` avec l'historique). -->
          <button v-if="gap > 0" type="button" class="btn ypur__correct-opt" data-test="purchases-correct-add" @click="openAddMissing">
            <AppIcon name="plus" :size="16" /> {{ t('purchases.correctAddMissing') }}
          </button>
          <button type="button" class="btn ypur__correct-opt" data-test="purchases-correct-adjust" @click="adjustStock">
            {{ t('purchases.correctAdjustStock', { n: adjustedQuantity }) }}
          </button>
        </div>
      </div>
    </div>

    <ul v-if="lines.length" class="ypur__list">
      <li v-for="line in visibleLines" :key="line.id" class="ypur__line" :data-test="`purchases-line-${line.id}`">
        <div class="ypur__line-main">
          <span class="ypur__line-qty">×{{ line.quantity }}</span>
          <span v-if="line.date" class="ypur__line-date">{{ line.date }}</span>
          <span v-if="line.bain" class="ypur__line-bain">{{ line.bain }}</span>
        </div>
        <div class="ypur__line-tags">
          <span v-if="line.reconstructed" class="tag">{{ t('purchases.reconstructedTag') }}</span>
          <span v-if="line.kind === 'gift'" class="tag">{{ t('purchases.kindGift') }}</span>
          <span v-else-if="isPriceUnknown(line)" class="tag">{{ t('purchases.priceUnknown') }}</span>
          <span v-else class="ypur__line-amount">{{ lineAmountText(line) }}</span>
        </div>
        <div class="ypur__line-actions">
          <button type="button" class="ypur__line-btn" :aria-label="t('common.edit')" @click="openEdit(line)">
            <AppIcon name="edit" :size="16" />
          </button>
          <button
            type="button"
            class="ypur__line-btn"
            data-test="purchases-delete"
            :aria-label="t('common.delete')"
            :disabled="removingIds.has(line.id)"
            @click="removeLine(line)"
          >
            <AppIcon name="close" :size="16" />
          </button>
        </div>
      </li>
    </ul>

    <button v-if="!expanded && hiddenCount > 0" type="button" class="ypur__more" data-test="purchases-show-more" @click="expanded = true">
      {{ t('purchases.showMore', { n: hiddenCount }) }} <AppIcon name="chevronDown" :size="16" />
    </button>

    <div v-if="lines.length" class="ypur__totals">
      <div v-for="cur in totalCurrencies" :key="cur" class="ypur__stat">
        <span class="ypur__num">{{ moneyStat(cur).text }}</span>
        <span class="ypur__lbl">{{ t(moneyStat(cur).unitKey, { symbol: moneyStat(cur).symbol }) }}</span>
      </div>
      <div class="ypur__stat">
        <span class="ypur__num">{{ skeins }}</span>
        <span class="ypur__lbl">{{ t('yarn.skeins') }}</span>
      </div>
    </div>

    <div v-if="formMode" class="ypur__form" data-test="purchases-form">
      <h3 class="ypur__form-title">{{ formMode === 'edit' ? t('common.edit') : t('purchases.correctAddMissing') }}</h3>
      <div class="seg">
        <button type="button" class="seg__opt" :class="{ 'seg__opt--on': form.kind === 'buy' }" @click="form.kind = 'buy'">
          {{ t('purchases.kindBuy') }}
        </button>
        <button type="button" class="seg__opt" :class="{ 'seg__opt--on': form.kind === 'gift' }" @click="form.kind = 'gift'">
          {{ t('purchases.kindGift') }}
        </button>
      </div>
      <label class="field-label mt2" for="ypur-qty">{{ t('yarn.quantity') }}</label>
      <input id="ypur-qty" v-model="form.quantity" class="input" inputmode="numeric" />
      <template v-if="form.kind === 'buy'">
        <label class="field-label mt2" for="ypur-price">
          {{ t('yarn.priceWithSymbol', { symbol: currencySymbol(form.currency || settings.currency, locale) }) }}
        </label>
        <input id="ypur-price" :value="form.unitPrice" class="input" inputmode="decimal" placeholder="—" @input="onPrixUnitaire" />
      </template>
      <label class="field-label mt2" for="ypur-date">{{ t('yarn.purchasedAt') }}</label>
      <input id="ypur-date" v-model="form.date" type="date" class="input" />
      <label class="field-label mt2" for="ypur-bain">{{ t('yarn.bain') }}</label>
      <input id="ypur-bain" v-model="form.bain" class="input" />
      <div class="ypur__form-actions">
        <button type="button" class="btn" data-test="purchases-form-cancel" @click="closeForm">{{ t('common.cancel') }}</button>
        <button type="button" class="btn btn--primary" data-test="purchases-form-save" :disabled="submitting" @click="submitForm">{{ t('common.save') }}</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ypur {
  margin-top: var(--sp-4);
}
.ypur__title {
  font-family: var(--font-display);
  font-size: 17px;
  margin: 0 0 var(--sp-2);
  color: var(--ink);
}
.ypur__gap {
  display: flex;
  gap: var(--sp-2);
  align-items: flex-start;
  background: color-mix(in srgb, var(--warning) 12%, var(--tile));
  border: 1px solid var(--warning);
  border-radius: var(--r-md);
  padding: var(--sp-3);
  margin-bottom: var(--sp-3);
  color: var(--warning);
}
.ypur__gap-icon {
  flex-shrink: 0;
  margin-top: 2px;
}
.ypur__gap-body {
  flex: 1;
  min-width: 0;
}
.ypur__gap-msg {
  margin: 0 0 var(--sp-2);
  color: var(--ink);
  font-size: 13.5px;
  line-height: 1.4;
}
.ypur__gap-btn {
  min-height: 36px;
  padding: 0 var(--sp-3);
}
.ypur__correct {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
}
.ypur__correct-opt {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  min-height: 40px;
}
.ypur__list {
  list-style: none;
  margin: 0 0 var(--sp-2);
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.ypur__line {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  background: var(--tile);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: var(--sp-2) var(--sp-3);
  box-shadow: var(--clay-sm);
}
.ypur__line-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 64px;
}
.ypur__line-qty {
  font-weight: 700;
  color: var(--ink);
}
.ypur__line-date {
  font-size: 11.5px;
  color: var(--ink-55);
}
.ypur__line-bain {
  font-size: 11.5px;
  color: var(--ink-55);
}
.ypur__line-tags {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}
.ypur__line-amount {
  font-weight: 600;
  color: var(--ink);
}
.tag {
  font-size: 11px;
  font-weight: 700;
  border-radius: var(--r-pill);
  padding: 2px 9px;
  border: 1px solid var(--line);
  color: var(--ink-55);
}
.ypur__line-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}
.ypur__line-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--ink-55);
}
.ypur__more {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-1);
  min-height: 40px;
  border: 1px dashed var(--line);
  background: transparent;
  color: var(--ink-55);
  font-weight: 600;
  font-size: 13px;
  border-radius: var(--r-md);
  margin-bottom: var(--sp-3);
}
.ypur__totals {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: var(--sp-1);
  margin-top: var(--sp-2);
}
.ypur__stat {
  background: var(--tile);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: var(--sp-3) var(--sp-2);
  text-align: center;
  box-shadow: var(--clay-sm);
}
.ypur__num {
  display: block;
  font-family: var(--font-display);
  font-weight: 600;
  font-size: clamp(13px, 4.2vw, 22px);
  color: var(--brand-deep);
}
.ypur__lbl {
  font-size: 11.5px;
  color: var(--ink-55);
}
.ypur__form {
  margin-top: var(--sp-3);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: var(--sp-3);
}
.ypur__form-title {
  font-family: var(--font-display);
  font-size: 15px;
  margin: 0 0 var(--sp-2);
  color: var(--ink);
}
.ypur__form-actions {
  display: flex;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}
.ypur__form-actions .btn {
  flex: 1;
  min-height: 44px;
}
.seg {
  display: flex;
  gap: var(--sp-2);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--r-pill);
  padding: 4px;
}
.seg__opt {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--ink-55);
  font-weight: 600;
  font-size: 13px;
  padding: 9px;
  border-radius: var(--r-pill);
}
.seg__opt--on {
  background: var(--brand);
  color: var(--on-accent);
}
.mt2 {
  margin-top: var(--sp-2);
}
</style>
