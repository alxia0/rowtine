<script setup>
import { useI18n } from 'vue-i18n'
import { useLightboxStore } from '@/stores/lightbox'
import AppIcon from '@/components/AppIcon.vue'

const props = defineProps({
  images: { type: Array, default: () => [] },
  coverIndex: { type: Number, default: 0 },
  editable: { type: Boolean, default: false },
})
const emit = defineEmits(['set-cover'])
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
      <div v-for="(g, i) in images" :key="i" class="pgal__cell">
        <button class="pthumb__open" type="button" @click="open(i)">
          <img :src="g.src" :alt="g.page > 0 ? t('patternExtras.fromPage', { n: g.page }) : t('patternExtras.addedImage')" loading="lazy" />
        </button>
        <template v-if="editable">
          <span v-if="i === coverIndex" class="pthumb__badge">{{ t('project.coverBadge') }}</span>
          <button v-else class="pthumb__cover" type="button" :aria-label="t('project.setCover')" @click.stop="emit('set-cover', i)"><AppIcon name="star" :size="16" /></button>
        </template>
      </div>
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
  position: relative;
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
/* Bouton étoile / badge « couverture », motif .pthumb de YarnDetailView.vue et
   ProjectDetailView.vue (CSS scoped par composant : pas de style partagé possible,
   d'où cette 3e copie des mêmes règles plutôt qu'une variante). */
.pthumb__open {
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  border: none;
  background: none;
}
.pthumb__cover {
  position: absolute;
  top: 4px;
  left: 4px;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: rgba(58, 46, 40, 0.6);
  color: #fff;
  font-size: 14px;
}
.pthumb__cover::after {
  content: '';
  position: absolute;
  inset: -10px;
}
.pthumb__badge {
  position: absolute;
  top: 4px;
  left: 4px;
  padding: 3px 8px;
  border-radius: var(--r-pill);
  background: var(--brand-grad);
  color: var(--on-accent);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.2px;
}
</style>
