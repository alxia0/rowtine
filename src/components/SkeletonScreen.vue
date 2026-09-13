<script setup>
// Squelette de chargement réutilisable (présentationnel pur). Remplace un
// « Chargement… » texte brut par une mise en page approximative fidèle à
// l'écran final — mais reste `aria-busy` + décoratif pour un lecteur d'écran ;
// l'annonce accessible (role="status") porte le libellé réel.
import { useI18n } from 'vue-i18n'

defineProps({
  variant: { type: String, default: 'detail' }, // 'reader' | 'detail'
})

const { t } = useI18n()
</script>

<template>
  <div class="screen skel" aria-busy="true">
    <span role="status" class="skel__sr">{{ t('reader.loading') }}</span>

    <template v-if="variant === 'reader'">
      <div class="skel__bar"></div>
      <div class="skel__line skel__line--short"></div>
      <div class="skel__tabs"></div>
      <div class="skel__block"></div>
      <div class="skel__block"></div>
    </template>
    <template v-else>
      <div class="skel__bar"></div>
      <div class="skel__tabs"></div>
      <div class="skel__line"></div>
      <div class="skel__line skel__line--short"></div>
      <div class="skel__block"></div>
    </template>
  </div>
</template>

<style scoped>
/* Skeleton de chargement (le pulse respecte prefers-reduced-motion via tokens.css) */
.skel__bar { height: 28px; width: 60%; border-radius: var(--r-sm); background: var(--surface); margin-bottom: var(--sp-4); }
.skel__tabs { height: 36px; border-radius: var(--r-sm); background: var(--surface); margin-bottom: var(--sp-4); }
.skel__line { height: 14px; border-radius: var(--r-sm); background: var(--surface); margin-bottom: var(--sp-3); }
.skel__line--short { width: 50%; }
.skel__block { height: 120px; border-radius: var(--r-md); background: var(--surface); margin-bottom: var(--sp-3); }
.skel > * { animation: skel-pulse 1.2s ease-in-out infinite; }
@keyframes skel-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
.skel__sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.skel > .skel__sr { animation: none; }
</style>
