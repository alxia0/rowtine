<script setup>
// Écran « Mes outils » (spec interne, « Liste Mes
// outils ») : présentation par type ou par taille, pastilles des tailles possédées,
// recherche. Regroupements et filtre en JS pur dans src/utils/tool-list.js.
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
import AppIcon from '@/components/AppIcon.vue'
import BackToTop from '@/components/BackToTop.vue'
import SkeletonScreen from '@/components/SkeletonScreen.vue'
import ToolRow from '@/components/ToolRow.vue'
import { useToolsStore, emptyTool } from '@/stores/tools'
import { useProjectsStore } from '@/stores/projects'
import { TOOL_TYPES } from '@/constants/tools'
import { ownedSizes, filterTools, groupByType, groupBySize } from '@/utils/tool-list'
import { formatDecimalText } from '@/utils/decimal'
import { inUseProjectName, kitTakenLive } from '@/utils/tool-links'

const { t, locale } = useI18n()
const router = useRouter()
const store = useToolsStore()

const projectsStore = useProjectsStore()

onMounted(() => {
  if (!store.loaded) store.load()
  // Projets : seulement pour la mention « en cours » ; un échec de lecture la laisse absente.
  if (!projectsStore.loaded) Promise.resolve(projectsStore.load()).catch(() => {})
})

// Nom du projet en cours de chaque outil qui en a un (« en cours : <nom> » sur sa ligne).
const inUseBy = computed(() => new Map(store.tools.map((tool) => [tool.id, inUseProjectName(tool.id, projectsStore.projects)])))
// Tailles prises de chaque kit par les projets en cours (« en cours : 4 mm (Bonnet) », sans câble).
const kitTaken = computed(() => new Map(store.tools.filter((tool) => TOOL_TYPES[tool.type]?.size === 'kit').map((tool) => [tool.id, kitTakenLive(tool, projectsStore.projects)])))

// Choix « Par type / Par taille » retenu d'une visite à l'autre, sur cet appareil seulement.
// Stockage indisponible (navigation privée, quota) : on retombe sur « Par type ».
const VIEW_KEY = 'rowtine.tools.view'
function readView() {
  try {
    return localStorage.getItem(VIEW_KEY) === 'size' ? 'size' : 'type'
  } catch {
    return 'type'
  }
}
const view = ref(readView())
watch(view, (v) => {
  try {
    localStorage.setItem(VIEW_KEY, v)
  } catch {
    // choix non retenu, sans conséquence
  }
})

const search = ref('')
const sizeFilter = ref(null)
function toggleSize(mm) {
  sizeFilter.value = sizeFilter.value === mm ? null : mm
}
function clearAll() {
  search.value = ''
  sizeFilter.value = null
}

const sizeText = (mm) => t('tools.sizeMm', { mm: formatDecimalText(String(mm), locale.value) })
const sizes = computed(() => ownedSizes(store.tools))
const filtered = computed(() => filterTools(store.tools, { sizeMm: sizeFilter.value, query: search.value }))

// Par type : un intertitre de catégorie (Aiguilles, Kits, Crochets) au changement de
// catégorie, puis le titre du type. `groupByType` rend déjà les types dans l'ordre des
// catégories (TOOL_TYPE_ORDER). Une catégorie à un seul type n'en répète pas le titre (aujourd'hui aucune) :
// règle tirée de TOOL_TYPES, pas du stock possédé.
const TYPES_PER_CATEGORY = Object.values(TOOL_TYPES).reduce((acc, d) => ({ ...acc, [d.category]: (acc[d.category] || 0) + 1 }), {})
const typeGroups = computed(() =>
  groupByType(filtered.value).map((g, i, all) => ({
    ...g,
    categoryTitle: i === 0 || all[i - 1].category !== g.category ? t(`tools.categories.${g.category}`) : '',
    title: TYPES_PER_CATEGORY[g.category] > 1 ? t(`tools.types.${g.key}`) : '',
    level: 'h3',
    // Sous un filtre de taille, un kit se présente par la taille filtrée, comme en vue par taille.
    rows: g.items.map((tool) => ({ tool, sizeMm: sizeFilter.value, viaKit: false })),
  })),
)
// Par taille : sous un filtre de taille, seul le groupe de cette taille a un sens (un kit
// filtré sur 4 mm ne doit pas réapparaître sous 3,5 et 5 mm).
const sizeGroups = computed(() =>
  groupBySize(filtered.value)
    .filter((g) => sizeFilter.value == null || g.sizeMm === sizeFilter.value)
    .map((g) => ({
      ...g,
      categoryTitle: '',
      // Sans intertitre de catégorie, le titre de groupe suit directement le h1 de l'en-tête.
      level: 'h2',
      title: g.sizeMm != null ? sizeText(g.sizeMm) : t(`tools.groups.${g.key}`),
      rows: g.items.map(({ tool, viaKit }) => ({ tool, sizeMm: g.sizeMm, viaKit })),
    })),
)
const groups = computed(() => (view.value === 'size' ? sizeGroups.value : typeGroups.value))

function open(tool) {
  router.push({ name: 'tool', params: { id: tool.id } })
}

// Ligne d'exemple de l'écran vide, comme la carte d'exemple du stock de laine : jamais
// enregistrée, non interactive.
const EXAMPLE_TOOL = { ...emptyTool('circular'), sizeMm: 4, lengthCm: 80, material: 'bamboo' }
</script>

<template>
<div>
  <AppHeader :title="t('tools.title')" />
  <main class="screen">
    <SkeletonScreen v-if="!store.loaded" variant="detail" />
    <template v-else-if="store.tools.length">
      <div class="seg" role="group" :aria-label="t('tools.viewMode')">
        <button type="button" class="seg__btn" :aria-pressed="view === 'type'" @click="view = 'type'">{{ t('tools.byType') }}</button>
        <button type="button" class="seg__btn" :aria-pressed="view === 'size'" @click="view = 'size'">{{ t('tools.bySize') }}</button>
      </div>

      <div class="chips">
        <button
          v-for="mm in sizes"
          :key="mm"
          type="button"
          class="chip"
          :aria-pressed="sizeFilter === mm"
          :aria-label="t('tools.sizeFilter', { size: sizeText(mm) })"
          @click="toggleSize(mm)"
        >{{ sizeText(mm) }}</button>
      </div>

      <input v-model="search" type="search" class="input" :aria-label="t('tools.search')" :placeholder="t('tools.search')" />

      <button class="btn btn--primary add mt" @click="router.push({ name: 'tool-new' })"><AppIcon name="plus" :size="17" /> {{ t('tools.add') }}</button>

      <template v-for="g in groups" :key="g.key">
        <h2 v-if="g.categoryTitle" class="tcat">{{ g.categoryTitle }}</h2>
        <section class="tgroup">
          <component :is="g.level" v-if="g.title" class="tgroup__title">{{ g.title }}</component>
          <div class="tlist">
            <ToolRow
              v-for="r in g.rows"
              :key="`${g.key}-${r.tool.id}`"
              :tool="r.tool"
              :size-mm="r.sizeMm"
              :via-kit="r.viaKit"
              :in-use-by="inUseBy.get(r.tool.id)"
              :kit-taken="kitTaken.get(r.tool.id)"
              @open="open"
            />
          </div>
        </section>
      </template>

      <div v-if="!filtered.length" class="nomatch">
        <p class="muted">{{ t('tools.noMatch') }}</p>
        <button type="button" class="btn" data-test="tools-clear" @click="clearAll">{{ t('tools.clearSearch') }}</button>
      </div>
    </template>
    <div v-else class="empty-wrap">
      <button class="btn btn--primary add" @click="router.push({ name: 'tool-new' })"><AppIcon name="plus" :size="17" /> {{ t('tools.add') }}</button>
      <div class="texample" aria-hidden="true" inert>
        <span class="ex-badge">{{ t('common.example') }}</span>
        <ToolRow :tool="EXAMPLE_TOOL" />
      </div>
      <p class="empty-hint">{{ t('tools.empty') }}</p>
    </div>
  </main>
  <BackToTop />
</div>
</template>

<style scoped>
/* Reprend les surfaces et espacements de StashView.vue (Bento + Clay). */
.mt { margin-top: var(--sp-2); }
.add { width: 100%; white-space: nowrap; }
.seg { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-1); padding: var(--sp-1); margin-bottom: var(--sp-3); background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-pill); box-shadow: var(--clay-sm); }
.seg__btn { min-height: 44px; border: none; border-radius: var(--r-pill); background: transparent; color: var(--ink-55); font: inherit; font-weight: 600; cursor: pointer; }
.seg__btn[aria-pressed='true'] { background: var(--brand); color: var(--on-accent); }
.seg__btn:focus-visible, .chip:focus-visible { outline: 2px solid var(--brand-deep); outline-offset: 2px; }
/* Bandeau des tailles : défile à l'horizontale plutôt que de passer à la ligne. */
.chips { display: flex; gap: var(--sp-2); overflow-x: auto; padding-bottom: var(--sp-2); margin-bottom: var(--sp-2); scrollbar-width: none; }
.chip { flex-shrink: 0; min-height: 48px; padding: 0 var(--sp-3); border: 1px solid var(--line); border-radius: var(--r-pill); background: var(--tile); color: var(--ink); font: inherit; font-size: 14px; font-weight: 600; white-space: nowrap; cursor: pointer; }
.chip[aria-pressed='true'] { background: var(--brand); border-color: var(--brand); color: var(--on-accent); }
.tcat { margin-top: var(--sp-4); font-family: var(--font-display); font-size: 18px; font-weight: 600; color: var(--brand-deep); }
.tgroup { margin-top: var(--sp-3); }
.tgroup__title { font-size: 13px; font-weight: 700; color: var(--ink-55); margin-bottom: var(--sp-2); }
.tlist { display: flex; flex-direction: column; gap: var(--sp-2); }
.muted { color: var(--ink-55); }
.nomatch { margin-top: var(--sp-4); display: flex; flex-direction: column; align-items: flex-start; gap: var(--sp-2); }
.empty-wrap { margin-top: var(--sp-2); }
.texample { position: relative; margin-top: var(--sp-4); pointer-events: none; }
.texample .ex-badge { position: absolute; top: calc(-1 * var(--sp-2)); right: var(--sp-3); z-index: 1; background: var(--tile); }
.ex-badge { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: var(--ink-55); border: 1px dashed var(--line); border-radius: var(--r-pill); padding: 1px 8px; }
.empty-hint { color: var(--ink-55); font-size: 14px; text-align: center; max-width: 34ch; margin: var(--sp-3) auto 0; }
</style>
