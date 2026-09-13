<script setup>
// Interrupteur (switch) maison, même motif que AppCheckbox : l'`<input type="checkbox">`
// reste un VRAI contrôle natif — masqué visuellement, jamais retiré du DOM/du parcours
// clavier (WCAG 2.1.1). v-model direct côté appelant.
defineProps({
  modelValue: { type: Boolean, default: false },
  ariaLabel: { type: String, default: undefined },
})
defineEmits(['update:modelValue'])
</script>

<template>
  <label class="tgl">
    <input
      type="checkbox"
      class="tgl__input"
      :checked="modelValue"
      :aria-label="ariaLabel"
      @change="$emit('update:modelValue', $event.target.checked)"
    />
    <span class="tgl__track" :class="{ 'tgl__track--on': modelValue }">
      <span class="tgl__thumb" />
    </span>
    <span class="tgl__label"><slot /></span>
  </label>
</template>

<style scoped>
.tgl {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-height: 44px;
  cursor: pointer;
}
/* Même motif de masquage que .chk__input dans AppCheckbox.vue : PAS opacity:0 + inset:0
   (Playwright le considère alors « visible »). */
.tgl__input {
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
.tgl__input:focus-visible + .tgl__track {
  outline: 2px solid var(--brand-deep);
  outline-offset: 2px;
}
.tgl__track {
  flex: none;
  width: 40px;
  height: 24px;
  border-radius: 999px;
  border: 1.7px solid var(--line);
  background: var(--surface);
  transition: background var(--motion-fast), border-color var(--motion-fast);
  position: relative;
}
.tgl__track--on {
  background: var(--brand);
  border-color: var(--brand);
}
.tgl__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--surface);
  transition: transform var(--motion-fast);
}
.tgl__track--on .tgl__thumb {
  transform: translateX(16px);
  background: var(--on-accent);
}
.tgl__label {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
}
</style>
