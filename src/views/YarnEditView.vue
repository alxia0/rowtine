<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AppHeader from '@/components/AppHeader.vue'
import { useYarnsStore, emptyYarn } from '@/stores/yarns'
import { reservedTotal } from '@/utils/yarn-usage'
import { useSnackbarStore } from '@/stores/snackbar'
import { YARN_WEIGHTS, YARN_BRANDS, YARN_COLOR_TYPES } from '@/constants/catalog'
import { COLOR_PALETTE, isCustomColor, paletteColorLabel } from '@/constants/swatch'
import { COMPOSITIONS, normalizeComposition, compositionLabel as compositionLabelOf } from '@/constants/compositions'
import { LABEL_GROUPS, normalizeLabels } from '@/constants/yarn-labels'
import { animalFibersIn } from '@/constants/fiber-origin'
import AppIcon from '@/components/AppIcon.vue'
import YarnWeightHelp from '@/components/YarnWeightHelp.vue'
import ColorPickerDialog from '@/components/ColorPickerDialog.vue'
import YarnPurchases from '@/components/YarnPurchases.vue'
import { useColorPickerStore } from '@/stores/color-picker'
import { ymdLocal } from '@/utils/time-periods'
// Le champ de prix n'accepte que des chiffres et un séparateur : un prix tapé « 18,90 € »
// donnait NaN, donc 0, donc « Gratuit ».
import { filtrerSaisieDecimale, parseDecimal } from '@/utils/decimal'
import { toInput, fromInput, currencySymbol } from '@/utils/units'
import { useSettingsStore } from '@/stores/settings'
import { usePurchasesStore } from '@/stores/purchases'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const yarnsStore = useYarnsStore()
const snackbar = useSnackbarStore()
const colorPicker = useColorPickerStore()
const settings = useSettingsStore()
const purchasesStore = usePurchasesStore()

// Ajout vs édition : dérivé de la route, plus d'état local (`editId`/`formOpen`) — motif
// ProjectEditView.vue:38.
const isEdit = computed(() => !!route.params.id)

// Marques proposées dans le menu déroulant : catalogue ∪ marques déjà saisies dans le stock
// (repris tel quel de StashView.vue).
const brandOptions = computed(() => {
  const set = new Set(YARN_BRANDS)
  for (const y of yarnsStore.yarns) if (y.brand && y.brand.trim()) set.add(y.brand.trim())
  return [...set].sort((a, b) => a.localeCompare(b))
})
// Matériaux proposés : les 11 connus ∪ les matériaux personnalisés déjà saisis dans le
// stock (même principe que brandOptions).
const compositionOptions = computed(() => {
  const custom = new Set()
  for (const y of yarnsStore.yarns) {
    for (const m of normalizeComposition(y.composition)) {
      if (!COMPOSITIONS.includes(m)) custom.add(m)
    }
  }
  return [...COMPOSITIONS, ...[...custom].sort((a, b) => a.localeCompare(b))]
})

const colorLabel = paletteColorLabel
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
// auto-rempli par une pastille (sinon on écraserait un nom déjà tapé).
function onPickCustom(hsl) {
  if (!hsl) return
  const prevPalette = COLOR_PALETTE.find((c) => c.hsl === form.color)
  if (prevPalette && form.colorName === colorLabel(prevPalette.key)) form.colorName = ''
  form.color = hsl
}

const brandField = ref(null)
const weightHelpOpen = ref(false)
const form = reactive(emptyYarn())
const customBrand = ref(false) // « Autre… » : saisie libre de la marque
const compositionOtherOpen = ref(false) // chip « Autre » : révèle la saisie libre
const compositionOtherText = ref('')

// Fiche actuellement éditée (telle que connue du store), pour le bloc « Achats et
// cadeaux » (<YarnPurchases>) : n'existe qu'en ÉDITION, jamais en création/duplication
// (aucun id tant que la fiche n'a pas été enregistrée une première fois).
const editingYarn = computed(() =>
  route.params.id ? yarnsStore.yarns.find((y) => y.id === Number(route.params.id)) : null,
)
// Libellé figé d'une ligne d'achat : même format que la reprise de l'existant
// (src/db/purchases-reprise.js, non exporté) — marque/modèle/coloris, segments vides
// omis. Dupliqué en dur ici plutôt qu'importé : les deux modules n'ont aucune autre
// raison de se connaître, et le format est trivial à garder aligné.
function purchaseLabel(y) {
  return [y?.brand, y?.model, y?.colorName].map((s) => String(s || '').trim()).filter(Boolean).join(' · ')
}
// Le jour LOCAL, jamais `toISOString()` : celui-ci rend la date UTC, donc la veille entre
// minuit local et minuit UTC.
function todayISO() {
  return ymdLocal(new Date())
}
// Le champ de prix n'accepte que des chiffres et un séparateur. La valeur filtrée est
// RÉÉCRITE dans le champ : quand le caractère refusé ne change pas la valeur — le geste
// réel, taper « € » après « 18,90 » — `:value` seul ne suffit pas, Vue ne repasse pas et
// le symbole resterait à l'écran alors que la donnée, elle, est propre.
function onPrixLaine(event) {
  const propre = filtrerSaisieDecimale(event.target.value)
  event.target.value = propre
  form.price = propre
}
// Date d'achat / bain de la 1re ligne d'achat, saisis DANS le formulaire à la CRÉATION —
// pas des champs de `form`/`emptyYarn()` : ces deux-là restent la propriété de la LIGNE
// d'achat (cf. src/stores/purchases.js), jamais de la fiche laine elle-même. Rendus
// UNIQUEMENT en création (v-if="!isEdit" au template) : en édition, le bloc « Achats et
// cadeaux » (<YarnPurchases>) gère déjà les lignes une à une.
const firstPurchaseDate = ref(todayISO())
const firstPurchaseBain = ref('')
// `Number(form.quantity) || 1` confondait DEUX cas distincts : un champ resté VIDE
// (Number('') === 0, comportement historique conservé : 1 par défaut) et un ZÉRO
// explicitement saisi ou proposé par « Ajuster le stock » (Number('0') === 0 aussi).
// Rien ne pose de plancher à la CRÉATION (celui de l'édition, cf. `save()`, ne couvre que
// la quantité déjà réservée). `Math.max(0, n)` APRÈS le test `Number.isFinite`.
function normalizedQuantity(raw) {
  if (raw === '' || raw == null) return 1
  // Virgule décimale acceptée (« 2,5 ») : `Number` natif en faisait NaN, donc 1 en silence.
  const n = parseDecimal(raw)
  return Number.isFinite(n) ? Math.max(0, n) : 1
}
// Proposition d'achat en attente (hausse de quantité en édition, cf. save()) :
// null, ou { delta, payload } — le formulaire normal cède la place à cette proposition
// tant qu'elle n'est pas résolue (cf. resolvePendingPurchase).
const pendingPurchase = ref(null)
// Garde anti double-clic : resolvePendingPurchase() enchaîne deux écritures Dexie.
const resolvingPurchase = ref(false)
// Même garde que resolvingPurchase, posée sur save() lui-même : la CRÉATION enchaîne
// elle aussi deux écritures Dexie (yarnsStore.add PUIS purchasesStore.add).
const saving = ref(false)
// Valeur émise par « Ajuster le stock » (<YarnPurchases>) : ce nombre RECONCILIE
// le stock avec un historique DÉJÀ enregistré, ce n'est PAS un nouvel achat.
const adjustedFromHistory = ref(null)
function onAdjustQuantity(qty) {
  form.quantity = qty
  adjustedFromHistory.value = qty
}

// Garde anti-dérive de la saisie en impérial (cf. commentaire d'origine, StashView.vue).
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
// ailleurs dans le stock.
const customCompositions = computed(() => form.composition.filter((m) => !compositionOptions.value.includes(m)))
// Libellé d'une composition : traduit si connue (catalogue), affichée telle quelle si
// personnalisée. Logique partagée avec YarnDetailDialog (src/constants/compositions.js).
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

// Reprend le corps de l'ancien `openEdit(y)` (sans `editId.value`/`formOpen.value`/
// `scrollFormIntoView()` — `isEdit` dérive désormais de la route, et il n'y a plus de
// formulaire inline à faire défiler en vue).
function applyExisting(y) {
  Object.assign(form, emptyYarn(), y)
  // `y.price` est un nombre JS (ou `null`) depuis que save() le normalise ainsi — réafficher
  // tel quel montrerait « 9.5 » au lieu de « 9,5 » dans un champ qui n'accepte que la virgule
  // française, cassant la parité avec le métrage/poids (`toInput`).
  form.price = y.price === '' || y.price == null ? '' : String(y.price).replace('.', ',')
  form.composition = normalizeComposition(y.composition) // filtre les valeurs invalides
  form.labels = normalizeLabels(y.labels) // écarte toute clé hors des huit connues
  loadUnitFields(y)
  delete form.id
  customBrand.value = !!(y.brand && !brandOptions.value.includes(y.brand))
  compositionOtherOpen.value = false
  compositionOtherText.value = ''
  adjustedFromHistory.value = null
}
// Reprend le corps de l'ancien `openDuplicate(y)`, mêmes retraits — `photo: ''` de son
// objet de remise à zéro disparaît aussi, `form` n'a plus de champ photo unique (la galerie
// vit exclusivement sur l'écran fiche, jamais recopiée à la duplication).
function applyDuplicate(y) {
  Object.assign(form, emptyYarn(), y, {
    color: '', colorName: '', price: '', purchasedAt: '', bain: '',
    colorType: 'uni', colorNotes: '',
    quantity: 1, reservations: {}, consumed: {},
  })
  form.composition = normalizeComposition(y.composition)
  form.labels = normalizeLabels(y.labels) // même garde qu'en édition, cf. applyExisting
  loadUnitFields(y)
  delete form.id
  customBrand.value = !!(y.brand && !brandOptions.value.includes(y.brand))
  compositionOtherOpen.value = false
  compositionOtherText.value = ''
  adjustedFromHistory.value = null
  // La duplication EST une création : les champs date d'achat / bain s'affichent donc
  // aussi. Date du jour, bain VIDE — un doublon n'hérite PAS du bain de la fiche
  // d'origine (un bain appartient à un lot acheté, dupliquer crée une laine neuve, sans
  // historique d'achat propre).
  firstPurchaseDate.value = todayISO()
  firstPurchaseBain.value = ''
}

// Formulaire vierge (corps de l'ancien `openAdd()`) : extrait pour pouvoir tourner
// INCONDITIONNELLEMENT en tête d'onMounted, cf. commentaire ci-dessous.
function applyBlank() {
  Object.assign(form, emptyYarn())
  delete form.id
  // `loadUnitFields(null)` pose `pristine.lengthM`/`pristine.grams` à '' (via
  // `toInput(undefined, ...)`) plutôt que de les laisser à leur défaut brut `null` : sans
  // cet appel, `canonicalUnitFields()` enregistrerait `null` au lieu de '' pour une fiche
  // neuve dont la longueur/le poids restent vides.
  loadUnitFields(null)
  customBrand.value = false
  compositionOtherOpen.value = false
  compositionOtherText.value = ''
  adjustedFromHistory.value = null
  firstPurchaseDate.value = todayISO()
  firstPurchaseBain.value = ''
}

onMounted(async () => {
  if (!yarnsStore.loaded) await yarnsStore.load()
  // Le formulaire vierge tourne D'ABORD, INCONDITIONNELLEMENT, puis est éventuellement
  // recouvert par applyExisting/applyDuplicate si la route pointe vers une fiche qui existe
  // réellement (revue finale : un `duplicateFrom` PÉRIMÉ — id supprimé entre-temps — matchait
  // la 2e branche sans y trouver de fiche, sautant à la fois `applyDuplicate` ET ce formulaire
  // vierge ; `pristine.lengthM`/`pristine.grams` restaient alors à leur défaut brut `null`,
  // et canonicalUnitFields() enregistrait `null` au lieu de '' pour un champ resté vide).
  applyBlank()
  if (route.params.id) {
    const y = yarnsStore.yarns.find((yy) => yy.id === Number(route.params.id))
    if (y) applyExisting(y)
  } else if (route.query.duplicateFrom) {
    const y = yarnsStore.yarns.find((yy) => yy.id === Number(route.query.duplicateFrom))
    if (y) applyDuplicate(y)
  }
})

async function save() {
  if (saving.value) return
  saving.value = true
  try {
    if (!form.colorName.trim()) {
      snackbar.show(t('yarn.colorRequired'))
      return
    }
    let current = null
    if (isEdit.value) {
      current = yarnsStore.yarns.find((y) => y.id === Number(route.params.id))
      const minQty = current ? reservedTotal(current) : 0
      // Même lecture que la valeur enregistrée : un NaN (« 2,5 ») passait sous ce plancher.
      if (normalizedQuantity(form.quantity) < minQty) {
        snackbar.show(t('yarn.quantityBelowReserved', { n: minQty }))
        return
      }
    }
    // colorNotes ne s'affiche nulle part quand colorType == 'uni' — mais rien ne le VIDE
    // côté formulaire quand on repasse un type non-uni à "uni" en édition. Sans cette
    // normalisation, le texte resterait stocké et invisible à l'écran, mais retrouvable par
    // la recherche.
    //
    // ⚠️ Piège d'interface avec la Task 1 (photos/coverIndex de emptyYarn()) : `form` porte
    // ces deux clés même si aucun champ du template ne les affiche ni ne les modifie. Les
    // exclure ici neutralise le risque à la source, une seule fois, pour les trois cas
    // (création/édition/duplication) : en ÉDITION, la galerie de la fiche part et revient
    // inchangée (mise à jour Dexie partielle, clé absente = non touchée) ; en CRÉATION (y
    // compris DUPLICATION), `yarnsStore.add()` retombe sur les défauts d'`emptyYarn()`
    // (`photos: []`/`coverIndex: 0`) — jamais la galerie de la fiche source.
    //
    // `photo` (revue finale) : l'ex-champ photo unique, disparu du template mais encore
    // copié sur `form` par `Object.assign(form, emptyYarn(), y)` (applyExisting/
    // applyDuplicate) quand la fiche source en porte un (stock d'avant cette refonte). Sans
    // cette exclusion, dupliquer une fiche ANCIENNE réécrirait sa photo sur la fiche neuve —
    // exactement ce que la galerie ne doit jamais hériter à la duplication.
    const { photos: _formPhotos, coverIndex: _formCoverIndex, photo: _formPhoto, ...formSansGalerie } = form
    const payload = {
      ...formSansGalerie, ...canonicalUnitFields(),
      price: form.price === '' || !Number.isFinite(parseDecimal(form.price)) ? '' : parseDecimal(form.price),
      quantity: normalizedQuantity(form.quantity),
      composition: normalizeComposition(form.composition),
      colorNotes: form.colorType === 'uni' ? '' : form.colorNotes,
    }
    if (isEdit.value) {
      const previousQty = current ? Number(current.quantity) || 0 : 0
      const delta = payload.quantity - previousQty
      // Seule une HAUSSE ouvre la proposition d'achat — SAUF si cette hausse est EXACTEMENT
      // celle que « Ajuster le stock » (<YarnPurchases>) vient d'émettre : ce nombre
      // réconcilie le stock avec un historique DÉJÀ enregistré, ce n'est pas un nouvel achat.
      const isReconciliation = adjustedFromHistory.value != null && payload.quantity === adjustedFromHistory.value
      // Une baisse (ou une quantité inchangée) enregistre directement, SANS jamais toucher
      // purchases : le budget ne doit jamais descendre tout seul.
      if (delta > 0 && !isReconciliation) {
        pendingPurchase.value = { delta, payload }
        return
      }
      await yarnsStore.update(route.params.id, payload)
      snackbar.show(t('yarn.updated'))
      router.replace({ name: 'stash-item', params: { id: route.params.id } })
    } else {
      // Création : aucune ambiguïté possible (la fiche vient de naître) — la ligne
      // d'achat s'écrit directement, sans proposition, y compris à prix vide (un prix
      // vide reste un ACHAT au prix inconnu, pas un cadeau).
      const newId = await yarnsStore.add(payload)
      await purchasesStore.add({
        yarnId: newId,
        yarnLabel: purchaseLabel(payload),
        kind: 'buy',
        quantity: payload.quantity,
        unitPrice: payload.price,
        currency: settings.currency,
        // Date et bain SAISIS dans le formulaire de création — pas systématiquement la
        // date du jour : `firstPurchaseDate` en est pré-rempli par défaut, mais reste
        // modifiable. `|| todayISO()` ne protège qu'un champ vidé à la main.
        date: firstPurchaseDate.value || todayISO(),
        bain: firstPurchaseBain.value,
        reconstructed: false,
      })
      // La navigation n'a lieu QU'UNE FOIS les DEUX écritures faites (la fiche PUIS sa
      // ligne d'achat) : quitter cet écran plus tôt annoncerait « c'est enregistré » alors
      // que la ligne d'achat est ENCORE en vol (cf. bug du 06/08, budget désynchronisé).
      router.replace({ name: 'stash-item', params: { id: newId } })
    }
  } finally {
    saving.value = false
  }
}
// Résout la proposition d'achat (hausse de quantité en édition) : `kind` vaut
// 'buy' | 'gift' | null. La fiche est mise à jour dans TOUS les cas ; seul le fait
// d'écrire ou non une ligne dans purchases dépend du choix.
async function resolvePendingPurchase(kind) {
  const pending = pendingPurchase.value
  if (!pending || resolvingPurchase.value) return
  resolvingPurchase.value = true
  try {
    await yarnsStore.update(route.params.id, pending.payload)
    if (kind) {
      await purchasesStore.add({
        yarnId: Number(route.params.id),
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
  router.replace({ name: 'stash-item', params: { id: route.params.id } })
}
</script>

<template>
<div>
  <AppHeader :title="isEdit ? t('yarn.edit') : t('yarn.add')" back />
  <main class="screen">
    <!-- Proposition d'achat en attente (hausse de quantité en édition, cf. save()) : cède la
         place au formulaire normal tant qu'elle n'est pas résolue par l'une des 3 issues. -->
    <div v-if="pendingPurchase" class="card addform" data-test="qty-increase-prompt">
      <p class="addform__title">{{ t('yarn.purchasePrompt.message', { n: pendingPurchase.delta }) }}</p>
      <div class="addform__actions">
        <button class="btn btn--primary" data-test="qty-increase-buy" :disabled="resolvingPurchase" @click="resolvePendingPurchase('buy')">{{ t('yarn.purchasePrompt.recordBuy') }}</button>
        <button class="btn" data-test="qty-increase-gift" :disabled="resolvingPurchase" @click="resolvePendingPurchase('gift')">{{ t('yarn.purchasePrompt.recordGift') }}</button>
        <button class="btn" data-test="qty-increase-ignore" :disabled="resolvingPurchase" @click="resolvePendingPurchase(null)">{{ t('yarn.purchasePrompt.ignore') }}</button>
      </div>
    </div>
    <div v-else class="card addform">
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
      <label class="field-label mt2" for="yarn-stored-in">{{ t('yarn.storedIn') }}</label>
      <input id="yarn-stored-in" v-model="form.storedIn" class="input" :placeholder="t('yarn.storedInPlaceholder')" />

      <!-- Date d'achat et bain, UNIQUEMENT à la création. La duplication EST une création
           (isEdit reste false, cf. onMounted) : ces champs s'y affichent aussi. -->
      <div v-if="!isEdit" class="row row--fields mt2">
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
        v-if="isEdit"
        :yarn-id="Number(route.params.id)"
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

      <label class="field-label mt2" for="yarn-notes">{{ t('yarn.notes') }}</label>
      <textarea id="yarn-notes" v-model="form.notes" class="input" rows="3" :placeholder="t('yarn.notesPlaceholder')"></textarea>

      <div class="addform__actions">
        <button class="btn" @click="router.back()">{{ t('common.cancel') }}</button>
        <button class="btn btn--primary" :disabled="saving" @click="save">{{ t('common.save') }}</button>
      </div>
    </div>
  </main>

  <YarnWeightHelp :open="weightHelpOpen" @close="weightHelpOpen = false" />
  <ColorPickerDialog :open="colorPicker.open" :color="form.color" @pick="onPickCustom" @close="colorPicker.open = false" />
</div>
</template>

<style scoped>
.palette { display: flex; flex-wrap: wrap; gap: 6px; }
.req { color: var(--danger); }
.chips { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
.chip { border: 1px solid var(--line); background: var(--bg); color: var(--ink-55); font-weight: 600; font-size: 13px; padding: 0 13px; border-radius: var(--r-pill); min-height: 44px; display: inline-flex; align-items: center; }
.chip--on { background: var(--brand); border-color: var(--brand); color: var(--on-accent); }
.addform__section { margin: var(--sp-4) 0 var(--sp-2); font-weight: 700; color: var(--ink); font-size: 14.5px; }
.addform__grouplbl { margin: var(--sp-2) 0 var(--sp-1); font-size: 12.5px; font-weight: 700; color: var(--ink-55); }
/* Texte coloré, AUCUN fond — c'est le patron déjà en place (`.warn` de
   LocalPdfImportView.vue:242). `--warning` est défini dans les DEUX thèmes.
   ⚠️ Ne PAS poser un fond crème en dur : en mode sombre le texte `--ink` est clair. */
.veganwarn { margin-top: var(--sp-2); color: var(--warning); font-size: 13.5px; }
.palette__sw { width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--line); padding: 0; }
.palette__sw--on { border-color: var(--ink); box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--brand); }
.palette__cust { display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--ink-55); background: var(--bg); }
.palette__cust:focus-visible { outline: 2px solid var(--brand-deep); outline-offset: 2px; }
.addform__title { font-family: var(--font-display); font-weight: 600; font-size: 16px; margin: 0 0 var(--sp-2); }
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
</style>
