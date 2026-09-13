<script setup>
import { computed } from 'vue'
import { ICONS } from '@/utils/icons'

const props = defineProps({
  // Clé du registre (@/utils/icons). Inconnue → repli sur 'pelote'.
  name: { type: String, required: true },
  // Taille du carré de rendu (px). Défaut aligné sur les glyphes UI qu'on remplace.
  size: { type: [Number, String], default: 20 },
  // Si fourni : l'icône porte le sens (role=img + aria-label). Sinon : décorative.
  label: { type: String, default: '' },
})

const def = computed(() => ICONS[props.name] || ICONS.pelote)

const svg = computed(() => {
  const d = def.value
  const vb = d.vb || '0 0 24 24'
  const sw = d.sw ?? 1.7
  const s = props.size
  return (
    `<svg viewBox="${vb}" width="${s}" height="${s}" fill="none" stroke="currentColor" ` +
    `stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" focusable="false">${d.body}</svg>`
  )
})
</script>

<template>
  <!-- v-html d'un <svg> COMPLET dans un <span> : le parseur HTML le place dans le bon
       namespace (le piège n'existe que si on injecte un <path> nu dans un <svg>).
       Contenu 100 % statique (registre) → pas de risque d'injection. -->
  <span
    class="app-icon"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
    v-html="svg"
  ></span>
</template>

<style scoped>
.app-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* aligne l'icône sur la ligne de base du texte adjacent (évite le décalage qui
     réintroduit l'effet « cheap » quand on remplace un emoji par un SVG). */
  vertical-align: -0.125em;
  line-height: 0;
  color: inherit;
  flex-shrink: 0;
}
.app-icon :deep(svg) {
  display: block;
}
</style>
