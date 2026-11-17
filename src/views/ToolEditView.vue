<script setup>
// Ajout et modification d'un outil (spec interne,
// « Formulaire »). Même squelette que YarnEditView.vue : formulaire vierge INCONDITIONNEL puis
// recouvert par la fiche éditée ou dupliquée, garde `saving`, snackbar.
// Le type se choisit d'abord ; seuls les champs de ce type s'affichent ensuite. Changer de type
// n'efface rien ici : la saisie survit à un aller-retour entre deux types, et c'est le store
// (`normalizeTool`) qui retire, à l'enregistrement, ce que le type retenu n'utilise pas.
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AppHeader from '@/components/AppHeader.vue'
import AppIcon from '@/components/AppIcon.vue'
import AppCheckbox from '@/components/AppCheckbox.vue'
import ToolKitPicker from '@/components/ToolKitPicker.vue'
import { useToolsStore, emptyTool } from '@/stores/tools'
import { useSnackbarStore } from '@/stores/snackbar'
import { useSettingsStore } from '@/stores/settings'
import { useCropperStore } from '@/stores/cropper'
import { pickAndCropImage } from '@/utils/photo'
import { photosOf, coverIndexAfterRemoval } from '@/utils/yarn-photos'
import { currencySymbol } from '@/utils/units'
import { hasPrice } from '@/utils/price-currency'
import { filtrerSaisieDecimale, parseDecimal, formatDecimalText } from '@/utils/decimal'
import {
  TOOL_TYPES, TOOL_TYPE_ORDER, TOOL_CATEGORIES, MATERIALS, HANDLES, TOOL_STATUSES,
  STRAIGHT_LENGTHS_CM, CIRCULAR_LENGTHS_CM, CABLE_LENGTHS_CM, DPN_LENGTHS, TIP_LENGTHS, TUNISIAN_KINDS,
} from '@/constants/tools'
import { sizesFor, sizeScaleFor, sizeEquivalents } from '@/constants/needle-sizes'
import { sizeTemplateKey, cablesOf } from '@/utils/tool-list'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const toolsStore = useToolsStore()
const snackbar = useSnackbarStore()
const settings = useSettingsStore()
const cropper = useCropperStore()

const isEdit = computed(() => !!route.params.id)
const form = reactive(emptyTool())
const saving = ref(false)
// « Autre taille… » : la taille se tape en mm au lieu d'être choisie dans la table.
const customSize = ref(false)

const typeGroups = TOOL_CATEGORIES.map((category) => ({
  category,
  types: TOOL_TYPE_ORDER.filter((k) => TOOL_TYPES[k].category === category),
}))
const def = computed(() => TOOL_TYPES[form.type] || null)
const scale = computed(() => sizeScaleFor(form.type))
const sizeChoices = computed(() => sizesFor(scale.value))
const DPN_COUNTS = [4, 5]
const num = (n) => formatDecimalText(String(n), locale.value)
const empty = (v) => v === '' || v == null
// Valeur d'un champ texte décimal : un nombre (venu d'une liste ou d'un autre type) prend le
// séparateur de la langue, une saisie en cours reste telle quelle.
const asText = (v) => (typeof v === 'number' ? num(v) : (v ?? ''))

// Taille lue comme le store la lira (virgule acceptée) : null si vide ou illisible.
function sizeNumber(v) {
  if (empty(v)) return null
  const n = parseDecimal(v)
  return Number.isFinite(n) ? n : null
}

// « 4 mm (US 6) » pour une aiguille, « 4 mm (G-6) » pour un crochet, « 2,25 mm (US 2) » pour
// un crochet en acier (la matière choisit l'équivalent), mm seuls sans équivalence.
function sizeLabel(mm) {
  const { us } = sizeEquivalents(mm, scale.value, form.material)
  if (us == null) return t('tools.sizeMm', { mm: num(mm) })
  return t(sizeTemplateKey(form.type, us, { option: true }), { mm: num(mm), us })
}

// Une taille hors de la table du type (taille libre, ou fine de crochet repassée sur une
// aiguille) ouvre d'elle-même la saisie libre : jamais un menu vide sur une valeur qui sera
// pourtant enregistrée.
const sizeOffTable = computed(() => {
  const n = sizeNumber(form.sizeMm)
  return n != null && !sizeChoices.value.includes(n)
})
const showFreeSize = computed(() => customSize.value || sizeOffTable.value)
const sizeSelect = computed({
  get: () => (showFreeSize.value ? '__other__' : (sizeNumber(form.sizeMm) ?? '')),
  set: (v) => {
    if (v === '__other__') {
      customSize.value = true
      form.sizeMm = empty(form.sizeMm) ? '' : num(form.sizeMm)
    } else {
      customSize.value = false
      form.sizeMm = v === '' ? null : v
    }
  },
})

// Saisie décimale libre (taille, longueur, prix) : chiffres et un séparateur seulement, la
// valeur filtrée est réécrite dans le champ (même parade que le prix de YarnEditView.vue).
function onFreeDecimal(field, event) {
  const clean = filtrerSaisieDecimale(event.target.value)
  event.target.value = clean
  form[field] = clean
}

// Liste fermée de longueurs en cm d'une sorte de longueur (null : pas de liste en cm).
function cmListFor(kind) {
  if (kind === 'straight') return STRAIGHT_LENGTHS_CM
  if (kind === 'circular') return CIRCULAR_LENGTHS_CM
  if (kind === 'cable') return CABLE_LENGTHS_CM
  return null
}

// Liste fermée de longueurs en cm ; une valeur venue d'ailleurs (restauration) reste proposée.
const closedLengths = computed(() => {
  const list = cmListFor(def.value?.length)
  if (!list) return null
  const current = sizeNumber(form.lengthCm)
  return current == null || list.includes(current) ? list : [...list, current].sort((a, b) => a - b)
})
const lengthKinds = computed(() => {
  const kind = def.value?.length
  return kind === 'dpn' ? DPN_LENGTHS : kind === 'tip' ? TIP_LENGTHS : null
})
const lengthLabel = computed(() => t(def.value?.length === 'tip' ? 'tools.fields.tipLength' : 'tools.fields.length'))

// Changer de type n'efface pas la saisie, sauf une longueur que la liste fermée du nouveau type
// ne propose pas : un <select> ne peut pas la montrer, elle serait enregistrée sans être vue.
function chooseType(type) {
  if (type === form.type) return
  form.type = type
  const kind = TOOL_TYPES[type]?.length
  const cmList = cmListFor(kind)
  if (cmList && !cmList.includes(sizeNumber(form.lengthCm))) form.lengthCm = null
  const kindList = kind === 'dpn' ? DPN_LENGTHS : kind === 'tip' ? TIP_LENGTHS : null
  if (kindList && !kindList.includes(form.lengthKind)) form.lengthKind = ''
}

// --- Photos : même motif que ToolDetailView.vue, mais sur le formulaire (enregistrées avec lui) ---
// En modification, la galerie n'est renvoyée au store QUE si elle a été touchée ici : la fiche
// détail l'édite directement, et un « Annuler » de retrait de photo peut la remettre en base
// après l'ouverture du formulaire ; la copie chargée à l'ouverture l'écraserait.
const photos = computed(() => photosOf(form))
const galleryTouched = ref(false)
async function addPhoto() {
  const dataUrl = await pickAndCropImage(cropper.crop)
  if (!dataUrl) return
  form.photos = [...photos.value, dataUrl]
  galleryTouched.value = true
}
function removePhoto(idx) {
  const next = [...photos.value]
  next.splice(idx, 1)
  form.coverIndex = coverIndexAfterRemoval(idx, form.coverIndex)
  form.photos = next
  galleryTouched.value = true
}
function setCover(idx) {
  form.coverIndex = idx
  galleryTouched.value = true
}

// Réaffichage d'une fiche : nombres au séparateur de la langue (les champs acceptent les deux).
function applyRecord(x) {
  Object.assign(form, emptyTool(x.type), x)
  delete form.id
  form.photos = [...photosOf(x)]
  form.kitSizes = [...(x.kitSizes || [])]
  form.kitCables = cablesOf(x)
  form.price = empty(x.price) ? '' : num(x.price)
  form.quantity = empty(x.quantity) ? '' : String(x.quantity)
  form.priceCurrency = x.priceCurrency || ''
  customSize.value = false
}
const applyExisting = applyRecord
// La duplication reprend tout sauf l'id et la galerie, comme `duplicateFrom` pour la laine
// (YarnEditView.vue) : la copie est un outil neuf, sans photo.
function applyDuplicate(x) {
  applyRecord(x)
  form.photos = []
  form.coverIndex = 0
}

// Formulaire vierge, AUCUN type choisi : `emptyTool()` pose 'circular' par défaut, ce qui
// afficherait les champs d'une circulaire avant tout choix.
function applyBlank() {
  Object.assign(form, emptyTool())
  delete form.id
  form.type = ''
  customSize.value = false
  galleryTouched.value = false
}

onMounted(async () => {
  if (!toolsStore.loaded) await toolsStore.load()
  // Vierge D'ABORD, inconditionnellement (même garde que YarnEditView.vue) : un
  // `duplicateFrom` périmé ne trouve pas de fiche et laisse ce formulaire vierge.
  applyBlank()
  if (route.params.id) {
    const x = toolsStore.tools.find((tt) => tt.id === Number(route.params.id))
    if (x) applyExisting(x)
  } else if (route.query.duplicateFrom) {
    const x = toolsStore.tools.find((tt) => tt.id === Number(route.query.duplicateFrom))
    if (x) applyDuplicate(x)
  }
})

// Quantité : chiffres seulement, la valeur filtrée est réécrite dans le champ.
function onQuantityInput(event) {
  const clean = event.target.value.replace(/\D/g, '')
  event.target.value = clean
  form.quantity = clean
}
// Devise du prix : celle déjà posée sur la fiche, sinon celle des réglages.
const priceSymbol = computed(() => currencySymbol(form.priceCurrency || settings.currency, locale.value))

function normalizedQuantity(raw) {
  if (empty(raw)) return 1
  const n = parseDecimal(raw)
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 1
}

async function save() {
  if (saving.value) return
  saving.value = true
  try {
    if (!def.value) {
      snackbar.show(t('tools.form.typeRequired'))
      return
    }
    // Une taille de 0 mm (ou négative) n'est pas une taille.
    const size = sizeNumber(form.sizeMm)
    if (def.value.size === 'required' && !(size > 0)) {
      snackbar.show(t('tools.sizeRequired'))
      return
    }
    const payload = {
      ...form,
      price: empty(form.price) || !Number.isFinite(parseDecimal(form.price)) ? '' : parseDecimal(form.price),
      quantity: normalizedQuantity(form.quantity),
    }
    payload.priceCurrency = hasPrice(payload.price) ? form.priceCurrency || settings.currency : ''
    delete payload.id
    if (isEdit.value && !galleryTouched.value) {
      delete payload.photos
      delete payload.coverIndex
    }
    if (isEdit.value) {
      await toolsStore.update(route.params.id, payload)
      snackbar.show(t('tools.form.updated'))
      router.replace({ name: 'tool', params: { id: route.params.id } })
    } else {
      const id = await toolsStore.add(payload)
      router.replace({ name: 'tool', params: { id } })
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
<div>
  <AppHeader :title="isEdit ? t('tools.form.editTitle') : t('tools.add')" back />
  <main class="screen">
    <div class="card addform">
      <h2 class="addform__section">{{ t('tools.form.sections.type') }}</h2>
      <fieldset v-for="g in typeGroups" :key="g.category" class="tgroup" :data-test="`type-group-${g.category}`">
        <legend class="addform__grouplbl">{{ t(`tools.categories.${g.category}`) }}</legend>
        <div class="types">
          <button
            v-for="k in g.types"
            :key="k"
            type="button"
            class="typebtn"
            :class="{ 'typebtn--on': form.type === k }"
            :aria-pressed="form.type === k ? 'true' : 'false'"
            :data-test="`type-${k}`"
            @click="chooseType(k)"
          ><AppIcon :name="TOOL_TYPES[k].icon" :size="20" /><span>{{ t(`tools.types.${k}`) }}</span></button>
        </div>
      </fieldset>

      <template v-if="def">
        <h2 class="addform__section">{{ t('tools.form.sections.size') }}</h2>
        <template v-if="def.size === 'required' || def.size === 'optional'">
          <label class="field-label" for="tool-size">{{ t('tools.fields.size') }} <span v-if="def.size === 'required'" class="req">*</span></label>
          <select id="tool-size" v-model="sizeSelect" class="input">
            <option value="">{{ t('tools.form.sizePick') }}</option>
            <option v-for="mm in sizeChoices" :key="mm" :value="mm">{{ sizeLabel(mm) }}</option>
            <option value="__other__">{{ t('tools.form.sizeOther') }}</option>
          </select>
          <input v-if="showFreeSize" id="tool-size-free" :value="asText(form.sizeMm)" class="input mt2" inputmode="decimal" :aria-label="t('tools.sizeFree')" :placeholder="t('tools.sizeFree')" @input="onFreeDecimal('sizeMm', $event)" />
        </template>
        <AppCheckbox v-if="def.tunisianFlag" data-test="kit-tunisian" v-model="form.tunisian" class="mt2">{{ t('tools.fields.tunisianKit') }}</AppCheckbox>
        <ToolKitPicker v-if="def.size === 'kit'" v-model:sizes="form.kitSizes" v-model:cables="form.kitCables" :scale="scale" :material="form.material" :show-cables="!def.tunisianFlag || form.tunisian" />

        <template v-if="closedLengths">
          <label class="field-label mt2" for="tool-length">{{ lengthLabel }}</label>
          <select id="tool-length" v-model="form.lengthCm" class="input">
            <option :value="null">{{ t('tools.form.unset') }}</option>
            <option v-for="cm in closedLengths" :key="cm" :value="cm">{{ t('tools.lengthCm', { cm: num(cm) }) }}</option>
          </select>
        </template>
        <template v-else-if="lengthKinds">
          <label class="field-label mt2" for="tool-length-kind">{{ lengthLabel }}</label>
          <select id="tool-length-kind" v-model="form.lengthKind" class="input">
            <option value="">{{ t('tools.form.unset') }}</option>
            <option v-for="k in lengthKinds" :key="k" :value="k">{{ t(`tools.lengthKinds.${k}`) }}</option>
          </select>
        </template>
        <template v-else-if="def.length === 'free'">
          <label class="field-label mt2" for="tool-length-free">{{ t('tools.form.lengthCm') }}</label>
          <input id="tool-length-free" :value="asText(form.lengthCm)" class="input" inputmode="decimal" @input="onFreeDecimal('lengthCm', $event)" />
        </template>

        <template v-if="def.count">
          <label class="field-label mt2" for="tool-dpn-count">{{ t('tools.fields.dpnCount') }}</label>
          <select id="tool-dpn-count" v-model="form.dpnCount" class="input">
            <option :value="null">{{ t('tools.form.unset') }}</option>
            <option v-for="n in DPN_COUNTS" :key="n" :value="n">{{ n }}</option>
          </select>
        </template>
        <template v-if="def.tunisianKind">
          <label class="field-label mt2" for="tool-tunisian-kind">{{ t('tools.fields.tunisianKind') }}</label>
          <select id="tool-tunisian-kind" v-model="form.tunisianKind" class="input">
            <option value="">{{ t('tools.form.unset') }}</option>
            <option v-for="k in TUNISIAN_KINDS" :key="k" :value="k">{{ t(`tools.tunisianKinds.${k}`) }}</option>
          </select>
        </template>
        <template v-if="def.handle">
          <label class="field-label mt2" for="tool-handle">{{ t('tools.fields.handle') }}</label>
          <select id="tool-handle" v-model="form.handle" class="input">
            <option value="">{{ t('tools.form.unset') }}</option>
            <option v-for="k in HANDLES" :key="k" :value="k">{{ t(`tools.handles.${k}`) }}</option>
          </select>
        </template>

        <h2 class="addform__section">{{ t('tools.form.sections.material') }}</h2>
        <label class="field-label" for="tool-material">{{ t('tools.fields.material') }}</label>
        <select id="tool-material" v-model="form.material" class="input">
          <option value="">{{ t('tools.form.unset') }}</option>
          <option v-for="m in MATERIALS" :key="m" :value="m">{{ t(`tools.materials.${m}`) }}</option>
        </select>
        <div class="row row--fields mt2">
          <div class="col"><label class="field-label" for="tool-brand">{{ t('tools.fields.brand') }}</label><input id="tool-brand" v-model="form.brand" class="input" /></div>
          <div class="col"><label class="field-label" for="tool-line">{{ t('tools.fields.line') }}</label><input id="tool-line" v-model="form.line" class="input" /></div>
        </div>

        <h2 class="addform__section">{{ t('tools.form.sections.purchase') }}</h2>
        <div class="row row--fields">
          <div class="col"><label class="field-label" for="tool-quantity">{{ t('tools.fields.quantity') }}</label><input id="tool-quantity" :value="form.quantity" class="input" inputmode="numeric" placeholder="1" @input="onQuantityInput" /></div>
          <div class="col"><label class="field-label" for="tool-price">{{ t('tools.fields.price', { symbol: priceSymbol }) }}</label><input id="tool-price" :value="form.price" class="input" inputmode="decimal" @input="onFreeDecimal('price', $event)" /></div>
        </div>
        <label class="field-label mt2" for="tool-purchased-at">{{ t('tools.fields.purchasedAt') }}</label>
        <input id="tool-purchased-at" v-model="form.purchasedAt" type="date" class="input" />
        <label class="field-label mt2" for="tool-shop">{{ t('tools.fields.shop') }}</label>
        <input id="tool-shop" v-model="form.shop" class="input" />
        <label class="field-label mt2" for="tool-stored-in">{{ t('tools.fields.storedIn') }}</label>
        <input id="tool-stored-in" v-model="form.storedIn" class="input" />
        <label class="field-label mt2" for="tool-status">{{ t('tools.fields.status') }}</label>
        <select id="tool-status" v-model="form.status" class="input">
          <option v-for="s in TOOL_STATUSES" :key="s" :value="s">{{ t(`tools.statuses.${s}`) }}</option>
        </select>

        <h2 class="addform__section">{{ t('tools.form.sections.photos') }}</h2>
        <button class="btn btn--block" type="button" data-test="tool-add-photo" @click="addPhoto"><AppIcon name="plus" :size="17" /> {{ t('photo.add') }}</button>
        <div v-if="photos.length" class="pgrid">
          <div v-for="(ph, idx) in photos" :key="idx" class="pthumb">
            <img :src="ph" alt="" />
            <span v-if="idx === form.coverIndex" class="pthumb__badge">{{ t('project.coverBadge') }}</span>
            <button v-else class="pthumb__cover" type="button" data-test="tool-photo-cover" :aria-label="t('project.setCover')" @click="setCover(idx)"><AppIcon name="star" :size="16" /></button>
            <button class="pthumb__del" type="button" data-test="tool-photo-remove" :aria-label="t('common.delete')" @click="removePhoto(idx)"><AppIcon name="close" :size="15" /></button>
          </div>
        </div>
        <label class="field-label mt2" for="tool-notes">{{ t('tools.fields.notes') }}</label>
        <textarea id="tool-notes" v-model="form.notes" class="input" rows="3"></textarea>
      </template>

      <div class="addform__actions">
        <button class="btn" type="button" @click="router.back()">{{ t('common.cancel') }}</button>
        <button v-if="def" class="btn btn--primary" type="button" data-test="tool-save" :disabled="saving" @click="save">{{ t('common.save') }}</button>
      </div>
    </div>
  </main>
</div>
</template>

<style scoped>
.req { color: var(--danger); }
.addform { margin-top: var(--sp-2); }
.addform__section { margin: var(--sp-4) 0 var(--sp-2); font-family: inherit; font-weight: 700; color: var(--ink); font-size: 14.5px; }
.addform__section:first-child { margin-top: 0; }
.tgroup { border: 0; margin: 0; padding: 0; min-width: 0; }
.tgroup legend { padding: 0; }
.addform__grouplbl { margin: var(--sp-2) 0 var(--sp-1); font-size: 12.5px; font-weight: 700; color: var(--ink-55); }
.addform__actions { display: flex; gap: var(--sp-3); margin-top: var(--sp-3); }
.addform__actions .btn { flex: 1; }
.types { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(140px, 100%), 1fr)); gap: var(--sp-2); }
.typebtn { display: flex; align-items: center; gap: var(--sp-2); min-height: 44px; padding: 6px 12px; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--bg); color: var(--ink); font-weight: 600; font-size: 13.5px; text-align: left; }
.typebtn--on { background: var(--brand); border-color: var(--brand); color: var(--on-accent); }
.mt2 { margin-top: var(--sp-2); }
.row { display: flex; gap: var(--sp-3); }
.col { flex: 1; min-width: 0; }
.row--fields { align-items: flex-end; }
select.input { font-family: var(--font-ui); }
.pgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100px, 100%), 1fr)); gap: var(--sp-2); margin-top: var(--sp-3); }
.pthumb { position: relative; aspect-ratio: 1; border-radius: var(--r-md); overflow: hidden; border: 1px solid var(--line); }
.pthumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pthumb__del, .pthumb__cover { position: absolute; top: 4px; width: 28px; height: 28px; border: none; border-radius: 50%; background: rgba(58, 46, 40, 0.6); color: #fff; }
.pthumb__del { right: 4px; }
.pthumb__cover { left: 4px; }
/* Zone de toucher portée à 48 px autour de la pastille de 28 px. */
.pthumb__del::after, .pthumb__cover::after { content: ''; position: absolute; inset: -10px; }
.pthumb__badge { position: absolute; top: 4px; left: 4px; padding: 3px 8px; border-radius: var(--r-pill); background: var(--brand-grad); color: var(--on-accent); font-size: 10.5px; font-weight: 700; }
</style>
