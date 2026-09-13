<script setup>
import { computed } from 'vue'
import { swatchTones, tonesFromColor } from '@/constants/swatch'

// Vignette d'aperçu pour les listes (laines, projets, patrons).
// - Si une photo existe (data URL), on l'affiche.
// - Sinon, on génère un « échantillon tricoté » : un fond teinté + un motif de mailles
//   jersey (des V) en SVG, dans une couleur dérivée de l'élément (cf. swatch.js).
const props = defineProps({
  src: { type: String, default: '' }, // 1re photo de la fiche, si disponible
  kind: { type: String, default: 'project' }, // 'yarn' | 'project' | 'pattern'
  seed: { type: String, default: '' }, // texte source de la couleur (coloris / nom)
  color: { type: String, default: '' }, // couleur explicite (laine, chaîne hsl) — prioritaire
  alt: { type: String, default: '' },
})

const tones = computed(() => (props.color && tonesFromColor(props.color)) || swatchTones(props.kind, props.seed))
// id de motif unique et stable pour éviter les collisions entre plusieurs SVG sur la page.
const pid = computed(() => 'knit-' + props.kind + '-' + Math.abs(hashStr(props.seed + tones.value.base)).toString(36))

function hashStr(s) {
  let h = 0
  for (let i = 0; i < String(s).length; i++) h = (Math.imul(31, h) + String(s).charCodeAt(i)) | 0
  return h
}
</script>

<template>
  <div class="thumb" :class="`thumb--${kind}`">
    <img v-if="src" class="thumb__img" :src="src" :alt="alt" loading="lazy" />
    <svg v-else class="thumb__svg" viewBox="0 0 48 48" preserveAspectRatio="xMidYMid slice" :aria-label="alt" role="img">
      <defs>
        <pattern :id="pid" width="12" height="13" patternUnits="userSpaceOnUse">
          <rect width="12" height="13" :fill="tones.base" />
          <path d="M0,13 L6,6 L12,13" fill="none" :stroke="tones.lo" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M0,6 L6,-1 L12,6" fill="none" :stroke="tones.hi" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </pattern>
      </defs>
      <rect width="48" height="48" :fill="`url(#${pid})`" />
    </svg>
  </div>
</template>

<style scoped>
.thumb {
  flex-shrink: 0;
  overflow: hidden;
  background: var(--bg);
  border-radius: var(--r-sm);
  width: 48px;
  height: 48px;
}
.thumb__img,
.thumb__svg {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
