<script setup>
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCropperStore } from '@/stores/cropper'
import { pickImage } from '@/utils/photo'
import { trapTabFocus, useDialogFocusReturn } from '@/composables/useFocusTrap'
import AppIcon from '@/components/AppIcon.vue'

// Pop-up unique de choix + recadrage d'une photo de badge (remplace l'onglet Photo du
// composeur, 2026-09-17) : galerie du projet ou galerie du téléphone/appareil photo, PUIS
// choix du ratio (3 icônes — carré, ou 2 valeurs par groupe horizontal/vertical) juste avant
// le recadrage lui-même, qui reste le recadreur générique de l'app (`useCropperStore`,
// s'ouvre PAR-DESSUS cette pop-up, comme partout ailleurs).
const props = defineProps({
  open: { type: Boolean, default: false },
  photos: { type: Array, default: () => [] },
})
const emit = defineEmits(['confirm', 'close'])

const { t } = useI18n()
const cropper = useCropperStore()

// Ratios libres, indépendants de l'orientation du gabarit du badge (revue 17/09) : 3 icônes,
// le carré confirme directement (une seule valeur), horizontal/vertical déroulent 2 choix.
const RATIO_GROUPS = {
  horizontal: [
    { key: '4:3', ratio: 4 / 3 },
    { key: '16:9', ratio: 16 / 9 },
  ],
  vertical: [
    { key: '3:4', ratio: 3 / 4 },
    { key: '9:16', ratio: 9 / 16 },
  ],
}

const rawPhoto = ref(null) // dataURL choisie, pas encore recadrée
const group = ref(null) // 'horizontal' | 'vertical' | null (carré : pas de groupe, confirme direct)

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) {
      rawPhoto.value = null
      group.value = null
    }
  },
)

function chooseSource(dataUrl) {
  rawPhoto.value = dataUrl
  group.value = null
}
async function chooseDevice() {
  const dataUrl = await pickImage()
  if (dataUrl) chooseSource(dataUrl)
}
function backToSource() {
  rawPhoto.value = null
  group.value = null
}
async function confirmRatio(ratio) {
  const cropped = await cropper.crop(rawPhoto.value, ratio)
  // `cropped` null : recadrage annulé — on reste sur le choix de ratio, rien à appliquer.
  if (!cropped) return
  emit('confirm', { dataUrl: cropped, ratio })
}

useDialogFocusReturn(() => props.open)
function onKey(e) {
  if (cropper.open) return
  if (e.key === 'Escape') emit('close')
}
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) document.addEventListener('keydown', onKey)
    else document.removeEventListener('keydown', onKey)
  },
  { immediate: true },
)
</script>

<template>
  <Transition name="bpp-fade">
    <div v-if="open" class="bpp">
      <div class="bpp__scrim" @click="emit('close')"></div>
      <div class="bpp__card" role="dialog" aria-modal="true" :aria-label="t('project.stats.badge.photoPickerTitle')" @keydown="trapTabFocus">
        <div class="bpp__head">
          <button v-if="rawPhoto" type="button" class="btn" data-test="photo-picker-back" @click="backToSource">
            {{ t('common.back') }}
          </button>
          <h2 class="bpp__title">{{ t('project.stats.badge.photoPickerTitle') }}</h2>
          <button type="button" class="btn" data-test="photo-picker-close" @click="emit('close')">
            {{ t('common.close') }}
          </button>
        </div>

        <template v-if="!rawPhoto">
          <div class="bpp__grid">
            <button
              v-for="(p, i) in photos"
              :key="i"
              type="button"
              class="bpp__pick"
              :aria-label="t('project.stats.badge.photoChoose')"
              @click="chooseSource(p)"
            >
              <img :src="p" alt="" />
            </button>
          </div>
          <button type="button" class="btn btn--primary" data-test="photo-picker-device" @click="chooseDevice">
            {{ t('project.stats.badge.photoFromDevice') }}
          </button>
        </template>

        <template v-else>
          <img :src="rawPhoto" class="bpp__preview" alt="" />
          <p class="bpp__subhead">{{ t('project.stats.badge.ratioLabel') }}</p>
          <div class="bpp__ratios">
            <button
              type="button"
              class="bpp__ratio-icon"
              data-test="photo-picker-ratio-square"
              :aria-label="t('project.stats.badge.ratioSquare')"
              @click="confirmRatio(1)"
            >
              <AppIcon name="ratioSquare" :size="26" />
              <span>{{ t('project.stats.badge.ratioSquare') }}</span>
            </button>
            <button
              type="button"
              class="bpp__ratio-icon"
              :class="{ 'bpp__ratio-icon--on': group === 'horizontal' }"
              data-test="photo-picker-ratio-horizontal"
              :aria-label="t('project.stats.badge.ratioHorizontal')"
              @click="group = 'horizontal'"
            >
              <AppIcon name="ratioHorizontal" :size="26" />
              <span>{{ t('project.stats.badge.ratioHorizontal') }}</span>
            </button>
            <button
              type="button"
              class="bpp__ratio-icon"
              :class="{ 'bpp__ratio-icon--on': group === 'vertical' }"
              data-test="photo-picker-ratio-vertical"
              :aria-label="t('project.stats.badge.ratioVertical')"
              @click="group = 'vertical'"
            >
              <AppIcon name="ratioVertical" :size="26" />
              <span>{{ t('project.stats.badge.ratioVertical') }}</span>
            </button>
          </div>
          <div v-if="group" class="bpp__ratio-values">
            <button
              v-for="opt in RATIO_GROUPS[group]"
              :key="opt.key"
              type="button"
              class="btn"
              :data-test="`photo-picker-ratio-${opt.key}`"
              @click="confirmRatio(opt.ratio)"
            >
              {{ opt.key }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* Même motif que ConfirmDialog.vue (.cfd) — feuille du bas, voile séparé, z-index LOCAL à
   la pile de BadgeComposer.vue (qui la monte, position: fixed z-index: 1050) : le recadreur
   générique reste un singleton monté au niveau App.vue (z-index 1100), donc au-dessus quelle
   que soit la valeur ici. */
.bpp { position: fixed; inset: 0; z-index: 90; display: flex; align-items: flex-end; justify-content: center; }
.bpp__scrim { position: absolute; inset: 0; background: rgba(58, 46, 40, 0.42); }
.bpp__card {
  position: relative;
  width: 100%;
  max-width: 480px;
  max-height: 82vh;
  overflow-y: auto;
  background: var(--bg);
  border-radius: var(--r-lg) var(--r-lg) 0 0;
  box-shadow: var(--e-3);
  padding: var(--sp-4) max(var(--sp-4), var(--sa-left)) max(var(--sp-4), var(--sa-bottom));
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.bpp__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
}
.bpp__title {
  font-family: var(--font-display);
  font-size: 1.05rem;
  margin: 0;
}
.bpp__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: var(--sp-2);
}
.bpp__pick {
  aspect-ratio: 1;
  padding: 0;
  border: none;
  background: none;
  border-radius: var(--r-md);
  overflow: hidden;
}
.bpp__pick img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.bpp__preview {
  max-width: 100%;
  max-height: 40vh;
  border-radius: var(--r-md);
  align-self: center;
}
.bpp__subhead {
  margin: 0;
  font-weight: 600;
  color: var(--ink-55);
  font-size: 0.875rem;
}
.bpp__ratios {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--sp-2);
}
.bpp__ratio-icon {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-1);
  padding: var(--sp-2);
  border-radius: var(--r-md);
  background: var(--tile);
  border: 2px solid transparent;
}
.bpp__ratio-icon--on {
  border-color: var(--brand);
}
.bpp__ratio-values {
  display: flex;
  gap: var(--sp-2);
}
.bpp__ratio-values .btn {
  flex: 1;
}

.bpp-fade-enter-active,
.bpp-fade-leave-active {
  transition: opacity var(--motion-fast);
}
.bpp-fade-enter-from,
.bpp-fade-leave-to {
  opacity: 0;
}
</style>
