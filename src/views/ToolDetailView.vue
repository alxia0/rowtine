<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import SkeletonScreen from '@/components/SkeletonScreen.vue'
import { useToolsStore } from '@/stores/tools'
import { useProjectsStore } from '@/stores/projects'
import { useTrashStore } from '@/stores/trash'
import { useSettingsStore } from '@/stores/settings'
import { useSnackbarStore } from '@/stores/snackbar'
import { useSoftDelete } from '@/composables/useSoftDelete'
import { useDismissMenu } from '@/composables/useDismissMenu'
import { useSmartBack } from '@/composables/useSmartBack'
import { useCropperStore } from '@/stores/cropper'
import { useLightboxStore } from '@/stores/lightbox'
import { pickAndCropImage } from '@/utils/photo'
import { photosOf, coverPhotoOf, coverIndexAfterRemoval } from '@/utils/yarn-photos'
import { formatAmount, currencySymbol } from '@/utils/units'
import { priceCurrencyOf } from '@/utils/price-currency'
import { formatLocalDate } from '@/utils/date-format'
import { formatDecimalText, parseDecimal } from '@/utils/decimal'
import { TOOL_TYPES } from '@/constants/tools'
import { sizeScaleFor, sizeEquivalents } from '@/constants/needle-sizes'
import { toolSizes, sizeTemplateKey, cents, cableCountLabel, cableValue } from '@/utils/tool-list'
import { projectsUsingTool, kitPicksOf, kitTakenLive, kitCableUse } from '@/utils/tool-links'

// Fiche détail plein écran d'un outil (spec interne,
// « Fiche détail »). Même squelette que YarnDetailView.vue : en-tête, menu, galerie, lightbox.
// Un champ vide n'a pas de ligne ; un kit montre en plus la liste de ses tailles et câbles.
const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const toolsStore = useToolsStore()
const projectsStore = useProjectsStore()
const trashStore = useTrashStore()
const settings = useSettingsStore()
const snackbar = useSnackbarStore()
const softDelete = useSoftDelete()
const cropper = useCropperStore()
const lightbox = useLightboxStore()
const goBack = useSmartBack({ name: 'tools' })
const { open: menuOpen, triggerRef, menuRef } = useDismissMenu()

// Skeleton tant que le chargement n'a pas résolu : sans lui, « pas encore chargé » et
// « introuvable » rendraient le même écran vide.
const loading = ref(true)
onMounted(async () => {
  // Projets : seulement pour la section « Projets » ; un échec de lecture la laisse vide.
  if (!projectsStore.loaded) Promise.resolve(projectsStore.load()).catch(() => {})
  if (!toolsStore.loaded) await toolsStore.load()
  loading.value = false
})

const tool = computed(() => toolsStore.tools.find((x) => x.id === Number(route.params.id)) || null)
const def = computed(() => TOOL_TYPES[tool.value?.type] || TOOL_TYPES.other)
const num = (n) => formatDecimalText(String(n), locale.value)
const has = (v) => v !== '' && v != null

// « 4 mm · US 6 · UK 8 » pour une aiguille, « 4 mm · G/6 » pour un crochet. Une équivalence
// absente est omise ; hors table, il ne reste que les mm.
function sizeText(mm, { withUk = true } = {}) {
  const scale = sizeScaleFor(tool.value.type)
  const { us, uk } = sizeEquivalents(mm, scale, tool.value.material)
  const mmText = num(mm)
  if (us == null) return t('tools.sizeMm', { mm: mmText })
  if (scale === 'knitting' && withUk && uk != null) return t('tools.sizeLineUk', { mm: mmText, us, uk })
  return t(sizeTemplateKey(tool.value.type, us), { mm: mmText, us })
}

const typeLabel = computed(() => (tool.value ? t(`tools.types.${tool.value.type}`) : ''))
const title = computed(() => {
  const x = tool.value
  if (!x) return ''
  const sizes = toolSizes(x)
  const head = def.value.size === 'kit' || !sizes.length ? typeLabel.value : sizeText(sizes[0], { withUk: false })
  return [head, x.brand].filter(Boolean).join(' · ')
})

// Projets qui lient cet outil (le lien vit sur le projet : `toolIds`, ou une taille prise dans
// le kit, `kitPicks`), chacun ouvre sa fiche.
const usedBy = computed(() => {
  if (!tool.value) return []
  const id = tool.value.id
  const linked = new Set(projectsUsingTool(id, projectsStore.projects))
  return projectsStore.projects.filter((p) => linked.has(p) || kitPicksOf(p).some((pick) => pick.toolId === id))
})
function openProject(p) {
  router.push({ name: 'project', params: { id: p.id } })
}

// Une taille prise par un projet en cours porte son nom ; un câble pris dit combien et par qui.
const kitSizes = computed(() => {
  if (def.value.size !== 'kit') return []
  const taken = kitTakenLive(tool.value, projectsStore.projects)
  return toolSizes(tool.value).map((mm) => {
    const size = sizeText(mm, { withUk: false })
    const names = taken.filter((s) => cents(s.sizeMm) === cents(mm)).map((s) => s.projectName).filter(Boolean)
    return { mm, text: names.length ? t('tools.kitTakenSize', { size, name: names.join(', ') }) : size }
  })
})
const kitCables = computed(() => {
  if (def.value.size !== 'kit') return []
  return kitCableUse(tool.value, projectsStore.projects).map(({ cm, join, count, taken }) => {
    const cable = cableCountLabel({ cm, join }, count, t, num)
    const names = taken.filter(Boolean)
    return { key: cableValue({ cm, join }), text: taken.length ? t('tools.kitCableTaken', { cable, n: taken.length, names: names.join(', ') }) : cable }
  })
})

const rows = computed(() => {
  const x = tool.value || {}
  const out = []
  const push = (labelKey, value, symbol = settings.currency) => { if (has(value)) out.push({ labelKey, value, symbol }) }
  push('tools.fields.type', typeLabel.value)
  if (def.value.size !== 'kit' && has(x.sizeMm)) push('tools.fields.size', sizeText(Number(x.sizeMm)))
  const lengthKey = def.value.length === 'tip' ? 'tools.fields.tipLength' : 'tools.fields.length'
  if (has(x.lengthCm)) push(lengthKey, t('tools.lengthCm', { cm: num(x.lengthCm) }))
  else if (x.lengthKind) push(lengthKey, t(`tools.lengthKinds.${x.lengthKind}`))
  push('tools.fields.dpnCount', x.dpnCount)
  push('tools.fields.tunisianKind', x.tunisianKind ? t(`tools.tunisianKinds.${x.tunisianKind}`) : '')
  push('tools.fields.handle', x.handle ? t(`tools.handles.${x.handle}`) : '')
  push('tools.fields.material', x.material ? t(`tools.materials.${x.material}`) : '')
  push('tools.fields.brand', x.brand)
  push('tools.fields.line', x.line)
  push('tools.fields.quantity', x.quantity)
  push('tools.fields.purchasedAt', has(x.purchasedAt) ? formatLocalDate(x.purchasedAt, locale.value) : '')
  // Une saisie illisible comme nombre reste affichée telle quelle (jamais perdre d'info).
  const priceOk = has(x.price) && Number.isFinite(parseDecimal(x.price))
  push('tools.fields.price', priceOk ? formatAmount(x.price, { locale: locale.value }) : x.price, priceCurrencyOf(x, settings.currency))
  push('tools.fields.shop', x.shop)
  push('tools.fields.storedIn', x.storedIn)
  push('tools.fields.status', x.status ? t(`tools.statuses.${x.status}`) : '')
  push('tools.fields.notes', x.notes)
  return out
})

// --- Galerie : même motif que YarnDetailView.vue ---
const photos = computed(() => photosOf(tool.value))
const cover = computed(() => coverPhotoOf(tool.value))
const coverIndex = computed(() => tool.value?.coverIndex ?? 0)
async function addPhoto() {
  const dataUrl = await pickAndCropImage(cropper.crop)
  if (!dataUrl || !tool.value) return
  await toolsStore.update(tool.value.id, { photos: [...photos.value, dataUrl] })
}
async function removePhoto(idx) {
  if (!tool.value) return
  const next = [...photos.value]
  const [removed] = next.splice(idx, 1)
  const prevCoverIndex = coverIndex.value
  const id = tool.value.id
  await toolsStore.update(id, { photos: next, coverIndex: coverIndexAfterRemoval(idx, prevCoverIndex) })
  snackbar.show(t('photo.deleted'), {
    actionLabel: t('common.undo'),
    onAction: async () => {
      const restored = [...(toolsStore.tools.find((x) => x.id === id)?.photos || [])]
      restored.splice(idx, 0, removed)
      await toolsStore.update(id, { photos: restored, coverIndex: prevCoverIndex })
    },
  })
}
async function setCover(idx) {
  if (!tool.value) return
  await toolsStore.update(tool.value.id, { coverIndex: idx })
}

// --- Menu : Modifier / Dupliquer / Supprimer ---
function duplicate() {
  menuOpen.value = false
  router.push({ name: 'tool-new', query: { duplicateFrom: String(tool.value.id) } })
}
function edit() {
  menuOpen.value = false
  router.push({ name: 'tool-edit', params: { id: tool.value.id } })
}
async function remove() {
  menuOpen.value = false
  const id = tool.value.id
  // Retrait et mise en corbeille dans une même transaction (trash.js `moveToTrash`).
  const trashId = await trashStore.moveToTrash('tool', id)
  await toolsStore.load()
  router.replace({ name: 'tools' })
  if (trashId == null) return
  await softDelete('tool', null, { message: t('tools.deleted'), reload: toolsStore.load, trashId })
}
</script>

<template>
<div>
  <div v-if="tool">
    <header class="phdr">
      <button class="phdr__back" :aria-label="t('common.back')" @click="goBack"><AppIcon name="chevronLeft" :size="22" /></button>
      <div class="tdet__cover">
        <img v-if="cover" :src="cover" alt="" />
        <AppIcon v-else :name="def.icon" :size="26" />
      </div>
      <h1 class="phdr__title">{{ title }}</h1>
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
          <dt class="ydet__dt">{{ t(r.labelKey, { symbol: currencySymbol(r.symbol, locale) }) }}</dt>
          <dd class="ydet__dd">{{ r.value }}</dd>
        </template>
      </dl>

      <section v-if="kitSizes.length || kitCables.length" class="ydet__block">
        <h3 class="ydet__h3">{{ t('tools.kitContent') }}</h3>
        <template v-if="kitSizes.length">
          <p class="muted">{{ t('tools.fields.kitSizes') }}</p>
          <ul class="tdet__chips">
            <li v-for="s in kitSizes" :key="s.mm" data-test="kit-size">{{ s.text }}</li>
          </ul>
        </template>
        <template v-if="kitCables.length">
          <p class="muted">{{ t('tools.fields.kitCables') }}</p>
          <ul class="tdet__chips">
            <li v-for="c in kitCables" :key="c.key" data-test="kit-cable">{{ c.text }}</li>
          </ul>
        </template>
      </section>

      <section v-if="usedBy.length" class="ydet__block" data-test="tool-projects">
        <h2 class="ydet__h3">{{ t('tools.projects') }}</h2>
        <ul class="tdet__projects">
          <li v-for="p in usedBy" :key="p.id">
            <button type="button" class="tdet__project" data-test="tool-project" @click="openProject(p)">
              <span class="tdet__project-name">{{ p.name }}</span>
              <AppIcon name="chevronRight" :size="16" />
            </button>
          </li>
        </ul>
      </section>

      <h2 class="subhead">{{ t('tools.photoLabel') }}</h2>
      <button class="btn btn--primary btn--block" type="button" @click="addPhoto"><AppIcon name="plus" :size="17" /> {{ t('photo.add') }}</button>
      <div v-if="photos.length" class="pgrid">
        <div v-for="(ph, idx) in photos" :key="idx" class="pthumb">
          <button class="pthumb__open" :aria-label="t('photo.view', { n: idx + 1 })" type="button" @click="lightbox.show(photos, idx)">
            <img :src="ph" :alt="`${title} ${idx + 1}`" />
          </button>
          <span v-if="idx === coverIndex" class="pthumb__badge">{{ t('project.coverBadge') }}</span>
          <button v-else class="pthumb__cover" type="button" :aria-label="t('project.setCover')" @click="setCover(idx)"><AppIcon name="star" :size="16" /></button>
          <button class="pthumb__del" type="button" :aria-label="t('common.delete')" @click="removePhoto(idx)"><AppIcon name="close" :size="15" /></button>
        </div>
      </div>
      <p v-else class="muted photos__empty">{{ t('photo.empty') }}</p>
    </main>
  </div>

  <SkeletonScreen v-else-if="loading" variant="detail" />

  <div v-else class="screen notfound">
    <p class="muted">{{ t('tools.notFound') }}</p>
    <button class="btn btn--block mt" @click="goBack">{{ t('common.back') }}</button>
  </div>
</div>
</template>

<style scoped>
.phdr { position: sticky; top: 0; z-index: 40; background: var(--bg); display: flex; align-items: center; gap: var(--sp-2); padding: max(var(--sp-4), var(--sa-top)) max(var(--sp-4), var(--sa-right)) var(--sp-4) max(var(--sp-4), var(--sa-left)); max-width: var(--w-content); margin: 0 auto; }
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
/* `.muted` sert au message « introuvable » et aux textes d'appoint (photos vides, intitulés du kit). */
.muted { color: var(--ink-55); font-size: 14px; }
.mt { margin-top: var(--sp-3); }
.tdet__chips { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin: 0; padding: 0; list-style: none; }
.tdet__chips li { font-size: 12px; font-weight: 600; color: var(--ink); background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-pill); padding: 3px 10px; }
.tdet__cover { width: 44px; height: 44px; border-radius: var(--r-md); flex-shrink: 0; border: 1px solid var(--line); background: var(--tile); color: var(--ink-55); display: flex; align-items: center; justify-content: center; overflow: hidden; }
.tdet__cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.notfound { text-align: center; }
.tdet__projects { display: flex; flex-direction: column; gap: var(--sp-2); margin: 0; padding: 0; list-style: none; }
.tdet__project { display: flex; align-items: center; gap: var(--sp-2); width: 100%; min-height: 48px; padding: var(--sp-2) var(--sp-3); background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-md); box-shadow: var(--clay-sm); color: var(--ink); font: inherit; font-weight: 600; text-align: left; cursor: pointer; }
.tdet__project:focus-visible { outline: 2px solid var(--brand-deep); outline-offset: 2px; }
.tdet__project-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
