<script setup>
import { useLightboxStore } from '@/stores/lightbox'

const props = defineProps({
  imgs: { type: Array, default: () => [] },
})
const lightbox = useLightboxStore()

function open(i) {
  lightbox.show(props.imgs, i)
}
</script>

<template>
  <div v-if="imgs.length" class="stepimgs" :class="imgs.length === 1 ? 'stepimgs--single' : 'stepimgs--grid'">
    <button
      v-for="(src, i) in imgs"
      :key="i"
      type="button"
      class="stepimgs__fig"
      :aria-label="$t('reader.stepImageOpen')"
      @click="open(i)"
    >
      <img :src="src" alt="" loading="lazy" decoding="async" />
    </button>
  </div>
</template>

<style scoped>
/* Les images du PDF, affichées comme dans le PDF (spec 2026-09-26) : entières, jamais
   recadrées, à la largeur de la colonne. Une série (pas à pas photo) passe en grille de
   deux colonnes ; le texte, lui, reste sur une seule colonne. */
.stepimgs {
  display: grid;
  gap: 8px;
  margin: 8px 0 2px;
}
.stepimgs--grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
}
.stepimgs__fig {
  display: flex;
  justify-content: center;
  padding: 0;
  border: none;
  background: none;
  border-radius: 12px;
  cursor: pointer;
  min-width: 0;
}
.stepimgs__fig img {
  display: block;
  width: auto;
  height: auto;
  max-width: 100%;
  border-radius: 12px;
}
.stepimgs--single img {
  max-height: 70vh;
}
.stepimgs--grid img {
  max-height: 40vh;
}
</style>
