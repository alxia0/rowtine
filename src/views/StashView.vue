<script setup>
import { ref, reactive, computed, onMounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import AppHeader from '@/components/AppHeader.vue'
import BackToTop from '@/components/BackToTop.vue'
import { useYarnsStore, emptyYarn } from '@/stores/yarns'
import { useProjectsStore } from '@/stores/projects'
import { yarnUsageState, reservedTotal } from '@/utils/yarn-usage'
import { useSnackbarStore } from '@/stores/snackbar'
import { useSoftDelete } from '@/composables/useSoftDelete'
import { YARN_WEIGHTS, YARN_BRANDS, YARN_COLOR_TYPES } from '@/constants/catalog'
import { COLOR_PALETTE, isCustomColor } from '@/constants/swatch'
import { COMPOSITIONS, normalizeComposition, compositionLabel as compositionLabelOf } from '@/constants/compositions'
import { LABEL_GROUPS, normalizeLabels } from '@/constants/yarn-labels'
import { animalFibersIn } from '@/constants/fiber-origin'
import { pickAndCropImage } from '@/utils/photo'
import { useCropperStore } from '@/stores/cropper'
import AppIcon from '@/components/AppIcon.vue'
import YarnWeightHelp from '@/components/YarnWeightHelp.vue'
import YarnFilterDialog from '@/components/YarnFilterDialog.vue'
import YarnSortDialog from '@/components/YarnSortDialog.vue'
import ColorPickerDialog from '@/components/ColorPickerDialog.vue'
import YarnDetailDialog from '@/components/YarnDetailDialog.vue'
import FirstDetailTip from '@/components/FirstDetailTip.vue'
import YarnCard from '@/components/YarnCard.vue'
import YarnPurchases from '@/components/YarnPurchases.vue'
import { useColorPickerStore } from '@/stores/color-picker'
import { ymdLocal } from '@/utils/time-periods'
// Le champ de prix n'accepte que des chiffres et un séparateur : un prix tapé « 18,90 € »
// donnait NaN, donc 0, donc « Gratuit ».
import { filtrerSaisieDecimale } from '@/utils/decimal'
import {
  matchesQuery, matchesLabel, matchesBrand, matchesWeight, matchesGrams,
  matchesColorFamily, matchesComposition, colorFamily, COLOR_CUSTOM, NO_BRAND, sortYarns,
} from '@/utils/yarn-filter'
import { EXAMPLE_YARN } from '@/constants/empty-samples'
import { parseDecimal } from '@/utils/decimal'
import { formatLength, formatWeight, formatMoney, toInput, fromInput, currencySymbol } from '@/utils/units'
import { useSettingsStore } from '@/stores/settings'
import { usePurchasesStore } from '@/stores/purchases'

const { t, locale } = useI18n()
const yarnsStore = useYarnsStore()
const projectsStore = useProjectsStore()
const snackbar = useSnackbarStore()
const softDelete = useSoftDelete()
const cropper = useCropperStore()
const colorPicker = useColorPickerStore()
const settings = useSettingsStore()
const purchasesStore = usePurchasesStore()

// Statuts des projets liés : nécessaires pour distinguer « réservée » de « utilisée ».
const projectsById = computed(() => Object.fromEntries(projectsStore.projects.map((p) => [p.id, p])))
const usage = (y) => yarnUsageState(y, projectsById.value)

// Libellé lisible d'une couleur de la palette (« rouge » → « Rouge »).
const colorLabel = (key) => key.charAt(0).toUpperCase() + key.slice(1)
// Choisir une pastille : renseigne la couleur ET remplit le nom automatiquement.
function pickColor(c) {
  const label = colorLabel(c.key)
  if (form.color === c.hsl) {
    form.color = ''
    if (form.colorName === label) form.colorName = '' // n'efface que le nom auto-rempli
  } else {
    form.color = c.hsl
    form.colorName = label
  }
}
// Couleur personnalisée (hors palette) : l'utilisateur ouvre le pop-up « au doigt »
// (ColorPickerDialog) ; on stocke la teinte en hsl (format palette). Contrairement à une
// pastille, le nom n'est PAS auto-rempli (aucun nom dérivable) : l'utilisateur le saisit
// lui-même.
const isCustom = computed(() => isCustomColor(form.color))
// Le pop-up renvoie déjà une chaîne hsl. Comme pickColor, on n'efface que le nom
// auto-rempli par une pastille (sinon on écraserait un nom déjà tapé). La fermeture du
// pop-up (colorPicker.open = false) n'est pas nécessaire ici : `confirm()` du dialogue
// émet déjà `close`, géré par le handler du template (cf. la deuxième passe de revue).
function onPickCustom(hsl) {
  if (!hsl) return
  const prevPalette = COLOR_PALETTE.find((c) => c.hsl === form.color)
  if (prevPalette && form.colorName === colorLabel(prevPalette.key)) form.colorName = ''
  form.color = hsl
}
// Prise de photo de la pelote (même mécanisme que les projets : appareil/galerie + recadrage).
async function addPhoto() {
  const dataUrl = await pickAndCropImage(cropper.crop)
  if (dataUrl) form.photo = dataUrl
}
function removePhoto() {
  form.photo = ''
}

onMounted(() => {
  if (!yarnsStore.loaded) yarnsStore.load()
  if (!projectsStore.loaded) projectsStore.load()
  if (!settings.loaded) settings.load()
})

const search = ref('')
const sortBy = ref('brand') // 'brand' | 'weight' | 'purchasedAt'
const grid = ref(false)
// Filtres du stock : une valeur par critère de la popup Filtrer, '' = critère inactif
// (tous les matchers de yarn-filter.js retiennent tout sur '').
const filters = reactive({ brand: '', label: '', weight: '', grams: '', color: '', composition: '' })
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
      matchesComposition(y, filters.composition),
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

// Matériaux proposés : les 11 connus ∪ les matériaux personnalisés déjà saisis dans le
// stock (même principe que brandOptions ci-dessus).
const compositionOptions = computed(() => {
  const custom = new Set()
  for (const y of yarnsStore.yarns) {
    for (const m of normalizeComposition(y.composition)) {
      if (!COMPOSITIONS.includes(m)) custom.add(m)
    }
  }
  return [...COMPOSITIONS, ...[...custom].sort((a, b) => a.localeCompare(b))]
})

// --- Menus « Filtrer » / « Trier » (popups YarnFilterDialog / YarnSortDialog) ---
//
// ⚠️ Principe inverse du formulaire : brandOptions/compositionOptions ci-dessus proposent
// les CATALOGUES COMPLETS parce qu'il faut pouvoir SAISIR n'importe quoi. La règle R6 du
// plan (ne montrer que ce qui est RÉELLEMENT PRÉSENT dans le stock — une option sans
// laine ne rendrait jamais rien et ne ferait qu'allonger la liste) ne vaut que pour les
// trois critères à donnée libre : poids de pelote, couleur et composition. Marque cumule
// catalogue et marques saisies, tandis que Caractéristiques liste les groupes complets
// et Épaisseur l'échelle entière du fil (plus bas : règle R6 à l'envers, voulue).

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

// Matière : uniquement celles présentes dans le stock (y compris personnalisées), même
// ordre que compositionOptions du formulaire restreint au présent — catalogue d'abord,
// personnalisées triées alphabétiquement ensuite.
const compositionFilterOptions = computed(() => {
  const presentes = new Set()
  for (const y of yarnsStore.yarns) {
    for (const m of normalizeComposition(y.composition)) presentes.add(m)
  }
  const catalogue = COMPOSITIONS.filter((m) => presentes.has(m))
  const custom = [...presentes].filter((m) => !COMPOSITIONS.includes(m)).sort((a, b) => a.localeCompare(b))
  return [...catalogue, ...custom].map((m) => ({ value: m, label: compositionLabel(m) }))
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
])

// Options de la popup Trier (mêmes trois clés que l'ancien select).
const sortOptions = computed(() => [
  { value: 'brand', label: t('yarn.sortBrand') },
  { value: 'weight', label: t('yarn.sortWeight') },
  { value: 'purchasedAt', label: t('yarn.sortPurchased') },
])

// --- Ajout / édition d'une laine ---
const formOpen = ref(false)
const brandField = ref(null)
const weightHelpOpen = ref(false)
const editId = ref(null)
const form = reactive(emptyYarn())
const customBrand = ref(false) // « Autre… » : saisie libre de la marque
const compositionOtherOpen = ref(false) // chip « Autre » : révèle la saisie libre
const compositionOtherText = ref('')

// Fiche actuellement éditée (telle que connue du store), pour le bloc « Achats et
// cadeaux » (<YarnPurchases>) : n'existe qu'en ÉDITION, jamais en création/
// duplication (aucun id tant que la fiche n'a pas été enregistrée une première fois).
const editingYarn = computed(() => (editId.value ? yarnsStore.yarns.find((y) => y.id === editId.value) : null))
// Libellé figé d'une ligne d'achat : même format que la reprise de l'existant
// (src/db/purchases-reprise.js, non exporté) — marque/modèle/coloris, segments vides
// omis. Dupliqué en dur ici plutôt qu'importé : les deux modules n'ont aucune autre
// raison de se connaître, et le format est trivial à garder aligné.
function purchaseLabel(y) {
  return [y?.brand, y?.model, y?.colorName].map((s) => String(s || '').trim()).filter(Boolean).join(' · ')
}
// Le jour LOCAL, jamais `toISOString()` : celui-ci rend la date UTC, donc la veille entre
// minuit local et minuit UTC.
// La date d'achat proposée ici et celle du côté patrons pouvaient ainsi différer d'un jour dans
// la même session. `ymdLocal` est la seule façon correcte du projet — cf. son commentaire dans
// utils/time-periods.js. Le nom reste : 'AAAA-MM-JJ' est bien un format ISO, seul le FUSEAU
// change. Gardé comme délégué d'une ligne plutôt qu'inliné sur 5 sites d'appel, pour qu'il ne
// puisse pas rediverger.
function todayISO() {
  return ymdLocal(new Date())
}
// Le champ de prix n'accepte que des chiffres et un séparateur. La valeur filtrée est RÉÉCRITE
// dans le champ : quand le caractère refusé ne change
// pas la valeur — le geste réel, taper « € » après « 18,90 » — `:value` seul ne suffit pas, Vue
// ne repasse pas et le symbole resterait à l'écran alors que la donnée, elle, est propre.
function onPrixLaine(event) {
  const propre = filtrerSaisieDecimale(event.target.value)
  event.target.value = propre
  form.price = propre
}
// Date d'achat / bain de la 1re ligne d'achat, saisis DANS le formulaire à la CRÉATION
// (retour d'usage, 01/08 : « il n'y a plus la date d'achat ni le num de bain sur la
// fiche de création de laine ») — pas des champs de `form`/`emptyYarn()` : ces deux-là
// restent la propriété de la LIGNE d'achat (cf. src/stores/purchases.js), jamais de la
// fiche laine elle-même ; les mélanger réintroduirait la confusion que les travaux sur le
// budget laine venaient de trancher (un bain appartient à un lot acheté, pas à une laine). Rendus
// UNIQUEMENT en création (v-if="!editId" au template) : en édition, le bloc « Achats et
// cadeaux » (<YarnPurchases>) gère déjà les lignes une à une — les faire cohabiter
// créerait deux endroits contradictoires pour la même information.
const firstPurchaseDate = ref(todayISO())
const firstPurchaseBain = ref('')
// `Number(form.quantity) || 1` confondait DEUX cas distincts : un champ resté VIDE
// (Number('') === 0, comportement historique conservé : 1 par défaut) et un ZÉRO
// explicitement saisi ou proposé par « Ajuster le stock » (Number('0') === 0 aussi) —
// dans les deux cas `0 || 1` retombait sur 1. Un stock ajusté à 0 s'écrivait donc à 1,
// et une laine à 1 pelote sans historique restait plancherée à 1 après ajustement : le
// bouton ne faisait plus RIEN et l'alerte d'écart ne disparaissait jamais (constaté
// en revue — même défaut que celui déjà corrigé, réapparu ici).
// Correctif final (revue) : rien ne pose de plancher à la CRÉATION (celui de
// l'édition, cf. `save()`, ne couvre que la quantité déjà réservée — une quantité négative
// passe encore ce garde-fou-là sans broncher). Une ligne à quantité négative ferait BAISSER
// le budget — la seule chose que ce chantier promet impossible. `Math.max(0, n)` APRÈS le test
// `Number.isFinite` : garde la distinction déjà en place entre champ vide (⇒ 1, ci-dessus)
// et zéro saisi ou proposé (⇒ 0, inchangé).
function normalizedQuantity(raw) {
  if (raw === '' || raw == null) return 1
  const n = Number(raw)
  return Number.isFinite(n) ? Math.max(0, n) : 1
}
// Proposition d'achat en attente (hausse de quantité en édition, cf. save()) :
// null, ou { delta, payload } — le formulaire normal cède la place à cette proposition
// tant qu'elle n'est pas résolue (cf. resolvePendingPurchase).
const pendingPurchase = ref(null)
// Garde anti double-clic : resolvePendingPurchase() enchaîne deux écritures Dexie ;
// sans ce verrou, un double-tap sur la Nexus 7 pourrait lancer l'appel deux fois avant
// que closeForm() (posé APRÈS les deux écritures) n'ait retiré le panneau, écrivant la
// ligne d'achat deux fois (constaté en revue).
const resolvingPurchase = ref(false)
// Même garde que resolvingPurchase, posée sur save() lui-même : la CRÉATION enchaîne
// elle aussi deux écritures Dexie (yarnsStore.add PUIS purchasesStore.add) — un
// double-tap sur `@click="save"` pendant ces deux `await` créerait deux fiches ET deux
// lignes d'achat (même défaut que resolvePendingPurchase, constaté en revue).
const saving = ref(false)
// Valeur émise par « Ajuster le stock » (<YarnPurchases>) : ce nombre RECONCILIE
// le stock avec un historique DÉJÀ enregistré, ce n'est PAS un nouvel achat. Sans ce
// repère, save() verrait la hausse de quantité qui en résulte et proposerait d'enregistrer
// un achat qui ferait double emploi avec les lignes déjà comptées dans `historyAcquired`
// (cf. YarnPurchases.vue) — exactement le double comptage que ce chantier doit éliminer.
const adjustedFromHistory = ref(null)
function onAdjustQuantity(qty) {
  form.quantity = qty
  adjustedFromHistory.value = qty
}

// Garde anti-dérive de la saisie en impérial.
//
// Le formulaire affiche des yards et des onces ; la base stocke des mètres et des grammes.
// Une conversion aller-retour passe par un arrondi d'affichage : 100 m → « 109,36 yd » →
// 99,9977 m. Rouvrir et réenregistrer une fiche sans y toucher la ferait donc DÉRIVER à
// chaque passage — une perte d'information silencieuse (règle « jamais perdre d'info »).
//
// Règle : un champ que l'utilisatrice n'a pas modifié conserve sa valeur d'origine à
// l'octet près. On compare la chaîne affichée à celle qu'on avait posée ; si elle n'a pas
// bougé, on réécrit la valeur canonique d'origine sans jamais la reconvertir.
const pristine = reactive({ lengthText: '', gramsText: '', lengthM: null, grams: null })

function loadUnitFields(y) {
  const system = settings.unitSystem
  form.lengthM = toInput(y?.lengthM, { system, kind: 'length' })
  form.grams = toInput(y?.grams, { system, kind: 'weight' })
  pristine.lengthText = form.lengthM
  pristine.gramsText = form.grams
  pristine.lengthM = y?.lengthM ?? ''
  pristine.grams = y?.grams ?? ''
}

function canonicalUnitFields() {
  const system = settings.unitSystem
  return {
    lengthM: form.lengthM === pristine.lengthText
      ? pristine.lengthM
      : fromInput(form.lengthM, { system, kind: 'length' }),
    grams: form.grams === pristine.gramsText
      ? pristine.grams
      : fromInput(form.grams, { system, kind: 'weight' }),
  }
}

// Bascule un matériau connu dans form.composition (tableau).
function toggleComposition(m) {
  const i = form.composition.indexOf(m)
  if (i === -1) form.composition.push(m)
  else form.composition.splice(i, 1)
}
// Bascule une caractéristique dans form.labels (même mécanique que toggleComposition).
function toggleLabel(k) {
  const i = form.labels.indexOf(k)
  if (i === -1) form.labels.push(k)
  else form.labels.splice(i, 1)
}

// Avertissement de cohérence : ne dépend QUE de la présence d'une fibre animale RECONNUE.
// Une fibre non classée ne déclenche rien — accuser sur un mot non reconnu serait faux.
const veganConflit = computed(() => {
  if (!form.labels.includes('vegan')) return ''
  return animalFibersIn(form.composition)[0] || ''
})

// Valide la saisie libre « Autre » : l'ajoute au tableau comme chip supprimable.
function addCustomComposition() {
  const value = compositionOtherText.value.trim()
  if (value && !form.composition.includes(value)) form.composition.push(value)
  compositionOtherText.value = ''
  compositionOtherOpen.value = false
}

// Chips « personnalisées » : matériaux tapés via « Autre » et jamais encore enregistrés
// ailleurs dans le stock. Dès qu'une fiche les contient, ils rejoignent compositionOptions
// ci-dessus et perdent cette affordance de suppression, comme une marque personnalisée
// validée rejoint brandOptions.
const customCompositions = computed(() => form.composition.filter((m) => !compositionOptions.value.includes(m)))
// Libellé d'une composition : traduit si connue (catalogue), affichée telle quelle si
// personnalisée. Logique partagée avec YarnDetailDialog (src/constants/compositions.js),
// pour ne plus la réimplémenter ici (06/08/2026).
function compositionLabel(m) {
  return compositionLabelOf(m, t)
}

const brandSelect = computed({
  get: () => (customBrand.value ? '__other__' : form.brand),
  set: (v) => {
    if (v === '__other__') {
      customBrand.value = true
      form.brand = ''
    } else {
      customBrand.value = false
      form.brand = v
    }
  },
})

function openAdd() {
  Object.assign(form, emptyYarn())
  delete form.id
  loadUnitFields(null)
  editId.value = null
  customBrand.value = false
  compositionOtherOpen.value = false
  compositionOtherText.value = ''
  adjustedFromHistory.value = null
  firstPurchaseDate.value = todayISO()
  firstPurchaseBain.value = ''
  formOpen.value = true
  scrollFormIntoView()
}
function openEdit(y) {
  Object.assign(form, emptyYarn(), y)
  // `y.price` est un nombre JS (ou `null`) depuis que save() le normalise ainsi (cf. son
  // commentaire) — réafficher tel quel montrerait « 9.5 » au lieu de « 9,5 » dans un champ
  // qui n'accepte que la virgule française, cassant la parité avec le métrage/poids
  // (`toInput`, mêmes deux lignes plus haut dans ce fichier).
  form.price = y.price === '' || y.price == null ? '' : String(y.price).replace('.', ',')
  form.composition = normalizeComposition(y.composition) // filtre les valeurs invalides
  // Une fiche venue d'une sauvegarde peut porter n'importe quoi dans `labels` (édition
  // manuelle, ancien format) : `normalizeLabels` écarte toute clé hors des huit avant que
  // ça n'atteigne l'affichage (AppIcon retomberait sur `pelote` pour une clé inconnue).
  form.labels = normalizeLabels(y.labels)
  loadUnitFields(y)
  delete form.id
  editId.value = y.id
  customBrand.value = !!(y.brand && !brandOptions.value.includes(y.brand))
  compositionOtherOpen.value = false
  compositionOtherText.value = ''
  adjustedFromHistory.value = null
  formOpen.value = true
  scrollFormIntoView()
}
// Duplique une fiche : pré-remplit le formulaire d'AJOUT (pas d'édition) avec tout sauf
// couleur/photo/prix/date/bain — cas d'usage = même pelote achetée dans un autre coloris.
// `bain` n'est PLUS recopié depuis les travaux sur le budget laine (01/08, un arbitrage) : un
// bain appartient à un LOT ACHETÉ (il descend désormais dans la ligne d'achat, cf.
// `src/stores/purchases.js`), pas à une laine — dupliquer une fiche crée une laine neuve,
// sans historique d'achat, donc sans bain à hériter.
function openDuplicate(y) {
  Object.assign(form, emptyYarn(), y, {
    color: '', colorName: '', photo: '', price: '', purchasedAt: '', bain: '',
    colorType: 'uni', colorNotes: '',
    quantity: 1, reservations: {}, consumed: {},
  })
  form.composition = normalizeComposition(y.composition)
  form.labels = normalizeLabels(y.labels) // même garde qu'en édition, cf. openEdit
  loadUnitFields(y)
  delete form.id
  editId.value = null // nouvelle fiche : save() doit ADD, pas UPDATE — la source n'est jamais touchée
  customBrand.value = !!(y.brand && !brandOptions.value.includes(y.brand))
  compositionOtherOpen.value = false
  compositionOtherText.value = ''
  adjustedFromHistory.value = null
  // La duplication EST une création (editId reste null, cf. ci-dessus) : les champs date
  // d'achat / bain s'affichent donc aussi. Date du jour, bain VIDE — un doublon n'hérite
  // PAS du bain de la fiche d'origine (décision déjà prise, cf. commentaire de tête
  // ci-dessus sur `bain: ''`), pour la même raison : un bain appartient à un lot acheté,
  // et dupliquer crée une laine neuve, sans historique d'achat propre.
  firstPurchaseDate.value = todayISO()
  firstPurchaseBain.value = ''
  formOpen.value = true
  scrollFormIntoView()
}
// À l'ouverture du formulaire (ajout OU édition), remonter en haut : le formulaire
// est rendu tout en haut de l'écran, un tap sur une carte plus bas l'ouvrirait hors
// champ de vision (retour device). Focus sur le 1er champ pour signaler l'ouverture
// aux lecteurs d'écran.
function scrollFormIntoView() {
  nextTick(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    brandField.value?.focus?.()
  })
}
function closeForm() {
  formOpen.value = false
  editId.value = null
  pendingPurchase.value = null
  adjustedFromHistory.value = null
}
// Fiche détail (lecture seule). `detailYarn` = laine affichée, null = fermé.
const detailYarn = ref(null)
function openDetail(y) { detailYarn.value = y }
function closeDetail() { detailYarn.value = null }
function editFromDetail() {
  const y = detailYarn.value
  detailYarn.value = null
  if (y) openEdit(y)
}
async function save() {
  if (saving.value) return
  saving.value = true
  try {
    if (!form.colorName.trim()) {
      snackbar.show(t('yarn.colorRequired'))
      return
    }
    let current = null
    if (editId.value) {
      current = yarnsStore.yarns.find((y) => y.id === editId.value)
      const minQty = current ? reservedTotal(current) : 0
      if (Number(form.quantity) < minQty) {
        snackbar.show(t('yarn.quantityBelowReserved', { n: minQty }))
        return
      }
    }
    // colorNotes ne s'affiche nulle part quand colorType == 'uni' (v-if du champ, badge carte,
    // fiche détail) — mais rien ne le VIDE côté formulaire quand on repasse un type non-uni à
    // "uni" en édition (contrairement à openDuplicate qui le fait explicitement). Sans cette
    // normalisation, le texte resterait stocké et invisible à l'écran, mais retrouvable par la
    // recherche (matchesQuery inclut colorNotes sans condition de colorType) — un match
    // surprenant sans explication visible. Signalé en revue finale.
    const payload = {
      ...form, ...canonicalUnitFields(),
      price: form.price === '' || !Number.isFinite(parseDecimal(form.price)) ? '' : parseDecimal(form.price),
      quantity: normalizedQuantity(form.quantity),
      composition: normalizeComposition(form.composition),
      colorNotes: form.colorType === 'uni' ? '' : form.colorNotes,
    }
    if (editId.value) {
      const previousQty = current ? Number(current.quantity) || 0 : 0
      const delta = payload.quantity - previousQty
      // Seule une HAUSSE ouvre la proposition d'achat — SAUF si cette hausse est EXACTEMENT
      // celle que « Ajuster le stock » (<YarnPurchases>) vient d'émettre : ce nombre
      // réconcilie le stock avec un historique DÉJÀ enregistré, ce n'est pas un nouvel achat —
      // le proposer ferait double emploi avec les lignes déjà comptées (en revue).
      // Si la quantité a encore été modifiée à la main APRÈS l'ajustement, elle ne correspond
      // plus exactement à `adjustedFromHistory` : la proposition reprend alors normalement.
      const isReconciliation = adjustedFromHistory.value != null && payload.quantity === adjustedFromHistory.value
      // Une baisse (ou une quantité inchangée) enregistre directement, SANS jamais toucher
      // purchases : le budget ne doit jamais descendre tout seul (comportement 5 —
      // c'est exactement le défaut de l'ancien calcul que ce chantier corrige).
      if (delta > 0 && !isReconciliation) {
        pendingPurchase.value = { delta, payload }
        return
      }
      await yarnsStore.update(editId.value, payload)
      snackbar.show(t('yarn.updated'))
      closeForm()
    } else {
      // Création : aucune ambiguïté possible (la fiche vient de naître) — la ligne
      // d'achat s'écrit directement, sans proposition, y compris à prix vide (un prix
      // vide reste un ACHAT au prix inconnu, pas un cadeau : cf. isPriceUnknown).
      const newId = await yarnsStore.add(payload)
      await purchasesStore.add({
        yarnId: newId,
        yarnLabel: purchaseLabel(payload),
        kind: 'buy',
        quantity: payload.quantity,
        unitPrice: payload.price,
        currency: settings.currency,
        // Date et bain SAISIS dans le formulaire de création (retour d'usage, 01/08) —
        // pas systématiquement la date du jour : `firstPurchaseDate` en est pré-rempli par
        // défaut (openAdd/openDuplicate), mais reste modifiable, et c'est justement ce que
        // le retour d'usage demandait de pouvoir faire sans repasser par la fiche. `|| todayISO()` ne
        // protège qu'un champ vidé à la main (input type="date" ne peut pas produire autre
        // chose qu'une ISO valide ou '') — jamais la date du jour par défaut silencieux.
        date: firstPurchaseDate.value || todayISO(),
        bain: firstPurchaseBain.value,
        reconstructed: false,
      })
      // Le panneau ne se ferme QU'UNE FOIS les DEUX écritures faites (la fiche PUIS sa
      // ligne d'achat). L'ordre inverse — fermer dès que la fiche existe — a été essayé
      // (travaux sur le budget laine) pour éviter que le formulaire ne reste affiché le temps de
      // l'achat ; il coûtait bien plus cher qu'il ne rapportait : le panneau refermé
      // annonce « c'est enregistré » alors que la ligne d'achat est ENCORE en vol, et
      // tout ce qui suit dans cette fenêtre — changer d'écran, quitter l'application —
      // coupe l'écriture. Mesuré le 06/08 : deux laines saisies d'affilée puis un passage
      // à l'écran Dépenses, et le budget affichait 12,80 € au lieu de 30,50 €, la laine
      // bien créée mais son montant perdu, sans un mot. Le formulaire visible pendant ces
      // quelques millisecondes est le prix honnête de cette garantie — le bouton étant
      // déjà `:disabled="saving"`, il montre simplement que l'application travaille.
      closeForm()
    }
  } finally {
    saving.value = false
  }
}
// Résout la proposition d'achat (hausse de quantité en édition) : `kind` vaut
// 'buy' | 'gift' | null. La fiche est mise à jour dans TOUS les cas (l'utilisatrice a
// bien voulu ce nouveau total) ; seul le fait d'écrire ou non une ligne dans purchases
// dépend du choix. « Offert » n'a pas de prix — un cadeau, par définition, ne s'achète
// pas (« Offert » la crée en kind: 'gift', jamais avec le prix du formulaire).
async function resolvePendingPurchase(kind) {
  const pending = pendingPurchase.value
  if (!pending || resolvingPurchase.value) return
  resolvingPurchase.value = true
  try {
    await yarnsStore.update(editId.value, pending.payload)
    if (kind) {
      await purchasesStore.add({
        yarnId: editId.value,
        yarnLabel: purchaseLabel(pending.payload),
        kind,
        quantity: pending.delta,
        unitPrice: kind === 'gift' ? '' : pending.payload.price,
        currency: settings.currency,
        date: todayISO(),
        reconstructed: false,
      })
    }
  } finally {
    resolvingPurchase.value = false
  }
  snackbar.show(t('yarn.updated'))
  closeForm()
}
async function remove(id) {
  const y = await yarnsStore.remove(id)
  await softDelete('yarn', y, { message: t('yarn.deleted'), reload: yarnsStore.load })
}
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
        <button class="viewtoggle" :aria-label="t('common.toggleView')" @click="grid = !grid"><AppIcon :name="grid ? 'list' : 'grid'" :size="20" /></button>
      </div>
    </template>

    <!-- Proposition d'achat en attente (hausse de quantité en édition, cf. save()) : cède la
         place au formulaire normal tant qu'elle n'est pas résolue par l'une des 3 issues. -->
    <div v-if="formOpen && pendingPurchase" class="card addform" data-test="qty-increase-prompt">
      <p class="addform__title">{{ t('yarn.purchasePrompt.message', { n: pendingPurchase.delta }) }}</p>
      <div class="addform__actions">
        <button class="btn btn--primary" data-test="qty-increase-buy" :disabled="resolvingPurchase" @click="resolvePendingPurchase('buy')">{{ t('yarn.purchasePrompt.recordBuy') }}</button>
        <button class="btn" data-test="qty-increase-gift" :disabled="resolvingPurchase" @click="resolvePendingPurchase('gift')">{{ t('yarn.purchasePrompt.recordGift') }}</button>
        <button class="btn" data-test="qty-increase-ignore" :disabled="resolvingPurchase" @click="resolvePendingPurchase(null)">{{ t('yarn.purchasePrompt.ignore') }}</button>
      </div>
    </div>
    <div v-else-if="formOpen" class="card addform">
      <p class="addform__title">{{ editId ? t('yarn.edit') : t('yarn.add') }}</p>
      <label class="field-label" for="yarn-brand">{{ t('yarn.brand') }}</label>
      <select id="yarn-brand" ref="brandField" v-model="brandSelect" class="input">
        <option value="">{{ t('yarn.brandPick') }}</option>
        <option v-for="b in brandOptions" :key="b" :value="b">{{ b }}</option>
        <option value="__other__">{{ t('yarn.brandOther') }}</option>
      </select>
      <input v-if="customBrand" v-model="form.brand" class="input mt2" :aria-label="t('yarn.brandCustom')" :placeholder="t('yarn.brandCustom')" />

      <label class="field-label mt2" for="yarn-model">{{ t('yarn.model') }}</label>
      <input id="yarn-model" v-model="form.model" class="input" :placeholder="t('yarn.modelPlaceholder')" />

      <label class="field-label mt2">{{ t('yarn.colorPick') }}</label>
      <div class="palette">
        <button
          v-for="c in COLOR_PALETTE"
          :key="c.key"
          type="button"
          class="palette__sw"
          :class="{ 'palette__sw--on': form.color === c.hsl }"
          :style="{ background: c.hsl }"
          :aria-label="c.key"
          @click="pickColor(c)"
        ></button>
        <button
          type="button"
          class="palette__sw palette__cust"
          :class="{ 'palette__sw--on': isCustom }"
          :style="isCustom ? { background: form.color } : {}"
          :aria-label="t('yarn.customColor')"
          @click="colorPicker.open = true"
        >
          <AppIcon v-if="!isCustom" name="plus" :size="16" />
        </button>
      </div>

      <label class="field-label mt2" for="yarn-color-name">{{ t('yarn.colorName') }} <span class="req">*</span></label>
      <input id="yarn-color-name" v-model="form.colorName" class="input" :placeholder="t('yarn.colorNamePlaceholder')" />

      <label class="field-label mt2" for="yarn-color-type">{{ t('yarn.colorType') }}</label>
      <select id="yarn-color-type" v-model="form.colorType" class="input">
        <option v-for="ct in YARN_COLOR_TYPES" :key="ct" :value="ct">{{ t(`yarn.colorTypes.${ct}`) }}</option>
      </select>
      <template v-if="form.colorType !== 'uni'">
        <label class="field-label mt2" for="yarn-color-notes">{{ t('yarn.colorNotes') }}</label>
        <input id="yarn-color-notes" v-model="form.colorNotes" class="input" :placeholder="t('yarn.colorNotesPlaceholder')" />
      </template>

      <label class="field-label mt2">{{ t('yarn.photoLabel') }}</label>
      <div class="yphoto">
        <img v-if="form.photo" :src="form.photo" class="yphoto__img" alt="" />
        <button class="btn" type="button" @click="addPhoto"><AppIcon name="camera" :size="17" /> {{ form.photo ? t('photo.change') : t('photo.add') }}</button>
        <button v-if="form.photo" class="btn yphoto__del" type="button" @click="removePhoto">{{ t('common.delete') }}</button>
      </div>

      <div class="wlabel mt2">
        <label class="field-label" for="yarn-weight">{{ t('yarn.weight') }}</label>
        <button class="wlabel__help" type="button" :aria-label="t('yarn.weightGuideTitle')" @click="weightHelpOpen = true">
          <AppIcon name="help" :size="16" />
        </button>
      </div>
      <select id="yarn-weight" v-model="form.weight" class="input">
        <option value="">—</option>
        <option v-for="w in YARN_WEIGHTS" :key="w" :value="w">{{ t(`yarn.weights.${w}`) }}</option>
      </select>
      <div class="row row--fields mt2">
        <div class="col"><label class="field-label" for="yarn-length">{{ settings.unitSystem === 'imperial' ? t('yarn.lengthYd') : t('yarn.lengthM') }}</label><input id="yarn-length" v-model="form.lengthM" class="input" inputmode="numeric" placeholder="100" /></div>
        <div class="col"><label class="field-label" for="yarn-grams">{{ settings.unitSystem === 'imperial' ? t('yarn.ounces') : t('yarn.grams') }}</label><input id="yarn-grams" v-model="form.grams" class="input" inputmode="numeric" placeholder="50" /></div>
        <div class="col"><label class="field-label" for="yarn-quantity">{{ t('yarn.quantity') }}</label><input id="yarn-quantity" v-model="form.quantity" class="input" inputmode="numeric" placeholder="1" /></div>
        <div class="col"><label class="field-label" for="yarn-price">{{ t('yarn.priceWithSymbol', { symbol: currencySymbol(settings.currency, locale) }) }}</label><input id="yarn-price" :value="form.price" class="input" inputmode="decimal" placeholder="—" @input="onPrixLaine" /></div>
      </div>
      <!-- Date d'achat et bain, UNIQUEMENT à la création (retour d'usage, 01/08 : « il
           n'y a plus la date d'achat ni le num de bain sur la fiche de création de laine »).
           Alimentent la 1re ligne d'achat que `save()` écrit automatiquement à la création
           (cf. plus haut) — sans ces champs, la seule façon de corriger cette 1re ligne
           était de rouvrir la fiche fraîchement créée pour la modifier, un aller-retour
           absurde pour une information déjà sous les yeux. Absents en ÉDITION (v-if="!editId",
           comme YarnPurchases ci-dessous en miroir) : le bloc « Achats et cadeaux » gère
           déjà les lignes une à une là où une fiche a un historique, les faire cohabiter
           créerait deux endroits contradictoires pour la même information. La duplication
           EST une création (editId reste null, cf. openDuplicate) : ces champs s'y affichent
           aussi, cf. leur remise à date du jour / bain vide dans openDuplicate. -->
      <div v-if="!editId" class="row row--fields mt2">
        <div class="col">
          <label class="field-label" for="yarn-purchased-at">{{ t('yarn.purchasedAt') }}</label>
          <input id="yarn-purchased-at" v-model="firstPurchaseDate" type="date" class="input" />
        </div>
        <div class="col">
          <label class="field-label" for="yarn-bain">{{ t('yarn.bain') }}</label>
          <input id="yarn-bain" v-model="firstPurchaseBain" class="input" />
        </div>
      </div>
      <!-- Bloc « Achats et cadeaux » : n'existe qu'en ÉDITION — une fiche en cours de
           création n'a pas encore d'id, donc aucun historique auquel s'accrocher. -->
      <YarnPurchases
        v-if="editId"
        :yarn-id="editId"
        :yarn="editingYarn || {}"
        :yarn-label="purchaseLabel(editingYarn || {})"
        @update:quantity="onAdjustQuantity"
      />

      <label class="field-label mt2">{{ t('yarn.composition') }}</label>
      <div class="chips">
        <button
          v-for="m in compositionOptions"
          :key="m"
          type="button"
          class="chip"
          :class="{ 'chip--on': form.composition.includes(m) }"
          @click="toggleComposition(m)"
        >{{ compositionLabel(m) }}</button>
        <button
          v-for="m in customCompositions"
          :key="m"
          type="button"
          class="chip chip--on"
          @click="toggleComposition(m)"
        >{{ m }} <AppIcon name="close" :size="13" /></button>
        <button
          type="button"
          class="chip"
          :class="{ 'chip--on': compositionOtherOpen }"
          @click="compositionOtherOpen = !compositionOtherOpen"
        >{{ t('yarn.compositionOther') }}</button>
      </div>
      <div v-if="compositionOtherOpen" class="row mt2">
        <div class="col">
          <input
            v-model="compositionOtherText"
            class="input"
            :aria-label="t('yarn.compositionOtherPlaceholder')"
            :placeholder="t('yarn.compositionOtherPlaceholder')"
            @keyup.enter="addCustomComposition"
          />
        </div>
        <button type="button" class="btn" @click="addCustomComposition">{{ t('common.add') }}</button>
      </div>
      <p class="addform__section">{{ t('yarn.labelsTitle') }}</p>
      <template v-for="(cles, groupe) in LABEL_GROUPS" :key="groupe">
        <p class="addform__grouplbl">{{ t(`yarn.labelGroups.${groupe}`) }}</p>
        <div class="chips">
          <button
            v-for="k in cles"
            :key="k"
            type="button"
            class="chip labelchip"
            :class="{ 'chip--on': form.labels.includes(k), 'labelchip--on': form.labels.includes(k) }"
            @click="toggleLabel(k)"
          >{{ t(`yarn.labels.${k}`) }}</button>
        </div>
      </template>
      <p v-if="veganConflit" class="veganwarn">{{ t('yarn.veganWarning', { fibre: veganConflit }) }}</p>
      <div class="addform__actions">
        <button class="btn" @click="closeForm">{{ t('common.cancel') }}</button>
        <button class="btn btn--primary" :disabled="saving" @click="save">{{ t('common.save') }}</button>
      </div>
    </div>
    <button v-else class="btn btn--primary btn--block mt" @click="openAdd"><AppIcon name="plus" :size="17" /> {{ t('yarn.add') }}</button>

    <template v-if="yarnsStore.yarns.length">
      <div :class="grid ? 'ygrid' : 'ylist'">
        <YarnCard
          v-for="y in filtered"
          :key="y.id"
          :yarn="y"
          :usage="usage(y)"
          @view="openDetail"
          @edit="openEdit"
          @duplicate="openDuplicate"
          @delete="(yy) => remove(yy.id)"
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
  <YarnWeightHelp :open="weightHelpOpen" @close="weightHelpOpen = false" />
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
  <ColorPickerDialog :open="colorPicker.open" :color="form.color" @pick="onPickCustom" @close="colorPicker.open = false" />
  <YarnDetailDialog
    :open="detailYarn != null"
    :yarn="detailYarn || {}"
    :usage="detailYarn ? usage(detailYarn) : { state: 'free', used: 0, total: 0 }"
    @close="closeDetail"
    @edit="editFromDetail"
  />
  <!-- Astuce de navigation (décision produit du 19/08/2026, mot pour mot :
       « … qu'on va dans le stock de laine, elle n'a rien à voir avec l'étape d'import d'un
       patron »). Posée dès la visite de l'écran Stock lui-même, plus seulement à
       l'ouverture de la fiche d'une pelote. Auparavant, un `v-if="detailYarn != null"`
       la retenait sciemment — la laine n'a pas d'écran à elle, son détail est le dialogue
       ci-dessus — mais c'est tranché : l'astuce enseigne D'ABORD le balayage arrière,
       un geste utile dès qu'on est entré dans le Stock, pelote ouverte ou non — la partie
       de son texte sur la bande d'onglets qui déborde, elle, ne vise que le projet et la
       bibliothèque (cf. FirstDetailTip.vue). -->
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
.palette { display: flex; flex-wrap: wrap; gap: 6px; }
.req { color: var(--danger); }
.chips { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
.chip { border: 1px solid var(--line); background: var(--bg); color: var(--ink-55); font-weight: 600; font-size: 13px; padding: 0 13px; border-radius: var(--r-pill); min-height: 44px; display: inline-flex; align-items: center; }
.chip--on { background: var(--brand); border-color: var(--brand); color: var(--on-accent); }
.addform__section { margin: var(--sp-4) 0 var(--sp-2); font-weight: 700; color: var(--ink); font-size: 14.5px; }
.addform__grouplbl { margin: var(--sp-2) 0 var(--sp-1); font-size: 12.5px; font-weight: 700; color: var(--ink-55); }
/* Texte coloré, AUCUN fond — c'est le patron déjà en place (`.warn` de
   LocalPdfImportView.vue:242). `--warning` est défini dans les DEUX thèmes (#8a5a00 en
   clair, #d1a24d en sombre) et son contraste a été audité le 18/07.
   ⚠️ Ne PAS poser un fond crème en dur : en mode sombre le texte `--ink` est clair, on
   obtiendrait du clair sur clair. C'est l'erreur qu'une première version de ce plan
   contenait. */
.veganwarn { margin-top: var(--sp-2); color: var(--warning); font-size: 13.5px; }
.yphoto { display: flex; align-items: center; gap: var(--sp-2); }
.yphoto__img { width: 56px; height: 56px; object-fit: cover; border-radius: var(--r-sm); border: 1px solid var(--line); }
.yphoto__del { color: var(--danger); }
.palette__sw { width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--line); padding: 0; }
.palette__sw--on { border-color: var(--ink); box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--brand); }
.palette__cust { display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--ink-55); background: var(--bg); }
.palette__cust:focus-visible { outline: 2px solid var(--brand-deep); outline-offset: 2px; }
/* Mesuré à 360px : 25px de débordement à 22px fixes, « 49,203 » passait sous la tuile
   voisine (cf. captures 25/07). `clamp()` réduit juste ce qu'il faut sur écran étroit ;
   la borne haute (22px) préserve la taille d'origine dès que l'écran s'élargit. */
.recap__num { display: block; font-family: var(--font-display); font-weight: 600; font-size: clamp(13px, 4.2vw, 22px); color: var(--brand-deep); }
.recap__lbl { font-size: 11.5px; color: var(--ink-55); }
.toolbar { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: var(--sp-2); margin: var(--sp-3) 0; }
/* Pastille du badge « N filtres actifs » sur le bouton Filtrer : purement décorative
   (aria-hidden au template), la même information passe par l'aria-label du bouton. */
.filter-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: var(--r-pill); background: var(--brand); color: var(--on-accent); font-size: 11.5px; font-weight: 700; }
.viewtoggle { display: flex; align-items: center; justify-content: center; border: 1px solid var(--line); background: var(--tile); border-radius: var(--r-sm); width: 44px; height: 44px; font-size: 16px; box-shadow: var(--clay-sm); }
.addform__title { font-family: var(--font-display); font-weight: 600; font-size: 16px; margin: 0 0 var(--sp-2); }
.mt { margin-top: var(--sp-2); }
.mt2 { margin-top: var(--sp-2); }
.wlabel { display: flex; align-items: center; gap: 6px; }
.wlabel__help { display: flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; margin: -12px 0; border: none; background: transparent; color: var(--ink-55); }
.row { display: flex; gap: var(--sp-3); }
.col { flex: 1; }
/* 4 colonnes : les libellés n'ont pas tous la même longueur (et changent avec la langue),
   donc certains passent sur 2 lignes. On aligne les champs par le bas pour qu'ils restent
   sur la même ligne de base quelle que soit la hauteur du libellé au-dessus. */
.row--fields { align-items: flex-end; }
select.input { font-family: var(--font-ui); }
.addform { margin-top: var(--sp-2); }
.addform__actions { display: flex; gap: var(--sp-3); margin-top: var(--sp-3); }
.addform__actions .btn { flex: 1; }
.ylist { display: flex; flex-direction: column; gap: var(--sp-2); margin-top: var(--sp-4); }
.ygrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr)); gap: var(--sp-2); margin-top: var(--sp-4); }
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
