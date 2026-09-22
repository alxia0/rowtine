<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
import BackToTop from '@/components/BackToTop.vue'
import { useYarnsStore } from '@/stores/yarns'
import { useProjectsStore } from '@/stores/projects'
import { yarnUsageState } from '@/utils/yarn-usage'
import { YARN_WEIGHTS, YARN_BRANDS } from '@/constants/catalog'
import { COLOR_PALETTE } from '@/constants/swatch'
import { COMPOSITIONS, normalizeComposition, compositionLabel as compositionLabelOf } from '@/constants/compositions'
import { LABEL_GROUPS } from '@/constants/yarn-labels'
import AppIcon from '@/components/AppIcon.vue'
import YarnFilterDialog from '@/components/YarnFilterDialog.vue'
import YarnSortDialog from '@/components/YarnSortDialog.vue'
import FirstDetailTip from '@/components/FirstDetailTip.vue'
import YarnCard from '@/components/YarnCard.vue'
import {
  matchesQuery, matchesLabel, matchesBrand, matchesWeight, matchesGrams,
  matchesColorFamily, matchesComposition, matchesUsageState, colorFamily, COLOR_CUSTOM, NO_BRAND, sortYarns,
} from '@/utils/yarn-filter'
import { EXAMPLE_YARN } from '@/constants/empty-samples'
import { parseDecimal } from '@/utils/decimal'
import { formatLength, formatWeight, formatMoney } from '@/utils/units'
import { useSettingsStore } from '@/stores/settings'
import { usePurchasesStore } from '@/stores/purchases'

const { t, locale } = useI18n()
const router = useRouter()
const yarnsStore = useYarnsStore()
const projectsStore = useProjectsStore()
const settings = useSettingsStore()
const purchasesStore = usePurchasesStore()

// Statuts des projets liés : nécessaires pour distinguer « réservée » de « utilisée ».
const projectsById = computed(() => Object.fromEntries(projectsStore.projects.map((p) => [p.id, p])))
const usage = (y) => yarnUsageState(y, projectsById.value)

// Libellé lisible d'une couleur de la palette (« rouge » → « Rouge »), utilisé par
// colorFilterOptions ci-dessous (popup Filtrer, critère Couleur).
const colorLabel = (key) => key.charAt(0).toUpperCase() + key.slice(1)

onMounted(() => {
  if (!yarnsStore.loaded) yarnsStore.load()
  if (!projectsStore.loaded) projectsStore.load()
  if (!settings.loaded) settings.load()
})

const search = ref('')
const sortBy = ref('brand') // 'brand' | 'weight' | 'purchasedAt'
// Filtres du stock : une valeur par critère de la popup Filtrer, '' = critère inactif
// (tous les matchers de yarn-filter.js retiennent tout sur '').
const filters = reactive({ brand: '', label: '', weight: '', grams: '', color: '', composition: '', usage: '' })
const filterOpen = ref(false)
const sortOpen = ref(false)
function resetFilters() {
  for (const k of Object.keys(filters)) filters[k] = ''
}
// Nombre de critères actifs : badge du bouton « Filtrer ».
const activeFilterCount = computed(() => Object.values(filters).filter(Boolean).length)

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  let list = yarnsStore.yarns
  if (q) list = list.filter((y) => matchesQuery(y, q, t))
  list = list.filter(
    (y) =>
      matchesBrand(y, filters.brand) &&
      matchesLabel(y, filters.label) &&
      matchesWeight(y, filters.weight) &&
      matchesGrams(y, filters.grams) &&
      matchesColorFamily(y, filters.color) &&
      matchesComposition(y, filters.composition) &&
      matchesUsageState(usage(y).state, filters.usage),
  )
  // `purchasesStore.forYarn` (les travaux sur le budget) : le tri « date d'achat » lit désormais
  // le registre d'achats, plus `yarn.purchasedAt` (retiré du formulaire
  // auparavant) — sinon toute laine créée depuis dégénérait en fin de liste, pour
  // toujours (aucune fiche neuve ne porte plus jamais ce champ).
  return sortYarns(list, sortBy.value, purchasesStore.forYarn)
})

const totalSkeins = computed(() => yarnsStore.yarns.reduce((a, y) => a + (Number(y.quantity) || 0), 0))
const totalMeters = computed(() =>
  yarnsStore.yarns.reduce((a, y) => a + (Number(y.quantity) || 0) * (parseDecimal(y.lengthM) || 0), 0),
)
const totalGrams = computed(() =>
  yarnsStore.yarns.reduce((a, y) => a + (Number(y.quantity) || 0) * (parseDecimal(y.grams) || 0), 0),
)
const totalSpent = computed(() =>
  yarnsStore.yarns.reduce((a, y) => a + (Number(y.quantity) || 0) * (parseDecimal(y.price) || 0), 0),
)

// Totaux mis en forme pour l'en-tête : la valeur et son unité sont calculées ensemble
// (au-delà de 1 000 la tuile passe en km / kg selon le système choisi), cf. src/utils/units.js.
// Profil 'total' partout ici : ce sont des cumuls du stock, la bascule d'unité est autorisée.
const unitOpts = computed(() => ({
  locale: locale.value,
  system: settings.unitSystem,
  profile: 'total',
}))
const lengthStat = computed(() => formatLength(totalMeters.value, unitOpts.value))
const weightStat = computed(() => formatWeight(totalGrams.value, unitOpts.value))
const moneyStat = computed(() =>
  formatMoney(totalSpent.value, { locale: locale.value, currency: settings.currency, profile: 'total' }),
)

// Carte d'exemple de l'écran « stock vide » (EXAMPLE_YARN) : mêmes profils que YarnCard
// (métrage d'UNE pelote = 'detail', poids = CUMUL du lot = 'total') — sinon une
// utilisatrice en impérial verrait « 175 m · 250 g » en arrivant sur son tout premier écran.
const exampleLengthStat = computed(() =>
  formatLength(EXAMPLE_YARN.lengthM, { locale: locale.value, system: settings.unitSystem, profile: 'detail' }),
)
const exampleWeightStat = computed(() =>
  formatWeight(EXAMPLE_YARN.quantity * EXAMPLE_YARN.grams, {
    locale: locale.value,
    system: settings.unitSystem,
    profile: 'total',
  }),
)

// Marques proposées dans le menu déroulant : catalogue ∪ marques déjà saisies dans le stock.
const brandOptions = computed(() => {
  const set = new Set(YARN_BRANDS)
  for (const y of yarnsStore.yarns) if (y.brand && y.brand.trim()) set.add(y.brand.trim())
  return [...set].sort((a, b) => a.localeCompare(b))
})

// Vrai si au moins une laine du stock n'a pas de marque — condition d'affichage de l'option
// « Sans marque » du filtre (inutile de la montrer si le cas n'existe jamais).
const hasUnbrandedYarn = computed(() => yarnsStore.yarns.some((y) => !String(y.brand || '').trim()))

// --- Menus « Filtrer » / « Trier » (popups YarnFilterDialog / YarnSortDialog) ---
//
// ⚠️ brandOptions ci-dessus propose le CATALOGUE COMPLET parce qu'il faut pouvoir SAISIR
// n'importe quoi côté formulaire (YarnEditView.vue). La règle R6 du plan (ne montrer que ce
// qui est RÉELLEMENT PRÉSENT dans le stock — une option sans laine ne rendrait jamais rien et
// ne ferait qu'allonger la liste) ne vaut que pour les trois critères à donnée libre : poids
// de pelote, couleur et composition. Marque cumule catalogue et marques saisies, tandis que
// Caractéristiques liste les groupes complets et Épaisseur l'échelle entière du fil (plus
// bas : règle R6 à l'envers, voulue).

// Poids d'une pelote : valeurs `grams` numériquement exploitables réellement présentes,
// triées par valeur croissante. `value` reste la chaîne du store TELLE QUELLE (jamais de
// renormalisation silencieuse de la donnée) : matchesGrams compare numériquement des deux
// côtés, donc « 50 » et « 50,0 » tombent de toute façon sur le même filtre — le
// dédoublonnage garde la première chaîne rencontrée. Libellé au profil 'detail' de la
// fiche (poids d'UNE pelote, jamais de bascule kg), unité traduite accolée comme sur la
// carte — recalculé au changement de langue ou de système d'unités (locale/settings réactifs).
const gramsFilterOptions = computed(() => {
  const vues = new Map() // valeur numérique → première chaîne rencontrée
  for (const y of yarnsStore.yarns) {
    const g = parseDecimal(y.grams)
    if (Number.isFinite(g) && !vues.has(g)) vues.set(g, String(y.grams))
  }
  return [...vues.entries()].sort((a, b) => a[0] - b[0]).map(([, brut]) => {
    const w = formatWeight(brut, { locale: locale.value, system: settings.unitSystem, profile: 'detail' })
    return { value: brut, label: `${w.text} ${t(w.unitKey)}` }
  })
})

// Couleur : familles de COLOR_PALETTE présentes dans le stock, DANS L'ORDRE de la palette
// (l'ordre du catalogue fait foi, pas celui de découverte) ; « Hors palette » en DERNIER,
// seulement si une pelote porte une couleur personnalisée. Une laine sans couleur du tout
// (colorFamily === '') n'apparaît jamais — elle ne matche de toute façon aucun choix.
const colorFilterOptions = computed(() => {
  const familles = new Set()
  let custom = false
  for (const y of yarnsStore.yarns) {
    const f = colorFamily(y)
    if (f === COLOR_CUSTOM) custom = true
    else if (f) familles.add(f)
  }
  const options = COLOR_PALETTE.filter((c) => familles.has(c.key)).map((c) => ({ value: c.key, label: colorLabel(c.key) }))
  if (custom) options.push({ value: COLOR_CUSTOM, label: t('yarn.colorCustomFamily') })
  return options
})

// Matière : uniquement celles présentes dans le stock (y compris personnalisées) — catalogue
// d'abord, personnalisées triées alphabétiquement ensuite.
const compositionFilterOptions = computed(() => {
  const presentes = new Set()
  for (const y of yarnsStore.yarns) {
    for (const m of normalizeComposition(y.composition)) presentes.add(m)
  }
  const catalogue = COMPOSITIONS.filter((m) => presentes.has(m))
  const custom = [...presentes].filter((m) => !COMPOSITIONS.includes(m)).sort((a, b) => a.localeCompare(b))
  return [...catalogue, ...custom].map((m) => ({ value: m, label: compositionLabelOf(m, t) }))
})

// État : uniquement les états réellement présents dans le stock (même règle R6 que
// poids/couleur/composition), dans un ordre fixe (pas celui de découverte).
const USAGE_STATE_ORDER = ['free', 'reserved', 'usedPartial', 'used']
const usageFilterOptions = computed(() => {
  const presents = new Set(yarnsStore.yarns.map((y) => usage(y).state))
  return USAGE_STATE_ORDER.filter((s) => presents.has(s)).map((s) => ({ value: s, label: t(`yarn.usage.${s}`) }))
})

// Critères de la popup Filtrer : libellés TRADUITS ici, le composant n'a aucune clé i18n
// métier (contrat YarnFilterDialog). L'ordre des critères = ordre d'affichage.
const filterCriteria = computed(() => [
  {
    key: 'brand',
    label: t('yarn.brand'),
    allLabel: t('yarn.brandFilterAll'),
    options: [
      ...brandOptions.value.map((b) => ({ value: b, label: b })),
      ...(hasUnbrandedYarn.value ? [{ value: NO_BRAND, label: t('yarn.brandNone') }] : []),
    ],
  },
  {
    key: 'label',
    // « Label » (retour d'usage, 07/09) : le menu dit Label quand le formulaire de la fiche
    // dit « Caractéristiques » (yarn.labelsTitle) — deux vocabulaires pour la même donnée, voulu.
    label: t('yarn.filterCritLabel'),
    allLabel: t('yarn.filterAll'),
    // Groupes contigus dans l'ordre de LABEL_GROUPS : le composant repère un groupe dès
    // que son libellé change, l'aplatissement doit donc préserver le découpage.
    options: Object.entries(LABEL_GROUPS).flatMap(([groupe, cles]) =>
      cles.map((k) => ({ value: k, label: t(`yarn.labels.${k}`), group: t(`yarn.labelGroups.${groupe}`) })),
    ),
  },
  {
    key: 'weight',
    label: t('yarn.filterCritWeight'),
    allLabel: t('yarn.filterWeightAll'),
    // Catalogue COMPLET (règle R6 à l'envers, voulue) : l'épaisseur est une échelle
    // normalisée du fil — la montrer entière, même si une épaisseur manque au stock,
    // garde l'ordre réel du fil lisible d'une utilisatrice à l'autre.
    options: YARN_WEIGHTS.map((w) => ({ value: w, label: t(`yarn.weights.${w}`) })),
  },
  { key: 'grams', label: t('yarn.filterCritGrams'), allLabel: t('yarn.filterGramsAll'), options: gramsFilterOptions.value },
  { key: 'color', label: t('yarn.filterCritColor'), allLabel: t('yarn.filterColorAll'), options: colorFilterOptions.value },
  {
    key: 'composition',
    label: t('yarn.composition'),
    allLabel: t('yarn.filterCompositionAll'),
    options: compositionFilterOptions.value,
  },
  {
    key: 'usage',
    label: t('yarn.filterCritUsage'),
    allLabel: t('yarn.filterUsageAll'),
    options: usageFilterOptions.value,
  },
])

// Options de la popup Trier (mêmes trois clés que l'ancien select).
const sortOptions = computed(() => [
  { value: 'brand', label: t('yarn.sortBrand') },
  { value: 'weight', label: t('yarn.sortWeight') },
  { value: 'purchasedAt', label: t('yarn.sortPurchased') },
])

</script>

<template>
<div>
  <AppHeader :title="t('nav.stash')" />
  <main class="screen">
    <template v-if="yarnsStore.yarns.length">
      <div class="recap">
        <div class="recap__stat"><span class="recap__num">{{ totalSkeins }}</span><span class="recap__lbl">{{ t('yarn.skeins') }}</span></div>
        <div class="recap__stat"><span class="recap__num">{{ lengthStat.text }}</span><span class="recap__lbl">{{ t(lengthStat.unitKey) }}</span></div>
        <div class="recap__stat"><span class="recap__num">{{ weightStat.text }}</span><span class="recap__lbl">{{ t(weightStat.unitKey) }}</span></div>
        <div v-if="totalSpent > 0" class="recap__stat"><span class="recap__num">{{ moneyStat.text }}</span><span class="recap__lbl">{{ t(moneyStat.unitKey, { symbol: moneyStat.symbol }) }}</span></div>
      </div>

      <input v-model="search" class="input" :aria-label="t('yarn.search')" :placeholder="t('yarn.search')" />

      <div class="toolbar">
        <!-- Le badge est décoratif (aria-hidden) : l'information « N filtres actifs » est
             portée par l'aria-label du bouton, seule lisible en lecteur d'écran. -->
        <button
          class="btn"
          data-test="filter-menu-btn"
          :aria-label="activeFilterCount ? t('yarn.filterActiveCount', { n: activeFilterCount }) : t('yarn.filterLabel')"
          @click="filterOpen = true"
        >{{ t('yarn.filterLabel') }}<span v-if="activeFilterCount" data-test="filter-badge" class="filter-badge" aria-hidden="true">{{ activeFilterCount }}</span></button>
        <button class="btn" data-test="sort-menu-btn" @click="sortOpen = true">{{ t('yarn.menuSort') }}</button>
      </div>
    </template>

    <button class="btn btn--primary btn--block mt" @click="router.push({ name: 'stash-new' })"><AppIcon name="plus" :size="17" /> {{ t('yarn.add') }}</button>

    <template v-if="yarnsStore.yarns.length">
      <div class="ylist">
        <YarnCard
          v-for="y in filtered"
          :key="y.id"
          :yarn="y"
          :usage="usage(y)"
          @view="(yy) => router.push({ name: 'stash-item', params: { id: yy.id } })"
        />
      </div>
      <!-- Recherche/filtre sans résultat sur un stock REMPLI : ce n'est pas « Stock vide »
           (dette audit UX 16/07) — proposer d'effacer recherche + filtres. -->
      <div v-if="!filtered.length" class="nomatch">
        <p class="muted">{{ t('yarn.noMatch') }}</p>
        <button type="button" class="btn" data-test="no-match-clear" @click="search = ''; resetFilters()">{{ t('yarn.clearSearchFilters') }}</button>
      </div>
    </template>
    <div v-else class="empty-wrap">
      <div class="ycard ycard--example" aria-hidden="true">
        <div class="ycard__thumb ycard__thumb--ex" :style="{ background: EXAMPLE_YARN.color }"></div>
        <div class="ycard__view ycard__view--ex">
          <div class="ycard__top">
            <span class="ycard__name">{{ EXAMPLE_YARN.brand }} · {{ EXAMPLE_YARN.model }} · {{ t('yarn.emptyExampleColor') }}</span>
            <span class="ex-badge">{{ t('common.example') }}</span>
          </div>
          <div class="ycard__meta">
            <span>×{{ EXAMPLE_YARN.quantity }} · {{ exampleLengthStat.text }} {{ t(exampleLengthStat.unitKey) }} · {{ exampleWeightStat.text }} {{ t(exampleWeightStat.unitKey) }}</span>
          </div>
        </div>
      </div>
      <p class="empty-hint">{{ t('yarn.emptyExampleHint') }}</p>
    </div>
  </main>
  <!-- Écran à défilement de page (document) : pas de cible, BackToTop se rabat sur
       `document.scrollingElement`/`documentElement` — même câblage que les 4 autres
       écrans longs (biblio, fiche patron, fiche projet, dépenses). -->
  <BackToTop />
  <YarnFilterDialog
    :open="filterOpen"
    :title="t('yarn.filterLabel')"
    :reset-label="t('yarn.filterReset')"
    :criteria="filterCriteria"
    :filters="filters"
    @close="filterOpen = false"
    @set-filter="(k, v) => (filters[k] = v)"
    @reset="resetFilters"
  />
  <YarnSortDialog :open="sortOpen" :title="t('yarn.menuSort')" :model-value="sortBy" :options="sortOptions" @close="sortOpen = false" @update:model-value="sortBy = $event" />
  <!-- Astuce de navigation (décision produit du 19/08/2026, mot pour mot :
       « … qu'on va dans le stock de laine, elle n'a rien à voir avec l'étape d'import d'un
       patron »). Posée dès la visite de l'écran Stock lui-même, plus seulement à
       l'ouverture de la fiche d'une pelote. La laine a désormais son propre écran (route
       stash-item, cf. YarnDetailView.vue) — mais l'astuce enseigne D'ABORD le balayage
       arrière, un geste utile dès qu'on est entré dans le Stock, pelote ouverte ou non — la
       partie de son texte sur la bande d'onglets qui déborde, elle, ne vise que le projet et
       la bibliothèque (cf. FirstDetailTip.vue). -->
  <FirstDetailTip />
</div>
</template>

<style scoped>
/* `grid-auto-columns: 1fr` a un `min-width: auto` implicite : la piste REFUSE de devenir
   plus étroite que son contenu, et la grille entière débordait de l'écran dès qu'un total
   passait à 5 chiffres. `minmax(0, 1fr)` autorise la compression — c'est la cause racine du
   dépassement signalé en usage le 25/07, indépendante du format des nombres. */
/* gap et padding horizontal resserrés (var(--sp-1) / var(--sp-2)) : marge de largeur
   récupérée pour les nombres à 7 caractères (ex. "124,747" km) sans toucher à la hauteur
   des tuiles ni à la police — mesuré à 360px, cf. tests/e2e/stash-recap-overflow.spec.js. */
.recap { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: var(--sp-1); margin-bottom: var(--sp-3); }
.recap__stat { background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--sp-3) var(--sp-2); text-align: center; box-shadow: var(--clay-sm); }
/* Mesuré à 360px : 25px de débordement à 22px fixes, « 49,203 » passait sous la tuile
   voisine (cf. captures 25/07). `clamp()` réduit juste ce qu'il faut sur écran étroit ;
   la borne haute (22px) préserve la taille d'origine dès que l'écran s'élargit. */
.recap__num { display: block; font-family: var(--font-display); font-weight: 600; font-size: clamp(13px, 4.2vw, 22px); color: var(--brand-deep); }
.recap__lbl { font-size: 11.5px; color: var(--ink-55); }
.toolbar { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: var(--sp-2); margin: var(--sp-3) 0; }
/* Pastille du badge « N filtres actifs » sur le bouton Filtrer : purement décorative
   (aria-hidden au template), la même information passe par l'aria-label du bouton. */
.filter-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: var(--r-pill); background: var(--brand); color: var(--on-accent); font-size: 11.5px; font-weight: 700; }
.mt { margin-top: var(--sp-2); }
.ylist { display: flex; flex-direction: column; gap: var(--sp-2); margin-top: var(--sp-4); }
.ycard { display: flex; align-items: center; gap: var(--sp-3); background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--sp-3); box-shadow: var(--clay-sm); }
.ycard__thumb { width: 46px; height: 46px; }
.ycard__view { flex: 1; min-width: 0; border: none; background: transparent; text-align: left; padding: 0; cursor: pointer; }
.ycard__view:focus-visible { outline: 2px solid var(--brand-deep); outline-offset: 2px; border-radius: var(--r-sm); }
.ycard__top { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); }
.ycard__name { font-weight: 600; color: var(--ink); }
.ycard__meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); margin-top: var(--sp-2); color: var(--ink-55); font-size: 13px; }
.muted { color: var(--ink-55); margin-top: var(--sp-4); }
.nomatch { margin-top: var(--sp-2); display: flex; flex-direction: column; align-items: flex-start; gap: var(--sp-2); }
.nomatch .muted { margin-top: 0; }
.empty-wrap { margin-top: var(--sp-4); }
/* Pas d'opacity globale : elle composite le texte muté (--ink-55) sous le seuil AA
   de contraste (axe color-contrast). L'affordance « exemple » passe par le badge +
   la bordure pointillée + l'accroche dessous, pas par une atténuation. */
.ycard--example { pointer-events: none; }
.ycard__thumb--ex { width: 46px; height: 46px; border-radius: var(--r-sm); border: 1px solid var(--line); }
.ycard__view--ex { flex: 1; min-width: 0; }
.ex-badge { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: var(--ink-55); border: 1px dashed var(--line); border-radius: var(--r-pill); padding: 1px 8px; }
.empty-hint { color: var(--ink-55); font-size: 14px; text-align: center; max-width: 34ch; margin: var(--sp-3) auto 0; }
</style>
