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
  <div v-if="imgs.length" class="stepimgs">
    <button
      v-for="(src, i) in imgs"
      :key="i"
      type="button"
      class="stepimgs__thumb"
      :aria-label="$t('reader.stepImageOpen')"
      @click="open(i)"
    >
      <img :src="src" alt="" loading="lazy" />
    </button>
  </div>
</template>

<style scoped>
.stepimgs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 6px 0 2px;
}
.stepimgs__thumb {
  padding: 0;
  border: none;
  background: none;
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
}
.stepimgs__thumb img {
  display: block;
  height: 96px;
  width: auto;
  max-width: 100%;
  object-fit: cover;
  border-radius: 12px;
}
</style>
