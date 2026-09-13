<script setup>
import { reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import AppCheckbox from '@/components/AppCheckbox.vue'
import AppIcon from '@/components/AppIcon.vue'

// Formulaire d'ajout de compteur, partagé (compteur indépendant + compteurs de projet).
// Émet `submit({ name, extra })` où extra porte les modules optionnels activés.
const emit = defineEmits(['submit'])
const { t } = useI18n()

function initialForm() {
  return {
    name: '',
    hasShaping: false,
    shapingMode: 'inc',
    interval: 2,
    shapingTarget: '',
    stitchesPerShaping: '',
    hasRepeat: false,
    repeatRows: '',
    repeatTarget: '',
  }
}
const form = reactive(initialForm())
function reset() {
  Object.assign(form, initialForm())
}
function submit() {
  const extra = { hasShaping: form.hasShaping, hasRepeat: form.hasRepeat }
  if (form.hasShaping) {
    extra.shapingMode = form.shapingMode
    extra.interval = Math.max(1, Number(form.interval) || 1)
    extra.shapingTarget = Number(form.shapingTarget) || 0
    extra.stitchesPerShaping = Math.max(0, Number(form.stitchesPerShaping) || 0)
  }
  if (form.hasRepeat) {
    extra.repeatRows = Math.max(1, Number(form.repeatRows) || 1)
    extra.repeatTarget = Number(form.repeatTarget) || 0
  }
  emit('submit', { name: form.name.trim(), extra })
  reset()
}
</script>

<template>
  <div class="card addcard">
    <input v-model="form.name" class="input" :aria-label="t('counter.name')" :placeholder="t('counter.name')" @keyup.enter="submit" />

    <AppCheckbox v-model="form.hasShaping" class="mt2">{{ t('icounter.addShaping') }}</AppCheckbox>
    <p class="check__hint">{{ t('icounter.addShapingHint') }}</p>
    <template v-if="form.hasShaping">
      <div class="seg mt2">
        <button class="seg__opt" :class="{ 'seg__opt--on': form.shapingMode === 'inc' }" @click="form.shapingMode = 'inc'">{{ t('icounter.modeInc') }}</button>
        <button class="seg__opt" :class="{ 'seg__opt--on': form.shapingMode === 'dec' }" @click="form.shapingMode = 'dec'">{{ t('icounter.modeDec') }}</button>
      </div>
      <div class="row mt2">
        <div class="col"><label class="field-label" for="counter-interval">{{ t('icounter.interval') }}</label><input id="counter-interval" v-model="form.interval" class="input" inputmode="numeric" placeholder="2" /></div>
        <div class="col"><label class="field-label" for="counter-shaping-target">{{ t('icounter.goalShapings') }}</label><input id="counter-shaping-target" v-model="form.shapingTarget" class="input" inputmode="numeric" placeholder="—" /></div>
      </div>
      <label class="field-label mt2" for="counter-stitches-per-shaping">{{ t('icounter.stitchesPerShaping') }}</label>
      <input id="counter-stitches-per-shaping" v-model="form.stitchesPerShaping" class="input" inputmode="numeric" placeholder="—" />
    </template>

    <AppCheckbox v-model="form.hasRepeat" class="mt3">{{ t('icounter.addRepeat') }}</AppCheckbox>
    <p class="check__hint">{{ t('icounter.addRepeatHint') }}</p>
    <template v-if="form.hasRepeat">
      <div class="row mt2">
        <div class="col"><label class="field-label" for="counter-repeat-rows">{{ t('icounter.repeatRows') }}</label><input id="counter-repeat-rows" v-model="form.repeatRows" class="input" inputmode="numeric" placeholder="8" /></div>
        <div class="col"><label class="field-label" for="counter-repeat-target">{{ t('icounter.repeatTarget') }}</label><input id="counter-repeat-target" v-model="form.repeatTarget" class="input" inputmode="numeric" placeholder="—" /></div>
      </div>
    </template>

    <button class="btn btn--primary btn--block mt2" @click="submit"><AppIcon name="plus" :size="17" /> {{ t('home.toolCounter') }}</button>
  </div>
</template>

<style scoped>
.addcard { padding: var(--sp-3); }
.seg { display: flex; gap: var(--sp-2); background: var(--bg); border: 1px solid var(--line); border-radius: var(--r-pill); padding: 4px; }
.seg__opt { flex: 1; border: none; background: transparent; color: var(--ink-55); font-weight: 600; font-size: 13px; padding: 9px; border-radius: var(--r-pill); }
.seg__opt--on { background: var(--brand); color: var(--on-accent); }
.check__hint { margin: var(--sp-1) 0 0; font-size: 12px; color: var(--ink-55); }
.row { display: flex; gap: var(--sp-3); }
.col { flex: 1; }
.mt2 { margin-top: var(--sp-2); }
.mt3 { margin-top: var(--sp-4); }
</style>
