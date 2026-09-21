<script setup>
import { computed } from 'vue'

// Signature de l'app : la progression rendue comme des mailles.
//  - tricot  → mailles jersey (des « V »)
//  - crochet → chaînette (boucles pointues jointives, trait fin)
// Mailles faites = pleines (terracotta, ou sauge via `tone`), restantes = traits fins.
const props = defineProps({
  technique: { type: String, default: 'knitting' }, // 'knitting' | 'crochet'
  done: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  tone: { type: String, default: 'brand' }, // 'brand' | 'sage'
})

const H = 13
const MAX = 40 // borne le nombre de mailles dessinées

const model = computed(() => {
  const total = Math.max(1, Number(props.total) || 1)
  const done = Math.min(total, Math.max(0, Number(props.done) || 0))
  const shown = Math.min(total, MAX)
  const doneShown = Math.round((done / total) * shown)
  const paths = []
  if (props.technique === 'crochet') {
    const a = 4.4, b = 5, step = 8.8, x0 = a + 1, cy = H / 2
    for (let i = 0; i < shown; i++) {
      const cx = x0 + i * step
      paths.push({ on: i < doneShown, d: `M${cx - a},${cy} Q${cx},${cy - b} ${cx + a},${cy} Q${cx},${cy + b} ${cx - a},${cy} Z` })
    }
    return { paths, width: (shown - 1) * step + a * 2 + 2 }
  }
  const w = 11, gap = 1.5, step = w + gap
  for (let i = 0; i < shown; i++) {
    const x = i * step
    paths.push({ on: i < doneShown, d: `M${x + 1},2 L${x + w / 2},${H - 1.5} L${x + w - 1},2` })
  }
  return { paths, width: shown * step }
})
</script>

<template>
  <span class="stitch" :class="[`stitch--${technique}`, `stitch--${tone}`]" aria-hidden="true">
    <svg :viewBox="`0 0 ${model.width} ${H}`" preserveAspectRatio="none">
      <path v-for="(s, i) in model.paths" :key="i" class="st" :class="{ on: s.on }" :d="s.d" />
    </svg>
  </span>
</template>

<style scoped>
.stitch { display: block; width: 100%; height: 15px; }
.stitch svg { display: block; width: 100%; height: 100%; overflow: visible; }
.st { fill: none; stroke: var(--ink-25); stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.st.on { stroke: var(--brand); stroke-width: 2.4; }
.stitch--sage .st.on { stroke: var(--sage); }
/* crochet (chaînette) : trait plus fin que le jersey */
.stitch--crochet .st { stroke-width: 1; }
.stitch--crochet .st.on { stroke-width: 1.6; }
</style>
