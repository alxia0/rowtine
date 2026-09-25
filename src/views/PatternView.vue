<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import PatternForm from '@/components/PatternForm.vue'
import PatternGallery from '@/components/PatternGallery.vue'
import BackToTop from '@/components/BackToTop.vue'
import { usePatternsStore } from '@/stores/patterns'
import { useSnackbarStore } from '@/stores/snackbar'
import { patternCategoryLabel } from '@/constants/catalog'
import { useSmartBack } from '@/composables/useSmartBack'
import { useLightboxStore } from '@/stores/lightbox'
import { slug, sizeLabelText } from '@/utils/reader'
import { openPdfExternally } from '@/utils/open-pdf'
import { useImportReportStore } from '@/stores/import-report'
import AppIcon from '@/components/AppIcon.vue'
import { warningText } from '@/utils/warning-i18n'
import { patternPriceState } from '@/utils/pattern-price'
import { formatLocalDate } from '@/utils/date-format'
import { formatMoney } from '@/utils/units'
import { patternCoverIndexOf } from '@/utils/pattern-cover'
import { sanitizeUrl } from '@/utils/safe-url'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const patternsStore = usePatternsStore()
const snackbar = useSnackbarStore()
const lightbox = useLightboxStore()
const importReport = useImportReportStore()
const pattern = ref(null)
// Défense en profondeur : l'URL est déjà assainie à l'import et à la restauration, on la
// refiltre à l'affichage pour une entité écrite en base avant ces gardes.
const safeAuthorUrl = computed(() => sanitizeUrl(pattern.value?.authorUrl))
const editing = ref(false)
// Warnings d'un import qui a navigué DIRECTEMENT ici (plus d'écran de
// revue post-conversion, cf. LocalPdfImportView). Consommés une seule
// fois au montage (cf. onMounted) ; fermer le bandeau vide juste cet état local, le
// store transitoire a déjà été vidé — jamais de réapparition. Bandeau, jamais
// snackbar : une snackbar disparaît seule, ce qui perdrait l'info (règle « jamais
// perdre d'info »).
const importWarnings = ref([])
// Qualité d'import faible (confidence.global < 50, cf. LocalPdfImportView) —
// même transport transitoire que les warnings, même bandeau, même fermeture manuelle.
const importLowConfidence = ref(false)
function dismissImportWarnings() {
  importWarnings.value = []
  importLowConfidence.value = false
}
const categoryLabel = (p) => patternCategoryLabel(p, t)

// Prix et date d'achat, en LECTURE SEULE : la saisie reste dans le formulaire du patron.
// Quatre tournures plutôt qu'une phrase à trou — « Acheté » ne va pas avec « Gratuit », et
// une construction unique imposerait la même grammaire aux quatre langues. Rien de noté =
// aucune ligne : une étiquette sans valeur est du bruit.
const priceLine = computed(() => {
  const p = pattern.value
  const st = patternPriceState(p)
  if (st.kind === 'none') return ''
  const date = formatLocalDate(p?.purchasedAt, locale.value)
  if (st.kind === 'free') return date ? t('pattern.priceFreeOn', { date }) : t('pattern.priceFree')
  const price = formatMoney(st.amount, { locale: locale.value, currency: st.currency, profile: 'detail' }).text
  return date ? t('pattern.priceBoughtOn', { price, date }) : t('pattern.priceBought', { price })
})
const goBack = useSmartBack({ name: 'library' })

onMounted(async () => {
  // Consommé EN PREMIER, avant tout await : route.params.id est dispo synchrone au
  // montage. Si on plaçait ce consume après `await patternsStore.get(...)` et que
  // l'utilisatrice quittait l'écran (retour/geste) pendant cette lecture IndexedDB,
  // la continuation async draînerait quand même le store (consume est destructif et
  // one-shot) sans jamais rendre le bandeau → warnings perdus DÉFINITIVEMENT. En
  // capturant avant l'await, la fenêtre de course disparaît (règle « jamais perdre
  // d'info »).
  const rep = importReport.consume(route.params.id)
  importWarnings.value = rep.warnings
  importLowConfidence.value = rep.lowConfidence
  pattern.value = await patternsStore.get(route.params.id)
  if (!pattern.value) { router.replace({ name: 'library' }); return }
  if (route.query.edit) editing.value = true
})

async function onUpdate(data) {
  await patternsStore.update(route.params.id, data)
  pattern.value = await patternsStore.get(route.params.id)
  editing.value = false
  snackbar.show(t('pattern.saved'))
  router.replace({ query: {} })
}
function createProject() {
  router.push({ name: 'project-new', query: { pattern: pattern.value.id } })
}
function preview() {
  router.push({ name: 'pattern-read', params: { id: pattern.value.id } })
}
async function openExternal() {
  snackbar.show(t('patternExtras.opening')) // accuse le tap immédiatement (ouverture native lente)
  try {
    await openPdfExternally(pattern.value.pdf, `${slug(pattern.value.name) || 'patron'}.pdf`)
  } catch {
    snackbar.show(t('patternExtras.openError'))
  }
}
// SEULE la photo source (i === 0, rendu de la 1re page du PDF importé) ouvre le PDF
// original quand il est disponible (#5, carte « PDF original » retirée, son action se
// déplace ici). Les autres photos (perso, ajoutées par l'utilisatrice) et tous les cas
// sans PDF stocké gardent la visionneuse plein écran — sinon une photo perso deviendrait
// non-zoomable.
function onPhotoClick(i) {
  if (i === 0 && pattern.value.pdf) openExternal()
  else lightbox.show(pattern.value.photos, i)
}
async function setCover(idx) {
  if (!pattern.value) return
  await patternsStore.update(pattern.value.id, { coverIndex: idx })
  pattern.value = await patternsStore.get(pattern.value.id)
}
</script>

<template>
<div>
  <div v-if="pattern">
    <header class="phdr">
      <button class="phdr__back" :aria-label="t('common.back')" @click="editing ? (editing = false) : goBack()"><AppIcon name="chevronLeft" :size="22" /></button>
      <h1 class="phdr__title">{{ pattern.name }}</h1>
      <button v-if="!editing" class="phdr__edit" :aria-label="t('common.edit')" @click="editing = true"><AppIcon name="edit" :size="18" /></button>
    </header>

    <main class="screen">
      <!-- Bandeau persistant, fermable : warnings d'un import qui a navigué direct
           ici. Volontairement PAS une snackbar (disparaîtrait seule =
           perte silencieuse, règle « jamais perdre d'info »). Visible en édition
           comme en lecture : ferme la fiche, pas le formulaire. -->
      <div v-if="importWarnings.length > 0 || importLowConfidence" class="iwarn" role="alert">
        <AppIcon name="warning" :size="18" class="iwarn__icon" />
        <div class="iwarn__body">
          <p class="iwarn__title">{{ t('pattern.importWarningsTitle') }}</p>
          <p v-if="importLowConfidence" class="iwarn__low">{{ t('pattern.importLowConfidence') }}</p>
          <ul v-if="importWarnings.length > 0" class="iwarn__list">
            <li v-for="(w, i) in importWarnings" :key="i">{{ warningText(w, t) }}</li>
          </ul>
        </div>
        <button type="button" class="iwarn__close" :aria-label="t('common.close')" @click="dismissImportWarnings">
          <AppIcon name="close" :size="16" />
        </button>
      </div>

      <PatternForm v-if="editing" :initial="pattern" :submit-label="t('common.save')" @submit="onUpdate" @cancel="editing = false" />

      <template v-else>
        <p class="meta">
          {{ t(`technique.${pattern.type}`) }}
          <template v-if="pattern.category"> · {{ categoryLabel(pattern) }}</template>
          <template v-if="pattern.sizes && pattern.sizes.length"> · {{ pattern.sizes.map((s) => sizeLabelText(s, t)).join(', ') }}</template>
        </p>
        <p v-if="pattern.author" class="author">
          {{ t('pattern.by') }} <strong>{{ pattern.author }}</strong>
          <a v-if="safeAuthorUrl" :href="safeAuthorUrl" target="_blank" rel="noopener" class="author__link">{{ t('pattern.authorUrl') }} ↗</a>
        </p>
        <p v-if="pattern.source" class="source">{{ t('pattern.source') }} : {{ pattern.source }}</p>
        <p v-if="priceLine" class="price" data-test="pattern-price-line">{{ priceLine }}</p>

        <div v-if="pattern.photos && pattern.photos.length" class="pphotos">
          <img
            v-for="(ph, i) in pattern.photos"
            :key="i"
            :src="ph"
            class="pphotos__img"
            alt=""
            @click="onPhotoClick(i)"
          />
        </div>
        <p v-if="pattern.photos && pattern.photos.length && pattern.pdf" class="hint">{{ t('pattern.tapSourceOpensPdf') }}</p>

        <button class="btn btn--primary btn--block mt" @click="createProject"><AppIcon name="plus" :size="17" /> {{ t('pattern.createProject') }}</button>
        <!-- Un patron créé manuellement sans section a quand même une galerie à
             requalifier en diagramme : Prévisualiser y mène aussi (l'action « Corriger
             le patron » vit dans cet écran, cf. reader-view-correct-entry.spec.js) — pas
             seulement quand reader.sections est déjà peuplé. -->
        <button
          v-if="pattern.reader?.sections?.length || pattern.gallery?.length"
          class="btn btn--block mt"
          @click="preview"
        >
          <AppIcon name="eye" :size="18" /> {{ t('pattern.preview') }}
        </button>
        <!-- État vide (préexistant) : un patron sans reader/sections ni galerie
             (ex. créé manuellement, PatternForm ne compose plus de reader) n'a rien à
             prévisualiser — on le dit plutôt que de ne rien afficher. -->
        <p v-else class="muted mt">{{ t('pattern.noSections') }}</p>

        <PatternGallery
          :images="pattern.gallery"
          :cover-index="patternCoverIndexOf(pattern)"
          :editable="!pattern.photos?.length"
          @set-cover="setCover"
        />

        <!-- Les tailles proposées sont affichées dans la ligne d'infos ci-dessus ;
             le suivi taille par taille se fait dans un projet (« Suivre le patron »). -->
      </template>
    </main>
    <!-- Écran à défilement de page (document) : pas de cible, même câblage que les 4
         autres écrans longs (stock, biblio, fiche projet, dépenses). -->
    <BackToTop />
  </div>
</div>
</template>

<style scoped>
/* Collant + fond opaque, comme .hdr (AppHeader) et .rhdr (ReaderView) : au défilement le
   retour, le titre et le bouton Modifier restent atteignables, et le contenu passe DESSOUS
   sans toucher la barre de statut. */
.phdr { position: sticky; top: 0; z-index: 40; background: var(--bg); display: flex; align-items: center; gap: var(--sp-2); padding: max(var(--sp-4), var(--sa-top)) max(var(--sp-4), var(--sa-right)) var(--sp-4) max(var(--sp-4), var(--sa-left)); max-width: var(--w-content); margin: 0 auto; }
.phdr__back, .phdr__edit { border: 1px solid var(--line); background: var(--tile); color: var(--ink); width: 44px; height: 44px; border-radius: var(--r-md); font-size: 18px; box-shadow: var(--clay-sm); flex-shrink: 0; }
.phdr__back:active, .phdr__edit:active { box-shadow: var(--clay-press); transform: scale(0.97); }
.phdr__back { font-size: 22px; }
.phdr__title { flex: 1; font-size: 21px; }
.meta { color: var(--ink-55); margin: 0 0 var(--sp-2); }
.author { color: var(--ink-70); font-size: 14px; margin: 0 0 var(--sp-2); }
.author__link { display: inline-block; margin-left: var(--sp-2); color: var(--brand-deep); font-weight: 600; text-decoration: none; }
.source { color: var(--ink-55); font-size: 13px; margin: 0 0 var(--sp-3); }
.price { color: var(--ink-55); font-size: 13px; margin: 0 0 var(--sp-3); }
.iwarn { display: flex; align-items: flex-start; gap: var(--sp-2); background: var(--tile); border: 1px solid var(--warning); border-radius: var(--r-md); box-shadow: var(--clay-sm); padding: var(--sp-3) var(--sp-3) var(--sp-3) var(--sp-4); margin-bottom: var(--sp-4); }
.iwarn__icon { color: var(--warning); flex-shrink: 0; margin-top: 2px; }
.iwarn__body { flex: 1; min-width: 0; }
.iwarn__title { font-weight: 700; font-size: 14px; color: var(--ink); margin: 0 0 4px; }
.iwarn__low { font-size: 13px; color: var(--ink-70); font-weight: 600; margin: 0 0 var(--sp-1); }
.iwarn__list { margin: 0; padding-left: 18px; font-size: 13.5px; color: var(--ink-70); line-height: 1.5; }
.iwarn__close { flex-shrink: 0; width: 32px; height: 32px; border: none; background: transparent; color: var(--ink-55); border-radius: var(--r-sm); }
.iwarn__close:active { background: var(--line-soft); }
.pphotos { display: flex; gap: var(--sp-2); overflow-x: auto; margin-bottom: var(--sp-3); }
.pphotos__img { width: 120px; height: 92px; object-fit: cover; border-radius: var(--r-sm); border: 1px solid var(--line); flex: none; cursor: pointer; }
.mt { margin-top: var(--sp-2); margin-bottom: var(--sp-4); }
.hint { color: var(--ink-55); font-size: 13px; }
.muted { color: var(--ink-55); }
</style>
