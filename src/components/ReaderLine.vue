<script setup>
// Une ligne d'instruction du lecteur : rend le texte en jetons (sans v-html) —
// chiffres multi-tailles filtrés selon la taille, abréviations cliquables (tooltip).
import { computed } from 'vue'
import { tokenizeLine, formatSizes, pickCount } from '@/utils/reader'

const props = defineProps({
  line: { type: Object, required: true },
  sizeIndex: { type: Number, default: null },
  abbrKeys: { type: Array, default: () => [] },
})
const emit = defineEmits(['abbr'])

const tokens = computed(() => tokenizeLine(props.line.t, props.line.c || [], props.abbrKeys))
// `pickCount` rend `null` quand `sizeIndex` sort du vecteur (taille mémorisée sur un patron
// qui a depuis PERDU des tailles : `st.size` est restauré sans être borné, ReaderView.vue:357).
// Sans ce repli, `String(null)` imprimait le mot « null » à la place du nombre de mailles —
// « Monter null m ». On retombe alors sur l'affichage multi-tailles, qui reste vrai.
const countText = (values) => {
  if (props.sizeIndex == null) return formatSizes(values)
  const picked = pickCount(values, props.sizeIndex)
  return picked == null ? formatSizes(values) : String(picked)
}

function onAbbr(e, key) {
  emit('abbr', { key, rect: e.target.getBoundingClientRect() })
}
</script>

<template>
  <component :is="line.note ? 'em' : 'span'" class="rl" :class="{ 'rl--note': line.note }">
    <template v-for="(tk, i) in tokens" :key="i">
      <span
        v-if="tk.type === 'count'"
        class="rl-num"
        :class="sizeIndex == null ? 'rl-num--all' : 'rl-num--picked'"
        >{{ countText(tk.values) }}</span
      >
      <button v-else-if="tk.type === 'abbr'" type="button" class="rl-abbr" @click="onAbbr($event, tk.key)">{{ tk.text }}</button>
      <template v-else>{{ tk.text }}</template>
    </template>
  </component>
</template>

<style scoped>
.rl--note {
  font-size: 13.5px;
  color: var(--ink-70);
  font-style: italic;
}
.rl-num {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.rl-num--all {
  color: var(--ink-55);
  /* aperçu multi-tailles : autoriser le retour à la ligne pour ne pas déborder de l'écran */
  overflow-wrap: anywhere;
}
.rl-num--picked {
  display: inline-block;
  /* pastille valeur unique : ne pas couper */
  white-space: nowrap;
  background: var(--sage-tile-bg);
  color: var(--sage-deep);
  border: 1px solid var(--sage-tile-line);
  border-radius: 8px;
  padding: 0 7px;
  line-height: 1.35;
}
/* l'abréviation est un bouton pour l'accessibilité, mais rendu comme du texte souligné */
.rl-abbr {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: help;
  border-bottom: 1.5px dotted var(--ink-40);
  text-underline-offset: 3px;
}
.rl-abbr:active {
  color: var(--brand-deep);
}
</style>
