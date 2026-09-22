<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import ThumbImage from '@/components/ThumbImage.vue'
import SkeletonScreen from '@/components/SkeletonScreen.vue'
import { useYarnsStore } from '@/stores/yarns'
import { useProjectsStore } from '@/stores/projects'
import { useSettingsStore } from '@/stores/settings'
import { usePurchasesStore } from '@/stores/purchases'
import { useSnackbarStore } from '@/stores/snackbar'
import { useSoftDelete } from '@/composables/useSoftDelete'
import { useDismissMenu } from '@/composables/useDismissMenu'
import { useSmartBack } from '@/composables/useSmartBack'
import { useCropperStore } from '@/stores/cropper'
import { useLightboxStore } from '@/stores/lightbox'
import { pickAndCropImage } from '@/utils/photo'
import { photosOf, coverPhotoOf } from '@/utils/yarn-photos'
import { formatLength, formatWeight, currencySymbol } from '@/utils/units'
import { latestPurchaseDate, bainsOf } from '@/utils/purchases'
import { orderedLabels } from '@/constants/yarn-labels'
import { deduceOrigin } from '@/constants/fiber-origin'
import { compositionText } from '@/constants/compositions'
import { yarnUsageState } from '@/utils/yarn-usage'

// Fiche détail plein écran d'une laine — remplace le tiroir YarnDetailDialog.vue (motif
// « écran plein écran » de ProjectDetailView.vue). Additif : rien n'y navigue encore
// (StashView.vue garde son tiroir), cf. Task 4 du plan.
const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const yarnsStore = useYarnsStore()
const projectsStore = useProjectsStore()
const settings = useSettingsStore()
const purchasesStore = usePurchasesStore()
const snackbar = useSnackbarStore()
const softDelete = useSoftDelete()
const cropper = useCropperStore()
const lightbox = useLightboxStore()
const goBack = useSmartBack({ name: 'stash' })
const { open: menuOpen, triggerRef, menuRef } = useDismissMenu()

// `loading` : skeleton tant que `yarnsStore.load()` n'a pas résolu, même motif que
// ProjectDetailView.vue (loading/`SkeletonScreen`). Sans lui, une fiche pas encore chargée
// ET une fiche introuvable rendaient toutes les deux un écran vide (v-if="yarn" nu, sans
// v-else) — seul recours pour l'utilisateur : le geste système « retour ».
const loading = ref(true)
onMounted(async () => {
  const tasks = []
  if (!yarnsStore.loaded) tasks.push(yarnsStore.load())
  if (!projectsStore.loaded) tasks.push(projectsStore.load())
  await Promise.all(tasks)
  loading.value = false
})

const yarn = computed(() => yarnsStore.yarns.find((y) => y.id === Number(route.params.id)) || null)
const projectsById = computed(() => Object.fromEntries(projectsStore.projects.map((p) => [p.id, p])))
const usage = computed(() => (yarn.value ? yarnUsageState(yarn.value, projectsById.value) : { state: 'free', used: 0, total: 0 }))

// --- Rows / labels / origine : repris tel quel de YarnDetailDialog.vue ---
const purchaseLines = computed(() => purchasesStore.forYarn(yarn.value?.id) || [])
const rows = computed(() => {
  const y = yarn.value || {}
  const out = []
  const push = (labelKey, value) => { if (value !== '' && value != null && !(Array.isArray(value) && !value.length)) out.push({ labelKey, value }) }
  push('yarn.brand', y.brand)
  push('yarn.model', y.model)
  push('yarn.colorName', y.colorName)
  push('yarn.colorType', y.colorType && y.colorType !== 'uni' ? t(`yarn.colorTypes.${y.colorType}`) : '')
  push('yarn.colorNotes', y.colorNotes)
  push('yarn.weight', y.weight ? t(`yarn.weights.${y.weight}`) : '')
  const imperial = settings.unitSystem === 'imperial'
  const opts = { locale: locale.value, system: settings.unitSystem, profile: 'detail' }
  const len = y.lengthM ? formatLength(y.lengthM, opts) : null
  push(imperial ? 'yarn.lengthYd' : 'yarn.lengthM', len ? len.text : '')
  const wgt = y.grams ? formatWeight(y.grams, opts) : null
  push(imperial ? 'yarn.ounces' : 'yarn.grams', wgt ? wgt.text : '')
  push('yarn.quantity', y.quantity)
  push('yarn.priceWithSymbol', Number.isFinite(y.price) ? String(y.price).replace('.', ',') : y.price)
  const lines = purchaseLines.value
  if (lines.length) {
    push('yarn.purchasesCount', lines.length)
    push('yarn.bain', bainsOf(lines))
    push('yarn.lastPurchaseDate', latestPurchaseDate(lines))
  }
  push('yarn.composition', compositionText(y.composition, t))
  return out
})
const labels = computed(() => orderedLabels(yarn.value?.labels))
const origine = computed(() => deduceOrigin(yarn.value?.composition))
const origineTexte = computed(() => {
  const o = origine.value
  if (!o.key) return ''
  if (o.key !== 'melange') return t(`yarn.origin.${o.key}`)
  if (o.origins.length === 2 && o.origins.includes('animale') && o.origins.includes('vegetale'))
    return t('yarn.origin.melange')
  return o.origins.map((k) => t(`yarn.origin.${k}`)).join(' · ')
})
const usageLabel = computed(() => {
  const u = usage.value
  const base = t(`yarn.usage.${u.state}`)
  return u.state !== 'free' && u.used < u.total ? `${base} · ${u.used}/${u.total}` : base
})

// --- Galerie (ajout/suppression/couverture) : motif ProjectDetailView.vue:599-634 ---
const photos = computed(() => photosOf(yarn.value))
const coverIndex = computed(() => yarn.value?.coverIndex ?? 0)
async function addPhoto() {
  const dataUrl = await pickAndCropImage(cropper.crop)
  if (!dataUrl || !yarn.value) return
  // `photo: ''` : une fiche ANCIENNE (avant cette refonte) porte encore l'ancien champ
  // `photo` (chaîne unique) sans `photos` — sans ce reset, `photosOf()` (repli tolérant,
  // cf. src/utils/yarn-photos.js) continuerait de le lire en plus de la galerie fraîchement
  // écrite. Toute écriture de galerie doit désormais purger ce champ hérité.
  await yarnsStore.update(yarn.value.id, { photos: [...photos.value, dataUrl], photo: '' })
}
function coverIndexAfterRemoval(idx, ci) {
  if (idx === ci) return 0
  if (idx < ci) return ci - 1
  return ci
}
async function removePhoto(idx) {
  if (!yarn.value) return
  const next = [...photos.value]
  const [removed] = next.splice(idx, 1)
  const prevCoverIndex = coverIndex.value
  const nextCoverIndex = coverIndexAfterRemoval(idx, prevCoverIndex)
  const id = yarn.value.id
  // `photo: ''` : sans ce reset, une fiche ANCIENNE dont l'unique photo vivait dans
  // l'ex-champ `photo` verrait `photosOf()` y retomber aussitôt (repli tolérant, cf.
  // src/utils/yarn-photos.js) — la suppression du dernier cliché se déferait donc
  // silencieusement dès le rendu suivant.
  await yarnsStore.update(id, { photos: next, coverIndex: nextCoverIndex, photo: '' })
  snackbar.show(t('photo.deleted'), {
    actionLabel: t('common.undo'),
    onAction: async () => {
      const restored = [...(yarnsStore.yarns.find((y) => y.id === id)?.photos || [])]
      restored.splice(idx, 0, removed)
      await yarnsStore.update(id, { photos: restored, coverIndex: prevCoverIndex, photo: '' })
    },
  })
}
async function setCover(idx) {
  if (!yarn.value) return
  await yarnsStore.update(yarn.value.id, { coverIndex: idx })
}

// --- Kebab : Dupliquer / Modifier / Supprimer ---
function duplicate() {
  menuOpen.value = false
  router.push({ name: 'stash-new', query: { duplicateFrom: String(yarn.value.id) } })
}
function edit() {
  menuOpen.value = false
  router.push({ name: 'stash-edit', params: { id: yarn.value.id } })
}
async function remove() {
  menuOpen.value = false
  const id = yarn.value.id
  const y = await yarnsStore.remove(id)
  router.replace({ name: 'stash' })
  await softDelete('yarn', y, { message: t('yarn.deleted'), reload: yarnsStore.load })
}
</script>

<template>
<div>
  <div v-if="yarn">
    <header class="phdr">
      <button class="phdr__back" :aria-label="t('common.back')" @click="goBack"><AppIcon name="chevronLeft" :size="22" /></button>
      <ThumbImage :src="coverPhotoOf(yarn)" kind="yarn" :color="yarn.color" :seed="yarn.colorName || yarn.brand" :alt="`${yarn.brand} ${yarn.colorName}`" class="phdr__cover" />
      <h1 class="phdr__title">{{ yarn.brand || '—' }}<template v-if="yarn.model"> · {{ yarn.model }}</template><template v-if="yarn.colorName"> · {{ yarn.colorName }}</template></h1>
      <button ref="triggerRef" class="phdr__kebab" :aria-label="t('common.actions')" aria-haspopup="true" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen"><AppIcon name="kebab" :size="20" /></button>
      <Transition name="menu">
        <nav v-if="menuOpen" ref="menuRef" class="menu">
          <button class="menu__item" @click="edit">{{ t('common.edit') }}</button>
          <button class="menu__item" @click="duplicate">{{ t('common.duplicate') }}</button>
          <button class="menu__item menu__item--danger" @click="remove">{{ t('common.delete') }}</button>
        </nav>
      </Transition>
      <div v-if="menuOpen" class="menu__scrim" @click="menuOpen = false"></div>
    </header>

    <main class="screen">
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

      <h2 class="subhead">{{ t('yarn.photoLabel') }}</h2>
      <button class="btn btn--primary btn--block" type="button" @click="addPhoto"><AppIcon name="plus" :size="17" /> {{ t('photo.add') }}</button>
      <div v-if="photos.length" class="pgrid">
        <div v-for="(ph, idx) in photos" :key="idx" class="pthumb">
          <button class="pthumb__open" :aria-label="t('photo.view', { n: idx + 1 })" type="button" @click="lightbox.show(photos, idx)">
            <img :src="ph" :alt="`${yarn.brand} ${yarn.colorName} — ${idx + 1}`" />
          </button>
          <span v-if="idx === coverIndex" class="pthumb__badge">{{ t('project.coverBadge') }}</span>
          <button v-else class="pthumb__cover" type="button" :aria-label="t('project.setCover')" @click="setCover(idx)"><AppIcon name="star" :size="16" /></button>
          <button class="pthumb__del" type="button" :aria-label="t('common.delete')" @click="removePhoto(idx)"><AppIcon name="close" :size="15" /></button>
        </div>
      </div>
      <p v-else class="muted photos__empty">{{ t('photo.empty') }}</p>
    </main>
  </div>

  <!-- Chargement -->
  <SkeletonScreen v-else-if="loading" variant="detail" />

  <!-- Laine introuvable -->
  <div v-else class="screen notfound">
    <p class="muted">{{ t('yarn.notFound') }}</p>
    <button class="btn btn--block mt" @click="goBack">{{ t('common.back') }}</button>
  </div>
</div>
</template>

<style scoped>
.phdr { position: sticky; top: 0; z-index: 40; background: var(--bg); display: flex; align-items: center; gap: var(--sp-2); padding: max(var(--sp-4), var(--sa-top)) max(var(--sp-4), var(--sa-right)) var(--sp-4) max(var(--sp-4), var(--sa-left)); max-width: var(--w-content); margin: 0 auto; }
.phdr__cover { width: 44px; height: 44px; border-radius: var(--r-md); flex-shrink: 0; }
.phdr__title { flex: 1; min-width: 0; font-size: 21px; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.phdr__back, .phdr__kebab { border: 1px solid var(--line); background: var(--tile); color: var(--ink); width: 44px; height: 44px; border-radius: var(--r-md); font-size: 22px; box-shadow: var(--clay-sm); flex-shrink: 0; }
.phdr__back:active, .phdr__kebab:active { box-shadow: var(--clay-press); transform: scale(0.97); }
.menu { position: absolute; top: calc(56px + var(--sa-top)); right: max(var(--sp-4), var(--sa-right)); z-index: 60; background: var(--bg); border: 1px solid var(--line); border-radius: var(--r-md); box-shadow: var(--e-3); padding: var(--sp-2); min-width: 180px; display: flex; flex-direction: column; }
.menu__item { text-align: left; border: none; background: transparent; color: var(--ink); font-size: 15px; font-weight: 600; padding: 12px 14px; border-radius: var(--r-sm); }
.menu__item--danger { color: var(--danger); }
.menu__scrim { position: fixed; inset: 0; z-index: 50; }
.menu-enter-active, .menu-leave-active { transition: all var(--motion-fast); }
.menu-enter-from, .menu-leave-to { opacity: 0; transform: translateY(-6px); }
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
.subhead { font-family: var(--font-display); font-size: 15px; font-weight: 700; color: var(--ink); margin: var(--sp-4) 0 var(--sp-2); }
.pgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100px, 100%), 1fr)); gap: var(--sp-2); margin-top: var(--sp-3); }
.pthumb { position: relative; aspect-ratio: 1; border-radius: var(--r-md); overflow: hidden; border: 1px solid var(--line); box-shadow: var(--clay-sm); }
.pthumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pthumb__del { position: absolute; top: 4px; right: 4px; width: 28px; height: 28px; border: none; border-radius: 50%; background: rgba(58, 46, 40, 0.6); color: #fff; font-size: 12px; }
.pthumb__del::after { content: ''; position: absolute; inset: -10px; }
.pthumb__cover { position: absolute; top: 4px; left: 4px; width: 28px; height: 28px; border: none; border-radius: 50%; background: rgba(58, 46, 40, 0.6); color: #fff; font-size: 14px; }
.pthumb__cover::after { content: ''; position: absolute; inset: -10px; }
.pthumb__badge { position: absolute; top: 4px; left: 4px; padding: 3px 8px; border-radius: var(--r-pill); background: var(--brand-grad); color: var(--on-accent); font-size: 10.5px; font-weight: 700; letter-spacing: 0.2px; }
.photos__empty { margin-top: var(--sp-4); }
.pthumb__open { display: block; width: 100%; height: 100%; padding: 0; border: none; background: none; }
.screen { max-width: var(--w-content); margin: 0 auto; padding: 0 max(var(--sp-4), var(--sa-right)) max(var(--sp-4), var(--sa-bottom)) max(var(--sp-4), var(--sa-left)); }
/* État « introuvable » (revue finale, motif ProjectDetailView.vue). `.muted` était déjà
   utilisée plus haut (photos__empty) sans jamais être définie dans ce fichier — cette
   déclaration couvre les deux usages. */
.muted { color: var(--ink-55); font-size: 14px; }
.mt { margin-top: var(--sp-3); }
.notfound { text-align: center; }
</style>
