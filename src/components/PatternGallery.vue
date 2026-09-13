<script setup>
import { useI18n } from 'vue-i18n'
import { useLightboxStore } from '@/stores/lightbox'

const props = defineProps({ images: { type: Array, default: () => [] } })
const { t } = useI18n()

// Résolu à l'usage (et non au setup) pour que le composant reste montable
// sans Pinia actif (ex. test isolé qui ne déclenche jamais l'ouverture).
function open(i) {
  const lightbox = useLightboxStore()
  lightbox.show(props.images.map((g) => g.src), i)
}
</script>

<template>
  <section v-if="images.length" class="pgal">
    <h2 class="pgal__title">{{ t('patternExtras.galleryTitle') }}</h2>
    <div class="pgal__grid">
      <button v-for="(g, i) in images" :key="i" class="pgal__cell" @click="open(i)">
        <img :src="g.src" :alt="g.page > 0 ? t('patternExtras.fromPage', { n: g.page }) : t('patternExtras.addedImage')" loading="lazy" />
      </button>
    </div>
  </section>
</template>

<style scoped>
.pgal {
  margin-top: var(--sp-4);
}
.pgal__title {
  font-family: var(--font-display);
  font-size: 17px;
  margin: 0 0 var(--sp-2);
}
.pgal__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: var(--sp-2);
}
.pgal__cell {
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  overflow: hidden;
  background: var(--bg);
}
.pgal__cell img {
  width: 100%;
  height: 96px;
  object-fit: cover;
  display: block;
}
</style>
