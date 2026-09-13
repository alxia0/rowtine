<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/AppIcon.vue'

// Étiquette de champ avec aide contextuelle optionnelle : un bouton (icône « help » du
// registre AppIcon, jamais un glyphe en dur) déplie une explication (ce que
// l'app fait du champ). Pensé pour les non-initiés ; replié par défaut.
defineProps({
  label: { type: String, required: true },
  hint: { type: String, default: '' },
  for: { type: String, default: '' },
})
const open = ref(false)
const { t } = useI18n()
</script>

<template>
  <div class="fh">
    <label class="field-label fh__label" :for="$props.for || undefined">
      <span>{{ label }}</span>
      <button
        v-if="hint"
        type="button"
        class="fh__btn"
        :class="{ 'fh__btn--on': open }"
        :aria-expanded="open"
        :aria-label="t('common.showFieldHelp', { label })"
        @click="open = !open"
      >
        <AppIcon name="help" :size="16" />
      </button>
    </label>
    <Transition name="fh">
      <p v-if="open && hint" class="fh__hint">{{ hint }}</p>
    </Transition>
  </div>
</template>

<style scoped>
.fh__label { display: flex; align-items: center; gap: var(--sp-2); }
.fh__btn { position: relative; display: inline-flex; align-items: center; justify-content: center; border: none; background: transparent; color: var(--ink-55); padding: 2px; }
/* zone tactile élargie (hitSlop) sans agrandir le visuel de l'icône (16px, cf. AppIcon) */
.fh__btn::after { content: ''; position: absolute; inset: -14px; }
.fh__btn--on { color: var(--brand); }
.fh__hint { margin: 0 0 var(--sp-2); font-size: 12.5px; line-height: 1.4; color: var(--ink-55); background: var(--surface-lin); border-radius: var(--r-sm); padding: var(--sp-2) var(--sp-3); }
.fh-enter-active, .fh-leave-active { transition: opacity var(--motion-fast); }
.fh-enter-from, .fh-leave-to { opacity: 0; }
</style>
