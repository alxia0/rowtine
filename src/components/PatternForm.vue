<script setup>
import { reactive, ref, computed, defineAsyncComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import FieldHelp from '@/components/FieldHelp.vue'
import { emptyPattern } from '@/stores/patterns'
import { PATTERN_CATEGORIES } from '@/constants/catalog'
import { TECHNIQUES as TECHS } from '@/constants/status'
import { pickAndCropImage, pickImage, resizeDataUrl } from '@/utils/photo'
import { useCropperStore } from '@/stores/cropper'
import { useSettingsStore } from '@/stores/settings'
import { useSnackbarStore } from '@/stores/snackbar'
import AppIcon from '@/components/AppIcon.vue'
import PatternPriceFields from '@/components/PatternPriceFields.vue'
// Chargement différé : PdfPagePickerDialog embarque PdfViewer → pdfjs-dist (lourd), on ne le
// charge que si le patron a un PDF (v-if="form.pdf" plus bas — le composant n'est même pas
// instancié sinon), même pattern que ProjectPdfGallery.vue. Sans ça, PatternForm — importé
// statiquement par LibraryView et PatternView — traînerait pdfjs-dist dans TOUT écran
// bibliothèque/patron, y compris pour un patron qui n'a aucun PDF.
const PdfPagePickerDialog = defineAsyncComponent(() => import('@/components/PdfPagePickerDialog.vue'))

// Formulaire patron partagé (création dans la bibliothèque, édition depuis la vue patron).
const props = defineProps({
  initial: { type: Object, default: null }, // patron existant à éditer ; null = création
  submitLabel: { type: String, default: '' },
})
const emit = defineEmits(['submit', 'cancel'])
const { t } = useI18n()
// Réglages (unitSystem) : choisit le libellé de l'échantillon (mailles/rangs par 10 cm vs
// par 4 po, cf. ProjectEditView). Composant embarqué dans des vues déjà atteintes via le
// router (garde qui a chargé les réglages) : aucun chargement propre ici, comme YarnCard.
const settings = useSettingsStore()
const snackbar = useSnackbarStore()

const seed = props.initial ? JSON.parse(JSON.stringify(props.initial)) : {}
const form = reactive({ ...emptyPattern(), ...seed })
const nameInput = ref(null)
const nameError = ref('')
const sizesText = ref((form.sizes || []).join(', '))
// Prix du patron (lot 07/08). Modèle local à deux champs : la DEVISE n'y est pas — elle est
// estampillée à l'enregistrement (ci-dessous), jamais rejouée à l'affichage, pour qu'un
// changement de devise dans les réglages ne réécrive pas rétroactivement un achat ancien.
const priceForm = reactive({ price: form.price || '', purchasedAt: form.purchasedAt || '' })
// Prix TEL QU'AU MONTAGE (jamais réactif) : seul repère pour savoir, à l'enregistrement, si
// LE PRIX a bougé — par opposition à n'importe quel autre champ de cette même fiche (nom,
// photo, auteur, catégorie...). Cf. commentaire de `submit()`.
const seedPriceStr = String(seed.price || '').trim()
// Le « Patron libre » est un gabarit UNIQUE partagé par tous les projets sans patron : jamais
// de prix dessus. Ce formulaire n'édite jamais de copie de travail, d'où le seul cas 'builtin'.
const priceHiddenReason = computed(() => (form.builtin ? 'builtin' : null))

// Libellés aiguilles/crochet adaptés à la technique (cf. ProjectEditView).
const isCrochet = computed(() => form.type === 'crochet')

const cropper = useCropperStore()
async function addPhoto() {
  const dataUrl = await pickAndCropImage(cropper.crop)
  if (dataUrl) form.photos.push(dataUrl)
}
function removePhoto(idx) {
  form.photos.splice(idx, 1)
}
// Galerie du patron (pattern.gallery) : ajout/suppression SEULEMENT, comme les photos
// ci-dessus (push/splice, validé au submit) — pas de transformation en diagramme ici, ce
// formulaire ne connaît pas `reader` (cf. CorrectionView.vue pour cette capacité).
//
// TROIS sources (retour terrain 25/08/2026, sources d'image élargies) :
// - `addGalleryImage` (caméra/galerie) : `pickImage`, PAS `pickAndCropImage` — une image de
//   galerie est souvent un schéma technique, un recadrage imposé risquerait de couper une
//   maille ou une légende.
// - `openFilePicker`/`onFilePicked` (fichiers) : `<input type="file">` ouvre le sélecteur
//   SYSTÈME (Fichiers/Drive/Téléchargements…), pas seulement Appareil photo/Galerie comme le
//   plugin Capacitor Camera — même mécanisme que l'import PDF/zip (LocalPdfImportView.vue).
//   Redimensionné via `resizeDataUrl` (même plafond que pickImage : 1280px/0.8) puisque ce
//   chemin ne passe PAS par le plugin natif qui réduit déjà côté Android.
// - `openPdfPicker`/`onPdfPagePicked` (PDF du patron) : SEULE source qui recadre — une page
//   de PDF rendue couvre presque toujours plus que le seul diagramme visé.
function pushGalleryImage(dataUrl) {
  form.gallery.push({ src: dataUrl, page: 0, w: 0, h: 0 })
}
async function addGalleryImage() {
  const dataUrl = await pickImage()
  if (dataUrl) pushGalleryImage(dataUrl)
}
function removeGalleryImage(idx) {
  form.gallery.splice(idx, 1)
}
const fileInputRef = ref(null)
function openFilePicker() {
  fileInputRef.value?.click()
}
async function onFilePicked(event) {
  const file = event.target.files?.[0]
  event.target.value = '' // permet de rechoisir le MÊME fichier plus tard (change ne se déclenche pas sinon)
  if (!file) return
  if (!file.type.startsWith('image/')) {
    snackbar.show(t('patternExtras.pickError'))
    return
  }
  try {
    const reader = new FileReader()
    const raw = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
    const resized = await resizeDataUrl(raw, 1280, 0.8)
    pushGalleryImage(resized)
  } catch {
    snackbar.show(t('patternExtras.pickError'))
  }
}
const pdfPickerOpen = ref(false)
function openPdfPicker() {
  pdfPickerOpen.value = true
}
async function onPdfPagePicked(pageDataUrl) {
  try {
    const cropped = await cropper.crop(pageDataUrl)
    if (cropped) pushGalleryImage(cropped)
  } catch {
    snackbar.show(t('patternExtras.pickError'))
  }
}
function submit() {
  if (!form.name.trim()) {
    nameError.value = t('pattern.nameRequired')
    nameInput.value?.focus()
    return
  }
  nameError.value = ''
  form.sizes = sizesText.value.split(',').map((s) => s.trim()).filter(Boolean)
  if (form.category !== 'other') form.categoryCustom = ''
  form.price = priceForm.price
  form.purchasedAt = priceForm.purchasedAt
  // Devise ré-estampillée à l'ÉCRITURE seulement si LE PRIX A CHANGÉ depuis le montage — pas
  // à chaque `submit()`. Ce formulaire sert aussi à modifier n'importe quel autre champ d'une
  // fiche patron déjà achetée (nom, photo, auteur, catégorie...) : sans cette garde, ouvrir la
  // fiche d'un patron payé 8,50 CHF pour y ajouter une photo, après avoir depuis basculé les
  // réglages sur EUR, réécrivait silencieusement `priceCurrency` en EUR — la ligne quittait le
  // total CHF de l'écran Dépenses pour le total EUR sans qu'aucun euro n'ait changé de main, à
  // l'inverse exact de ce que promet le message de confirmation du changement de devise
  // (« les prix déjà saisis ne seront pas convertis »). Même convention que les lignes d'achat
  // de laine (YarnPurchases.vue : `openEdit` préserve `line.currency`, seul `openAddMissing`
  // estampille) : ESTAMPILLER à la création, PRÉSERVER à l'édition. Prix vidé : toujours remis
  // à '' (un prix effacé ne doit garder la devise d'aucun achat) — ce cas prime sur la garde.
  const priceStr = String(priceForm.price || '').trim()
  if (!priceStr) {
    form.priceCurrency = ''
  } else if (priceStr !== seedPriceStr) {
    form.priceCurrency = settings.currency
  }
  const payload = JSON.parse(JSON.stringify(form))
  emit('submit', payload)
}
</script>

<template>
  <div class="card addform">
    <label class="field-label" for="pat-name">{{ t('pattern.name') }} <span class="req">*</span></label>
    <input
      id="pat-name"
      ref="nameInput"
      v-model="form.name"
      class="input"
      :class="{ 'input--err': nameError }"
      :aria-invalid="!!nameError"
      :placeholder="t('pattern.namePlaceholder')"
      @input="nameError = ''"
    />
    <p v-if="nameError" class="field-err" role="alert">{{ nameError }}</p>

    <p class="field-label mt2">{{ t('pattern.type') }} <span class="req">*</span></p>
    <div class="toggle">
      <button v-for="tech in TECHS" :key="tech" class="toggle__opt" :class="{ 'toggle__opt--on': form.type === tech }" @click="form.type = tech">
        {{ t(`technique.${tech}`) }}
      </button>
    </div>

    <FieldHelp class="mt2" :label="t('pattern.category')" :hint="t('pattern.categoryHint')" />
    <div class="chips">
      <button v-for="c in PATTERN_CATEGORIES" :key="c" class="chip" :class="{ 'chip--on': form.category === c }" @click="form.category = c">
        {{ t(`pattern.categories.${c}`) }}
      </button>
    </div>
    <input v-if="form.category === 'other'" v-model="form.categoryCustom" class="input mt2" :aria-label="t('pattern.categoryCustom')" :placeholder="t('pattern.categoryCustom')" />

    <FieldHelp class="mt2" for="pat-sizes" :label="t('pattern.sizes')" :hint="t('pattern.sizesHint')" />
    <input id="pat-sizes" v-model="sizesText" class="input" placeholder="S, M, L" />

    <div class="row mt2">
      <div class="col">
        <label class="field-label" for="pat-nmm">{{ isCrochet ? t('project.hookMm') : t('project.needleMm') }}</label>
        <input id="pat-nmm" v-model="form.needleMm" class="input" inputmode="decimal" placeholder="4.5" />
      </div>
      <div class="col">
        <label class="field-label" for="pat-nus">{{ isCrochet ? t('project.hookUs') : t('project.needleUs') }}</label>
        <input id="pat-nus" v-model="form.needleUs" class="input" :placeholder="isCrochet ? 'H / 5,0' : 'US 7'" />
      </div>
    </div>

    <div class="row mt2">
      <div class="col">
        <FieldHelp
          for="pat-gs"
          :label="settings.unitSystem === 'imperial' ? t('project.gaugeStitchesImperial') : t('project.gaugeStitches')"
          :hint="settings.unitSystem === 'imperial' ? t('project.gaugeHintImperial') : t('project.gaugeHint')"
        />
        <input id="pat-gs" v-model="form.gaugeStitches" class="input" inputmode="numeric" placeholder="20" />
      </div>
      <div class="col">
        <label class="field-label" for="pat-gr">{{ settings.unitSystem === 'imperial' ? t('project.gaugeRowsImperial') : t('project.gaugeRows') }}</label>
        <input id="pat-gr" v-model="form.gaugeRows" class="input" inputmode="numeric" placeholder="28" />
      </div>
    </div>

    <FieldHelp class="mt2" for="pat-source" :label="t('pattern.source')" :hint="t('pattern.sourceHint')" />
    <input id="pat-source" v-model="form.source" class="input" :placeholder="t('pattern.sourcePlaceholder')" />

    <label class="field-label mt2" for="pat-author">{{ t('pattern.author') }}</label>
    <input id="pat-author" v-model="form.author" class="input" :placeholder="t('pattern.authorPlaceholder')" />
    <label class="field-label mt2" for="pat-authorurl">{{ t('pattern.authorUrl') }}</label>
    <input id="pat-authorurl" v-model="form.authorUrl" class="input" inputmode="url" placeholder="https://…" />

    <!-- Pas de v-model ici : PatternPriceFields émet un OBJET NEUF à chaque frappe, et
         `v-model="priceForm"` compilerait en réaffectation de la variable — priceForm cesserait
         d'être le proxy reactive() dès la première frappe, et le champ resterait figé à l'écran
         sans que jamais un test ne le voie (constaté par mutation manuelle). Object.assign MUTE
         le même proxy en place : reactive, et submit() lit toujours le même objet. -->
    <PatternPriceFields
      :model-value="priceForm"
      :hidden-reason="priceHiddenReason"
      @update:model-value="Object.assign(priceForm, $event)"
    />

    <p class="field-label mt2">{{ t('photo.title') }}</p>
    <div class="photorow">
      <div v-for="(ph, idx) in form.photos" :key="idx" class="photorow__item">
        <img :src="ph" class="photorow__img" alt="" />
        <button type="button" class="photorow__del" :aria-label="t('common.delete')" @click="removePhoto(idx)"><AppIcon name="close" :size="15" /></button>
      </div>
      <button type="button" class="photorow__add" :aria-label="t('photo.add')" @click="addPhoto"><AppIcon name="plus" :size="22" /></button>
    </div>

    <p class="field-label mt2">{{ t('patternExtras.galleryTitle') }}</p>
    <div class="galleryrow">
      <div v-for="(g, idx) in form.gallery" :key="idx" class="galleryrow__item">
        <img :src="g.src" class="galleryrow__img" alt="" />
        <button type="button" class="galleryrow__del" :aria-label="t('common.delete')" @click="removeGalleryImage(idx)"><AppIcon name="close" :size="15" /></button>
      </div>
      <button type="button" class="galleryrow__add" :aria-label="t('patternExtras.addImageCamera')" @click="addGalleryImage"><AppIcon name="camera" :size="20" /></button>
      <button type="button" class="galleryrow__add" :aria-label="t('patternExtras.addImageFiles')" @click="openFilePicker"><AppIcon name="import" :size="20" /></button>
      <button v-if="form.pdf" type="button" class="galleryrow__add" :aria-label="t('patternExtras.addImagePdf')" @click="openPdfPicker"><AppIcon name="book" :size="20" /></button>
    </div>
    <!-- Caché visuellement (clip 1px, cf. .galleryrow__fileinput) mais TOUJOURS dans l'arbre
         d'accessibilité : sans nom accessible, axe le remonte « critical » (règle `label`,
         constatée au parcours e2e complet du 30/08). Le bouton « Parcourir les fichiers »
         porte le même libellé : l'input EST ce geste, déclenché par lui. -->
    <input ref="fileInputRef" type="file" accept="image/*" class="galleryrow__fileinput" :aria-label="t('patternExtras.addImageFiles')" @change="onFilePicked" />
    <PdfPagePickerDialog v-if="form.pdf" v-model:open="pdfPickerOpen" :pdf="form.pdf" @pick="onPdfPagePicked" />

    <div class="addform__actions">
      <button class="btn" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      <button class="btn btn--primary" @click="submit">{{ submitLabel || t('common.save') }}</button>
    </div>
  </div>
</template>

<style scoped>
/* Astérisque = TEXTE : dans la bande chaude claire --brand devient pâle (rendu
   « sombre-adapté », spec 08/09) — même reroutage que .req de tokens.css : --brand-deep
   reste sombre sur toute la roue. */
.req { color: var(--brand-deep); font-weight: 700; }
.mt2 { margin-top: var(--sp-2); }
.row { display: flex; gap: var(--sp-3); }
.col { flex: 1; }
.toggle { display: flex; gap: var(--sp-2); background: var(--bg); border: 1px solid var(--line); border-radius: var(--r-pill); padding: 4px; }
.toggle__opt { flex: 1; border: none; background: transparent; color: var(--ink-55); font-weight: 600; padding: 9px; border-radius: var(--r-pill); }
/* fond --sage : solide, ne suit PAS la teinte → texte clair statique --on-solid (jamais
   le --on-accent flippant de la bande chaude claire, spec 08/09) */
.toggle__opt--on { background: var(--sage); color: var(--on-solid); }
.chips { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
.chip { border: 1px solid var(--line); background: var(--bg); color: var(--ink-55); font-weight: 600; font-size: 13px; padding: 0 13px; border-radius: var(--r-pill); min-height: 44px; display: inline-flex; align-items: center; }
.chip--on { background: var(--brand); border-color: var(--brand); color: var(--on-accent); }
.photorow { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin-top: var(--sp-1); }
.photorow__item { position: relative; }
.photorow__img { width: 56px; height: 56px; object-fit: cover; border-radius: var(--r-sm); border: 1px solid var(--line); display: block; }
.photorow__del { position: absolute; top: -6px; right: -6px; width: 26px; height: 26px; border: none; border-radius: 50%; background: rgba(58, 46, 40, 0.7); color: #fff; font-size: 11px; }
.photorow__del::after { content: ''; position: absolute; inset: -9px; }
.photorow__add { width: 56px; height: 56px; border: 1px dashed var(--line); border-radius: var(--r-sm); background: var(--bg); color: var(--ink-55); font-size: 22px; }
.galleryrow { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin-top: var(--sp-2); }
.galleryrow__item { position: relative; }
.galleryrow__img { width: 56px; height: 56px; object-fit: cover; border-radius: var(--r-sm); display: block; }
.galleryrow__del { position: absolute; top: -6px; right: -6px; width: 26px; height: 26px; border-radius: 50%; background: var(--surface); border: 1px solid var(--line); display: flex; align-items: center; justify-content: center; }
.galleryrow__del::after { content: ''; position: absolute; inset: -9px; }
.galleryrow__add { width: 56px; height: 56px; border: 1px dashed var(--line); border-radius: var(--r-sm); display: flex; align-items: center; justify-content: center; background: var(--bg); color: var(--ink-55); }
.galleryrow__fileinput {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.addform__actions { display: flex; gap: var(--sp-3); margin-top: var(--sp-3); }
.addform__actions .btn { flex: 1; }
</style>
