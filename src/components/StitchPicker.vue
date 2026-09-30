<script setup>
// Sélecteur des points du mémo d'un patron : panneau du bas (même structure que
// ReaderSheet), recherche, suggestions tirées du glossaire du patron, cases par technique.
// Ne stocke rien : émet la nouvelle liste (ordre du catalogue), l'appelant l'écrit.
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/AppIcon.vue'
import AppCheckbox from '@/components/AppCheckbox.vue'
import { trapTabFocus, useDialogFocusReturn } from '@/composables/useFocusTrap'
import { CRAFTS, STITCH_CATALOG } from '@/content/stitch-memo/catalog'
import { resolveStitch, stitchesByGroup, suggestStitches, matchesQuery } from '@/content/stitch-memo'

const props = defineProps({
  open: { type: Boolean, default: false },
  pins: { type: Array, default: () => [] },
  craft: { type: String, default: 'knitting' }, // technique de l'onglet ouvert au départ
  abbrKeys: { type: Array, default: () => [] }, // clés du glossaire du patron
})
const emit = defineEmits(['update:open', 'update:pins'])
const { t, locale } = useI18n()

const tab = ref(props.craft)
const query = ref('')
const searchEl = ref(null)
// Chaque ouverture repart de la technique du patron, sans recherche résiduelle.
watch(
  () => props.open,
  (o) => {
    if (o) {
      tab.value = props.craft
      query.value = ''
      nextTick(() => searchEl.value?.focus())
    }
  },
)

const matches = (f) => matchesQuery(f, query.value)

const suggested = computed(() =>
  suggestStitches(props.abbrKeys)
    .map((id) => resolveStitch(id, locale.value))
    .filter((f) => f && matches(f)),
)
const groups = computed(() =>
  stitchesByGroup(tab.value, locale.value)
    .map((g) => ({ group: g.group, stitches: g.stitches.filter(matches) }))
    .filter((g) => g.stitches.length),
)
const nothing = computed(() => !suggested.value.length && !groups.value.length)

const ORDER = new Map(STITCH_CATALOG.map((s, i) => [s.id, i]))
function toggle(id, checked) {
  const next = checked ? [...props.pins, id] : props.pins.filter((x) => x !== id)
  next.sort((a, b) => (ORDER.get(a) ?? 0) - (ORDER.get(b) ?? 0))
  emit('update:pins', next)
}

// Échap ferme le sélecteur. stopPropagation : le keydown de la fenêtre (ReaderView) fermerait
// sinon l'aide-mémoire que la fermeture vient de rouvrir.
function onKeydown(e) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    emit('update:open', false)
    return
  }
  trapTabFocus(e)
}

useDialogFocusReturn(() => props.open)
</script>

<template>
  <div>
    <div class="sp-scrim" :class="{ 'sp-scrim--on': open }" @click="emit('update:open', false)"></div>
    <aside class="sp" :class="{ 'sp--on': open }" role="dialog" aria-modal="true" :aria-label="t('stitchMemo.title')" @keydown="onKeydown">
      <div class="sp__grip"></div>
      <div class="sp__head">
        <h2>{{ t('stitchMemo.title') }}</h2>
        <button class="sp__close" type="button" :aria-label="t('common.close')" @click="emit('update:open', false)"><AppIcon name="close" :size="18" /></button>
      </div>
      <div class="sp__search">
        <input ref="searchEl" v-model="query" type="search" class="sp__input" :aria-label="t('stitchMemo.search')" :placeholder="t('stitchMemo.search')" />
      </div>
      <div class="sp__tabs" role="tablist">
        <button
          v-for="c in CRAFTS"
          :key="c"
          class="sp__tab"
          :class="{ 'sp__tab--on': tab === c }"
          type="button"
          role="tab"
          :aria-selected="tab === c"
          @click="tab = c"
        >
          {{ t('stitchMemo.craft.' + c) }}
        </button>
      </div>
      <div class="sp__scroll">
        <section v-if="suggested.length" class="sp__group">
          <h3>{{ t('stitchMemo.suggested') }}</h3>
          <AppCheckbox v-for="f in suggested" :key="'s-' + f.id" :data-stitch="f.id" :model-value="pins.includes(f.id)" @update:model-value="toggle(f.id, $event)">
            <strong>{{ f.name }}</strong>
            <span v-if="f.abbr.length" class="sp__abbr">{{ f.abbr.join(', ') }}</span>
          </AppCheckbox>
        </section>
        <section v-for="g in groups" :key="g.group" class="sp__group">
          <h3>{{ t('stitchMemo.group.' + g.group) }}</h3>
          <AppCheckbox v-for="f in g.stitches" :key="f.id" :data-stitch="f.id" :model-value="pins.includes(f.id)" @update:model-value="toggle(f.id, $event)">
            <strong>{{ f.name }}</strong>
            <span v-if="f.abbr.length" class="sp__abbr">{{ f.abbr.join(', ') }}</span>
          </AppCheckbox>
        </section>
        <p v-if="nothing" class="sp__empty">{{ t('stitchMemo.noResult') }}</p>
      </div>
      <div class="sp__foot">
        <button class="sp__done" type="button" @click="emit('update:open', false)">{{ t('stitchMemo.done') }}</button>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.sp-scrim {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(58, 46, 40, 0.42);
  opacity: 0;
  visibility: hidden;
  transition: opacity var(--motion-base), visibility var(--motion-base);
}
.sp-scrim--on {
  opacity: 1;
  visibility: visible;
}
.sp {
  position: fixed;
  z-index: 51;
  left: 0;
  right: 0;
  bottom: 0;
  margin: 0 auto;
  max-width: 480px;
  background: var(--bg);
  border-radius: var(--r-lg) var(--r-lg) 0 0;
  box-shadow: var(--e-3);
  max-height: 92dvh;
  display: flex;
  flex-direction: column;
  transform: translateY(100%);
  visibility: hidden;
  transition: transform var(--motion-base), visibility var(--motion-base);
  padding-bottom: var(--sa-bottom);
}
.sp--on {
  transform: translateY(0);
  visibility: visible;
}
.sp__grip {
  width: 44px;
  height: 5px;
  border-radius: var(--r-pill);
  background: var(--ink-25);
  margin: var(--sp-3) auto var(--sp-2);
  flex: none;
}
.sp__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--sp-4) var(--sp-2);
}
.sp__head h2 {
  font-size: 18px;
}
.sp__close {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--surface);
  box-shadow: var(--clay-sm);
  font-size: 18px;
}
.sp__search {
  padding: 0 var(--sp-4) var(--sp-2);
  flex: none;
}
.sp__input {
  width: 100%;
  padding: 10px 14px;
  border-radius: var(--r-md);
  border: 1px solid var(--line);
  background: var(--surface);
  font-family: inherit;
  font-size: 14px;
}
.sp__tabs {
  display: flex;
  gap: var(--sp-2);
  padding: 0 var(--sp-4) var(--sp-3);
  overflow-x: auto;
  flex: none;
}
.sp__tab {
  flex: none;
  padding: 8px 14px;
  border-radius: var(--r-pill);
  background: var(--surface);
  box-shadow: var(--clay-sm);
  border: 1px solid var(--line);
  font-size: 13px;
  font-weight: 700;
  color: var(--ink-70);
}
.sp__tab--on {
  background: var(--brand);
  color: var(--on-accent);
  border-color: transparent;
}
.sp__scroll {
  overflow-y: auto;
  padding: 0 var(--sp-4) var(--sp-3);
  -webkit-overflow-scrolling: touch;
  flex: 1 1 auto;
}
.sp__group {
  margin-bottom: var(--sp-3);
}
.sp__group h3 {
  font-size: 15px;
  margin: 0 0 var(--sp-1);
}
.sp__abbr {
  margin-inline-start: var(--sp-2);
  color: var(--ink-70);
  font-size: 13px;
  overflow-wrap: anywhere;
}
.sp__empty {
  color: var(--ink-70);
  font-size: 14px;
}
.sp__foot {
  padding: var(--sp-2) var(--sp-4) var(--sp-3);
  flex: none;
}
.sp__done {
  width: 100%;
  padding: 12px 14px;
  border-radius: var(--r-md);
  background: var(--brand);
  color: var(--on-accent);
  font-weight: 700;
  font-size: 14px;
}
</style>
