<!-- src/components/NavProgress.vue -->
<!-- Barre fine en haut de l'écran pendant une navigation lente (cue « ça charge »).
     Visible seulement quand useNavProgress l'active (anti-flash déjà géré en amont).
     Respecte prefers-reduced-motion : pas d'animation continue, simple présence. -->
<script setup>
import { useI18n } from 'vue-i18n'
import { navActive } from '@/composables/useNavProgress'

const { t } = useI18n()
</script>

<template>
  <div v-if="navActive" class="navprogress" role="progressbar" aria-busy="true" :aria-label="t('nav.loading')">
    <div class="navprogress__bar" />
  </div>
</template>

<style scoped>
.navprogress {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  z-index: 2000;
  background: color-mix(in srgb, var(--brand) 22%, transparent);
  overflow: hidden;
  pointer-events: none;
}
.navprogress__bar {
  height: 100%;
  width: 40%;
  background: var(--brand);
  border-radius: 0 var(--r-pill) var(--r-pill) 0;
  animation: navprogress-slide 1s ease-in-out infinite;
}
@keyframes navprogress-slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(320%); }
}
@media (prefers-reduced-motion: reduce) {
  .navprogress__bar {
    width: 100%;
    animation: none;
    opacity: 0.85;
  }
}
</style>
