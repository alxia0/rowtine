<script setup>
// Écran Dépenses (dans le cadre des travaux sur le budget laine cumulé). SEUL endroit de l'app où
// une ligne d'achat ORPHELINE (laine supprimée définitivement, `yarnId: null`,
// cf. usePurchasesStore().orphanYarn) reste visible ET supprimable : ces lignes
// n'ont plus aucune fiche où s'accrocher, et le libellé figé (`yarnLabel`) est la
// seule façon de les reconnaître. Le store `purchases` est déjà chargé au
// démarrage de l'app (App.vue) — mais correctif final (revue) : cet
// écran garde désormais son PROPRE filet (`if (!loaded) load()`, même motif que
// HomeView.vue), car toute exception AVANT la reprise du budget dans la chaîne
// `onMounted` d'App.vue laisserait sinon ce store définitivement vide pour la
// session, sans aucun autre endroit pour le recharger.
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
import AppIcon from '@/components/AppIcon.vue'
import EmptyStateArt from '@/components/EmptyStateArt.vue'
import BackToTop from '@/components/BackToTop.vue'
import { usePurchasesStore } from '@/stores/purchases'
import { useYarnsStore } from '@/stores/yarns'
import { usePatternsStore } from '@/stores/patterns'
import { useSnackbarStore } from '@/stores/snackbar'
import { formatMoney } from '@/utils/units'
import {
  groupByPeriod, lineAmount, totalsByCurrency, isPriceUnknown, yearsOf, filterByYear,
  categoryOf, filterByCategory, totalsByCategory,
} from '@/utils/purchases'
import { patternExpenseLines } from '@/utils/pattern-price'

const { t, locale } = useI18n()
const router = useRouter()
const purchasesStore = usePurchasesStore()
const yarnsStore = useYarnsStore()
const patternsStore = usePatternsStore()
const snackbar = useSnackbarStore()

onMounted(() => {
  if (!purchasesStore.loaded) purchasesStore.load()
  // Nécessaire à `lineLabel` ci-dessous (résolution du libellé VIVANT) — sans ce
  // chargement, la résolution retomberait systématiquement sur le libellé figé, y
  // compris pour une laine encore bien vivante et renommée depuis l'achat.
  if (!yarnsStore.loaded) yarnsStore.load()
  // Les patrons payants sont une SOURCE de dépenses au même titre que le registre d'achats
  // (depuis le 07/08). Même filet que ci-dessus : une exception avant la reprise dans App.vue
  // laisserait sinon ce magasin vide pour toute la session, sans autre endroit où le recharger.
  if (!patternsStore.loaded) patternsStore.load()
})

// Les deux sources de dépense. Les lignes de PATRON sont FABRIQUÉES à la lecture (jamais
// écrites en base, cf. src/utils/pattern-price.js) et ont exactement la même forme qu'une
// ligne d'achat : tout le calcul ci-dessous — regroupement par année/mois, totaux par devise,
// filtre d'année — fonctionne sur la liste fusionnée sans une ligne de code de plus.
const lines = computed(() => [
  ...(purchasesStore.purchases || []),
  ...patternExpenseLines(patternsStore.patterns || []),
])
const yarnsById = computed(() => Object.fromEntries(yarnsStore.yarns.map((y) => [y.id, y])))
// Libellé d'une ligne : `yarnLabel` n'est écrit qu'à la création de la ligne et par la
// reprise (src/db/purchases-reprise.js) — il ne suit donc JAMAIS un renommage ultérieur
// de la fiche (marque, modèle, coloris). Correctif final (revue) : on résout
// depuis la fiche VIVANTE quand elle existe encore, avec repli sur le libellé FIGÉ quand
// elle a disparu (laine supprimée définitivement — seul cas où `yarnLabel` reste la seule
// source). Même format que `purchaseLabel` (StashView.vue) et `labelOf`
// (purchases-reprise.js) — dupliqué ici à dessein, comme ces deux-là le sont déjà entre
// eux : les trois modules n'ont aucune autre raison de se connaître.
function lineLabel(line) {
  // Une dépense de patron porte son propre libellé : `yarnId`/`yarnLabel` disent « laine » et
  // n'ont aucun sens ici.
  if (categoryOf(line) === 'pattern') return line.label
  if (line.yarnId == null) return line.yarnLabel
  const yarn = yarnsById.value[line.yarnId]
  if (!yarn) return line.yarnLabel
  const live = [yarn.brand, yarn.model, yarn.colorName].map((s) => String(s || '').trim()).filter(Boolean).join(' · ')
  return live || line.yarnLabel // fiche retrouvée mais aux 3 champs vides : le figé reste plus lisible que du vide
}
// Filtre par année (retour d'usage, 01/08) : 'all' (défaut, comportement
// historique), une année 'AAAA', ou 'unknown' pour les lignes sans date — sans ce
// 3e choix, ces lignes deviendraient inatteignables dès qu'un filtre est actif
// (cf. règle « jamais perdre d'info »). `filterByYear`/`yearsOf` sont PURES
// (src/utils/purchases.js), même découpage daté/non-daté que `groupByPeriod`.
const selectedYear = ref('all')
// `lines` et NON `filteredLines` (depuis le 07/08) : le menu Année doit proposer TOUTES les années,
// quelle que soit la catégorie choisie dans le menu Type — sinon choisir « Patrons » ferait
// disparaître du menu les années qui n'ont que de la laine, et l'utilisatrice se retrouverait
// coincée sur une liste vide sans explication (cf. tests P11/P11b). Accessoirement : `filteredLines`
// est déclaré plus bas dans ce fichier — le faire lire ici lèverait une erreur d'initialisation
// (le `watch` juste en dessous évalue `availableYears` dès sa création), ce qui rendrait la faute
// impossible à manquer si jamais quelqu'un l'introduit par erreur.
const availableYears = computed(() => yearsOf(lines.value))
const hasUndated = computed(() => lines.value.some((l) => !String(l?.date || '').trim()))
// Ensemble des valeurs sélectionnables à cet instant — sert de garde ci-dessous
// : sans elle, supprimer la dernière ligne d'une année (ou la dernière ligne
// sans date) pendant que ce choix est actif laisserait `selectedYear` pointer
// vers une option qui a disparu du menu, et l'écran resterait bloqué sur une
// liste vide sans qu'aucun choix visible ne l'explique.
const validYearValues = computed(
  () => new Set(['all', ...availableYears.value, ...(hasUndated.value ? ['unknown'] : [])])
)
watch([availableYears, hasUndated], () => {
  if (!validYearValues.value.has(selectedYear.value)) selectedYear.value = 'all'
})
// Filtre de catégorie (depuis le 07/08) : 'all' (défaut), 'yarn', 'pattern'. Visible dès qu'il y a
// du contenu, MÊME si une seule catégorie est peuplée — même arbitrage que le menu Année
// (voir le commentaire du template) : voir la commande vaut mieux que se demander où elle est,
// et ici elle annonce en plus une fonctionnalité qu'on ne devinerait pas.
const selectedCategory = ref('all')
// Ordre figé : catégorie PUIS année. Les deux sont des filtres purs, l'ordre est sans effet
// sur le résultat — on le fixe pour que le code ne dise qu'une seule chose.
const filteredLines = computed(() => filterByYear(filterByCategory(lines.value, selectedCategory.value), selectedYear.value))
// Mention de la période sous le total (décision produit : le grand total suit
// le filtre) — réutilise `expenses.unknownDate` pour le choix « sans date »,
// déjà affiché comme en-tête de ce groupe plus bas, plutôt que de dupliquer une
// clé qui dirait la même chose.
const periodLabel = computed(() => {
  if (selectedYear.value === 'unknown') return t('expenses.unknownDate')
  if (selectedYear.value === 'all' || !availableYears.value.includes(selectedYear.value)) return t('expenses.periodAll')
  return t('expenses.periodYear', { year: selectedYear.value })
})
// Total général : sur TOUTES les lignes du filtre courant, orphelines et sans
// date comprises — pas seulement celles que `groupByPeriod` sait ranger dans une
// période. Deux devises ne s'additionnent jamais (l'app ne connaît aucun taux de
// change) : c'est un objet {devise: montant}, jamais un nombre unique.
const totals = computed(() => totalsByCurrency(filteredLines.value))
const totalCurrencies = computed(() => Object.keys(totals.value))
const groups = computed(() => groupByPeriod(filteredLines.value))

function moneyStat(currency) {
  return formatMoney(totals.value[currency], { locale: locale.value, currency, profile: 'total' })
}
function groupTotalText(currency, amount) {
  return formatMoney(amount, { locale: locale.value, currency, profile: 'detail' }).text
}
function lineAmountText(line) {
  return formatMoney(lineAmount(line), { locale: locale.value, currency: line.currency, profile: 'detail' }).text
}
// Libellé de mois, SANS l'année (déjà portée par l'en-tête du groupe d'année) —
// vide pour le groupe « date inconnue » (un seul sous-groupe, `month: ''`), qui
// n'affiche donc pas de sous-titre redondant avec son propre en-tête.
function monthLabel(month) {
  if (!month) return ''
  return new Date(`${month}-01T00:00:00`).toLocaleDateString(locale.value, { month: 'long' })
}

// Verrou anti double-appui (même motif que YarnPurchases.vue et
// StashView.vue `saving`/`resolvingPurchase`) : sans lui, un double-tap enchaînerait deux
// suppressions Dexie concurrentes — la seconde (get + delete sur une ligne déjà partie)
// renvoie `undefined`, qu'un « Annuler » ultérieur écrirait tel quel en base (exception),
// en plus d'afficher deux bandeaux. Par id de ligne, pas un verrou global.
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

// Ventilation par catégorie. N'apparaît QUE s'il existe au moins une ligne de patron dans
// l'ensemble filtré : l'écran de quelqu'un qui n'a jamais saisi de prix de patron reste
// STRICTEMENT identique à ce qu'il était. Pas de changement cosmétique imposé à qui ne se
// sert pas de la fonctionnalité.
const categoryTotals = computed(() => totalsByCategory(filteredLines.value))
const hasPatternLines = computed(() => filteredLines.value.some((l) => categoryOf(l) === 'pattern'))
function categoryTotalText(cat, currency) {
  return formatMoney(categoryTotals.value[cat][currency] || 0, { locale: locale.value, currency, profile: 'detail' }).text
}

const isPattern = (line) => categoryOf(line) === 'pattern'

// Un appui sur une dépense de patron ouvre sa fiche : c'est là qu'on modifie ou efface le prix.
// La route est nommée `pattern` (cf. src/router/index.js) — vérifier ce nom avant d'écrire,
// une route inexistante échoue silencieusement en navigation.
function openPattern(line) {
  router.push({ name: 'pattern', params: { id: line.patternId } })
}
</script>

<template>
<div>
  <AppHeader :title="t('expenses.title')" back />
  <main class="screen">
    <template v-if="lines.length">
      <!-- Sélecteur visible dès qu'il y a du contenu (retour d'usage, 01/08 : « je ne vois
           pas le menu Année sur l'écran Dépenses ») — donc pas de v-if propre à ce bloc : la
           condition « il y a du contenu » est déjà celle du <template> englobant. La version
           précédente exigeait au moins DEUX états utiles (deux années, ou une année plus
           « Date inconnue ») — logique, mais trompeuse en pratique : sur une base où les
           lignes reconstruites reprennent la date d'achat des fiches, une fiche sans date
           rend TOUS ses achats « sans date » -> un seul état, donc aucun sélecteur, sans
           qu'aucune explication n'apparaisse à l'écran pour une fonctionnalité qu'on lui a
           pourtant annoncée. Choisir la seule période disponible ne change alors rien au
           résultat affiché, et c'est sans importance : voir la commande vaut mieux que se
           demander où elle est. -->
      <div class="exp__filter">
        <label class="sort">
          <span class="sort__lbl">{{ t('expenses.yearFilterLabel') }}</span>
          <select v-model="selectedYear" class="input sort__sel" data-test="expenses-year-select">
            <option value="all">{{ t('expenses.yearFilterAll') }}</option>
            <option v-for="year in availableYears" :key="year" :value="year">{{ year }}</option>
            <option v-if="hasUndated" value="unknown">{{ t('expenses.unknownDate') }}</option>
          </select>
        </label>
        <label class="sort">
          <span class="sort__lbl">{{ t('expenses.categoryFilterLabel') }}</span>
          <select v-model="selectedCategory" class="input sort__sel" data-test="expenses-category-select">
            <option value="all">{{ t('expenses.categoryAll') }}</option>
            <option value="yarn">{{ t('expenses.categoryYarn') }}</option>
            <option value="pattern">{{ t('expenses.categoryPattern') }}</option>
          </select>
        </label>
      </div>

      <div v-if="totalCurrencies.length" class="exp__totals" data-test="expenses-totals">
        <div v-for="cur in totalCurrencies" :key="cur" class="exp__stat">
          <span class="exp__stat-num">{{ moneyStat(cur).text }}</span>
          <span class="exp__stat-lbl">{{ t(moneyStat(cur).unitKey, { symbol: moneyStat(cur).symbol }) }}</span>
          <!-- Ventilation seulement s'il y a des patrons : sinon l'écran reste celui d'avant. -->
          <span v-if="hasPatternLines" class="exp__breakdown" data-test="expenses-breakdown">
            <span class="exp__breakdown-row">
              <span>{{ t('expenses.categoryYarn') }}</span>
              <span>{{ categoryTotalText('yarn', cur) }}</span>
            </span>
            <span class="exp__breakdown-row">
              <span>{{ t('expenses.categoryPattern') }}</span>
              <span>{{ categoryTotalText('pattern', cur) }}</span>
            </span>
          </span>
        </div>
      </div>
      <!-- Frère du bloc des totaux, PAS dedans : une année ne contenant que des
           cadeaux/prix inconnus (totalsByCurrency ignore les montants nuls) ferait
           disparaître cette mention en même temps que la carte de totaux si elle
           y était imbriquée — alors que la liste plus bas resterait, elle, bien
           filtrée. `role="status"` : sans lui, changer d'année ne dit rien à un
           lecteur d'écran (même motif que l'écart de jauge, le bandeau de message
           et la progression d'import). -->
      <p class="exp__period" data-test="expenses-period" role="status">{{ periodLabel }}</p>

      <section v-for="group in groups" :key="group.year || 'unknown'" class="exp__year">
        <h2 class="exp__year-title">
          <span class="exp__year-label">{{ group.year || t('expenses.unknownDate') }}</span>
          <span v-for="cur in Object.keys(group.total)" :key="cur" class="exp__year-total">
            {{ groupTotalText(cur, group.total[cur]) }}
          </span>
        </h2>

        <div v-for="m in group.months" :key="m.month || 'unknown'" class="exp__month">
          <div v-if="m.month" class="exp__month-header">
            <h3 class="exp__month-title">{{ monthLabel(m.month) }}</h3>
            <span v-for="cur in Object.keys(m.total)" :key="cur" class="exp__month-total">
              {{ groupTotalText(cur, m.total[cur]) }}
            </span>
          </div>
          <ul class="exp__list">
            <li v-for="line in m.lines" :key="line.id" class="exp__line" :data-test="`expenses-line-${line.id}`">
              <div class="exp__line-main">
                <!-- Pas de quantité sur un patron : « ×1 » n'y veut rien dire. -->
                <span v-if="!isPattern(line)" class="exp__line-qty">×{{ line.quantity }}</span>
                <span class="exp__line-label">{{ lineLabel(line) }}</span>
                <!-- La garde de CATÉGORIE fait tout le travail : la ligne de patron n'a pas de
                     `yarnId`, mais `undefined == null` est VRAI en JavaScript — sans elle,
                     chaque patron porterait la mention « Laine supprimée ». -->
                <span v-if="!isPattern(line) && line.yarnId == null" class="tag exp__orphan-tag">{{ t('expenses.orphanTag') }}</span>
              </div>
              <div class="exp__line-tags">
                <!-- Même garde que la ventilation (`hasPatternLines`) : tant qu'il n'existe
                     aucune ligne de patron, la catégorie est une évidence (100 % laine) et
                     l'étiquette n'apprend rien — juste du bruit visuel sur chaque ligne d'une
                     utilisatrice qui ne se sert pas de la fonctionnalité. Elle n'apparaît qu'à
                     partir du moment où deux catégories coexistent réellement dans l'écran. -->
                <span v-if="hasPatternLines" class="tag">{{ isPattern(line) ? t('expenses.tagPattern') : t('expenses.tagYarn') }}</span>
                <span v-if="line.kind === 'gift'" class="tag">{{ t('purchases.kindGift') }}</span>
                <span v-else-if="isPattern(line) && !lineAmount(line)" class="tag">{{ t('expenses.freeTag') }}</span>
                <span v-else-if="isPriceUnknown(line)" class="tag">{{ t('purchases.priceUnknown') }}</span>
                <span v-else class="exp__line-amount">{{ lineAmountText(line) }}</span>
              </div>
              <!-- Une dépense de patron n'est pas une LIGNE d'historique : il n'y a rien à
                   supprimer, seulement un champ à vider sur la fiche du patron. Une croix qui
                   viderait ce champ sans le dire serait un geste destructeur déguisé. -->
              <button
                v-if="!isPattern(line)"
                type="button"
                class="exp__line-delete"
                :data-test="`expenses-delete-${line.id}`"
                :aria-label="t('common.delete')"
                :disabled="removingIds.has(line.id)"
                @click="removeLine(line)"
              >
                <AppIcon name="close" :size="16" />
              </button>
              <button
                v-else
                type="button"
                class="exp__line-open"
                :data-test="`expenses-open-${line.id}`"
                :aria-label="t('expenses.tagPattern')"
                @click="openPattern(line)"
              >
                <AppIcon name="chevronRight" :size="16" />
              </button>
            </li>
          </ul>
        </div>
      </section>
    </template>

    <EmptyStateArt v-else :size="120">
      {{ t('expenses.empty') }}
      <template #hint>{{ t('expenses.emptyHint') }}</template>
    </EmptyStateArt>
  </main>
  <!-- Écran à défilement de page (document) : pas de cible, même câblage que les 4 autres
       écrans longs (stock, biblio, fiche patron, fiche projet). -->
  <BackToTop />
</div>
</template>

<style scoped>
.exp__filter {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-3);
  margin-bottom: var(--sp-3);
}
.sort {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sort__lbl {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ink-55);
}
.sort__sel {
  font-family: var(--font-ui);
  max-width: 200px;
}
.exp__totals {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: var(--sp-2);
  margin-bottom: var(--sp-2);
}
.exp__period {
  text-align: center;
  font-size: 12px;
  color: var(--ink-55);
  margin: 0 0 var(--sp-4);
}
.exp__stat {
  background: var(--tile);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: var(--sp-3) var(--sp-2);
  text-align: center;
  box-shadow: var(--clay-sm);
}
.exp__stat-num {
  display: block;
  font-family: var(--font-display);
  font-weight: 600;
  font-size: clamp(18px, 6vw, 28px);
  color: var(--brand-deep);
}
.exp__stat-lbl {
  font-size: 11.5px;
  color: var(--ink-55);
}
.exp__breakdown {
  display: block;
  margin-top: var(--sp-2);
  padding-top: var(--sp-2);
  border-top: 1px solid var(--line);
}
.exp__breakdown-row {
  display: flex;
  justify-content: space-between;
  gap: var(--sp-2);
  font-size: 11.5px;
  color: var(--ink-55);
}
.exp__year {
  margin-bottom: var(--sp-5);
}
.exp__year-title {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--sp-2);
  font-family: var(--font-display);
  font-size: 19px;
  color: var(--ink);
  margin: 0 0 var(--sp-3);
}
.exp__year-label {
  flex: 1;
}
.exp__year-total {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink-55);
}
.exp__month {
  margin-bottom: var(--sp-3);
}
.exp__month-header {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin: 0 0 var(--sp-2);
}
.exp__month-title {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-55);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin: 0;
}
.exp__month-title::first-letter {
  text-transform: uppercase;
}
.exp__month-total {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-55);
}
.exp__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.exp__line {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  background: var(--tile);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: var(--sp-2) var(--sp-3);
  box-shadow: var(--clay-sm);
}
.exp__line-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex-wrap: wrap;
}
.exp__line-qty {
  font-weight: 700;
  color: var(--ink);
  flex-shrink: 0;
}
.exp__line-label {
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.exp__line-tags {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.exp__line-amount {
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
.exp__orphan-tag {
  color: var(--warning);
  border-color: var(--warning);
}
.exp__line-delete, .exp__line-open {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--ink-55);
}
</style>
