<script setup>
// Page Outils « Mémo : techniques de points » : consultation libre du catalogue, sans patron.
// Rien n'est stocké ; seul l'état d'affichage (technique, recherche, fiches dépliées) vit ici.
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppHeader from '@/components/AppHeader.vue'
import AppIcon from '@/components/AppIcon.vue'
import { CRAFTS } from '@/content/stitch-memo/catalog'
import { stitchesByGroup, matchesQuery } from '@/content/stitch-memo'

const { t, locale } = useI18n()

const tab = ref('knitting')
const query = ref('')
const open = ref(new Set())

const groups = computed(() =>
  stitchesByGroup(tab.value, locale.value)
    .map((g) => ({ group: g.group, stitches: g.stitches.filter((f) => matchesQuery(f, query.value)) }))
    .filter((g) => g.stitches.length),
)

function toggle(id) {
  const next = new Set(open.value)
  if (!next.delete(id)) next.add(id)
  open.value = next
}
</script>

<template>
  <div>
    <AppHeader :title="t('stitchMemo.title')" back />
    <main class="screen">
      <input v-model="query" type="search" class="input" :aria-label="t('stitchMemo.search')" :placeholder="t('stitchMemo.search')" />
      <div class="toggle mt" role="tablist">
        <button
          v-for="c in CRAFTS"
          :key="c"
          class="toggle__opt"
          :class="{ 'toggle__opt--on': tab === c }"
          type="button"
          role="tab"
          :aria-selected="tab === c"
          @click="tab = c"
        >
          {{ t('stitchMemo.craft.' + c) }}
        </button>
      </div>

      <section v-for="g in groups" :key="g.group" class="grp">
        <h2 class="grp__title">{{ t('stitchMemo.group.' + g.group) }}</h2>
        <div v-for="f in g.stitches" :key="f.id" class="card st" :data-stitch="f.id">
          <button class="st__head" type="button" :aria-expanded="open.has(f.id) ? 'true' : 'false'" :aria-description="open.has(f.id) ? undefined : t('stitchMemo.expand')" @click="toggle(f.id)">
            <span class="st__names">
              <strong>{{ f.name }}</strong>
              <span v-if="f.abbr.length" class="st__abbr">{{ f.abbr.join(', ') }}</span>
            </span>
            <AppIcon class="st__chev" :class="{ 'st__chev--open': open.has(f.id) }" name="chevronRight" :size="16" aria-hidden="true" />
          </button>
          <div v-if="open.has(f.id)" class="st__body">
            <ol class="st__steps">
              <li v-for="(step, i) in f.steps" :key="i">{{ step }}</li>
            </ol>
            <p v-if="f.tip" class="st__tip">{{ f.tip }}</p>
          </div>
        </div>
      </section>
      <p v-if="!groups.length" class="muted mt2">{{ t('stitchMemo.noResult') }}</p>
    </main>
  </div>
</template>

<style scoped>
.toggle { display: flex; gap: var(--sp-2); background: var(--bg); border: 1px solid var(--line); border-radius: var(--r-pill); padding: 4px; }
.toggle__opt { flex: 1; border: none; background: transparent; color: var(--ink-55); font-weight: 600; padding: 10px; border-radius: var(--r-pill); }
.toggle__opt--on { background: var(--brand); color: var(--on-accent); }
.mt { margin-top: var(--sp-3); }
.mt2 { margin-top: var(--sp-5); }
.muted { color: var(--ink-55); }
.grp { margin-top: var(--sp-5); }
.grp__title { font-size: 17px; margin: 0 0 var(--sp-2); }
.st { padding: 0; margin-bottom: var(--sp-2); }
.st__head { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); width: 100%; padding: 12px var(--sp-3); border: none; background: transparent; text-align: left; color: var(--ink); min-height: 44px; }
.st__names { display: flex; flex-direction: column; min-width: 0; }
.st__abbr { color: var(--ink-70); font-size: 13px; overflow-wrap: anywhere; }
.st__chev { flex: none; color: var(--ink-55); transition: transform var(--motion-base); }
.st__chev--open { transform: rotate(90deg); }
.st__body { padding: 0 var(--sp-3) var(--sp-3); }
.st__steps { margin: 0; padding-left: 1.3em; }
.st__steps li { margin-bottom: var(--sp-1); }
.st__tip { margin: var(--sp-2) 0 0; color: var(--ink-55); font-size: 13px; }
</style>
