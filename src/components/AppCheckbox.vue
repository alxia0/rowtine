<script setup>
import AppIcon from '@/components/AppIcon.vue'

// Case à cocher maison (lot P2, audit UX 17/07) : remplace les cases NATIVES du
// navigateur (~16 px, style système) qui juraient avec le soin du reste de l'app.
// L'`<input type="checkbox">` reste un VRAI contrôle natif — masqué visuellement,
// jamais retiré du DOM/du parcours clavier (WCAG 2.1.1). v-model direct côté appelant.
defineProps({
  modelValue: { type: Boolean, default: false },
  ariaLabel: { type: String, default: undefined },
  disabled: { type: Boolean, default: false },
})
defineEmits(['update:modelValue'])
</script>

<template>
  <label class="chk" :class="{ 'chk--disabled': disabled }">
    <input
      type="checkbox"
      class="chk__input"
      :checked="modelValue"
      :aria-label="ariaLabel"
      :disabled="disabled"
      @change="$emit('update:modelValue', $event.target.checked)"
    />
    <span class="chk__box" :class="{ 'chk__box--on': modelValue }">
      <AppIcon v-if="modelValue" name="check" :size="14" />
    </span>
    <span class="chk__label"><slot /></span>
  </label>
</template>

<style scoped>
.chk {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 44px;
  cursor: pointer;
}
.chk--disabled { cursor: not-allowed; }
.chk--disabled .chk__box { opacity: 0.5; }
/* Masqué visuellement mais gardé dans l'ordre de tabulation et l'arbre d'accessibilité
   (WCAG 2.1.1) : le contrôle réel reçoit toujours le focus clavier — à l'inverse de
   [hidden]/display:none. Motif repris à l'identique de LibraryView `.lib-import__input`
   / LocalPdfImportView `.file-pick__input`.
   PAS opacity:0 + inset:0 : Playwright considère alors l'input « visible » et
   `not.toBeVisible()` ignore l'opacité — piège déjà livré sur ce chantier. */
.chk__input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
/* Anneau de focus CLAVIER uniquement, porté sur la case (frère adjacent de l'input masqué).
   `:focus-visible` (pas `:focus-within`) : un tap tactile laisse le focus sur l'input caché,
   or `:focus-within` matche ce focus → l'anneau PERSISTAIT après un tap (bug device 19/07).
   `:focus-visible` ne se déclenche qu'au focus clavier, jamais au pointeur/tactile → plus
   d'anneau résiduel après un tap, tout en gardant l'indicateur clavier (WCAG 2.4.7).
   Frère adjacent `+` (universel) plutôt que `:has()` (manque aux WebView Android < Chrome 105) ;
   `:focus-visible` seul est supporté depuis Chrome 86. */
.chk__input:focus-visible + .chk__box {
  outline: 2px solid var(--brand-deep);
  outline-offset: 2px;
}
.chk__box {
  flex: none;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1.7px solid var(--line);
  border-radius: 6px;
  background: var(--surface);
  color: var(--on-accent);
  transition: background var(--motion-fast), border-color var(--motion-fast);
}
.chk__box--on {
  background: var(--brand);
  border-color: var(--brand);
}
.chk__label {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
}
</style>
