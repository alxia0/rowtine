<script setup>
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/AppIcon.vue'

// Carte de compteur partagée (compteur indépendant ET compteurs de projet).
// Tout compteur compte des RANGS ; il peut porter deux modules optionnels, basés sur
// le même compte de rangs : augmentations/diminutions et/ou répétitions de bloc.
const props = defineProps({ counter: { type: Object, required: true } })
const emit = defineEmits(['set', 'update', 'remove'])
const { t } = useI18n()

const val = (c) => Number(c.value) || 0

// --- Actions ---
function bump(d) {
  emit('set', props.counter.id, val(props.counter) + d)
}
// Champ VIDÉ (ou saisie qu'un `type=number` a déjà réduite à '', ex. « 9o ») : `Number('')`
// vaut 0 — écrire ce 0 effaçait le compte de rangs sur un simple blur, sans confirmation ni
// annulation, alors que cet écran exige un bouton « Remise à zéro » explicite pour ce geste.
// On refuse donc la saisie et on remet le compte affiché (Vue ne re-rendrait pas : l'état
// n'a pas changé). `onTarget` peut, lui, retomber sur 0 : 0 y signifie « pas d'objectif ».
function onValue(e) {
  const n = Number(e.target.value)
  if (e.target.value === '' || !Number.isFinite(n)) {
    e.target.value = val(props.counter)
    return
  }
  emit('set', props.counter.id, n)
}
function onName(e) {
  emit('update', props.counter.id, { name: e.target.value })
}
function onTarget(e) {
  emit('update', props.counter.id, { target: Number(e.target.value) || 0 })
}
function reset() {
  emit('set', props.counter.id, 0)
}
// Pourcentage plafonné à 100, commun aux trois barres de progression de la carte
// (objectif de rangs, augmentations/diminutions, répétitions) : même formule,
// un seul endroit à faire évoluer si l'arrondi doit changer.
function pctOf(done, goal) {
  return goal > 0 ? Math.min(100, Math.round((100 * done) / goal)) : 0
}
// Nombre de cycles complets écoulés (un cycle = `size` rangs), commun aux
// augmentations/diminutions (intervalle) et aux répétitions (longueur de bloc).
function cycleDone(n, size) {
  return size > 0 ? Math.floor(n / size) : 0
}
// Vrai exactement au rang qui clôt un cycle (multiple de `size`, rang 0 exclu).
function isCycleBoundary(n, size) {
  return size > 0 && n > 0 && n % size === 0
}
function pct(c) {
  return pctOf(val(c), c.target)
}

// --- Module augmentations / diminutions (tous les X rangs) ---
const hasShaping = (c) => !!c.hasShaping
function shapingDone(c) {
  return cycleDone(val(c), Number(c.interval) || 0)
}
function isShapingRow(c) {
  return isCycleBoundary(val(c), Number(c.interval) || 0)
}
function nextInRows(c) {
  const iv = Number(c.interval) || 0
  if (iv <= 0) return 0
  const rem = val(c) % iv
  return rem === 0 ? iv : iv - rem
}
const shapingGoal = (c) => Number(c.shapingTarget) || 0
function shapingPct(c) {
  return pctOf(shapingDone(c), shapingGoal(c))
}
const everyText = (c) =>
  c.shapingMode === 'dec' ? t('icounter.everyDec', { n: c.interval }) : t('icounter.everyInc', { n: c.interval })
function statusText(c) {
  if (isShapingRow(c)) {
    return c.shapingMode === 'dec' ? t('icounter.nowDec', { n: shapingDone(c) }) : t('icounter.nowInc', { n: shapingDone(c) })
  }
  return c.shapingMode === 'dec' ? t('icounter.nextDec', { n: nextInRows(c) }) : t('icounter.nextInc', { n: nextInRows(c) })
}
function doneText(c) {
  const done = shapingDone(c)
  const g = shapingGoal(c)
  if (c.shapingMode === 'dec') return g > 0 ? t('icounter.doneDec', { done, goal: g }) : t('icounter.doneDecNoGoal', { done })
  return g > 0 ? t('icounter.doneInc', { done, goal: g }) : t('icounter.doneIncNoGoal', { done })
}
const totalStitches = (c) => shapingDone(c) * (Number(c.stitchesPerShaping) || 0)
const stitchesText = (c) =>
  c.shapingMode === 'dec' ? t('icounter.stitchesDec', { n: totalStitches(c) }) : t('icounter.stitchesInc', { n: totalStitches(c) })

// --- Module répétitions (bloc de N rangs répété Z fois) ---
const hasRepeat = (c) => !!c.hasRepeat
const repeatRows = (c) => Number(c.repeatRows) || 0
const repeatGoal = (c) => Number(c.repeatTarget) || 0
function repeatsDone(c) {
  return cycleDone(val(c), repeatRows(c))
}
function rowInRepeat(c) {
  const rr = repeatRows(c)
  if (rr <= 0 || val(c) === 0) return 0
  const rem = val(c) % rr
  return rem === 0 ? rr : rem
}
function isRepeatBoundary(c) {
  return isCycleBoundary(val(c), repeatRows(c))
}
function repeatPct(c) {
  return pctOf(repeatsDone(c), repeatGoal(c))
}
function repeatProgressText(c) {
  const done = repeatsDone(c)
  const g = repeatGoal(c)
  return g > 0 ? t('icounter.repeatProgress', { done, goal: g }) : t('icounter.repeatProgressNoGoal', { done })
}
</script>

<template>
  <div class="ccard" :class="{ 'ccard--rich': hasShaping(counter) || hasRepeat(counter) }">
    <div class="ccard__head">
      <input class="ccard__name" :aria-label="t('counter.name')" :value="counter.name" @change="onName" />
      <button class="ccard__del" :aria-label="t('common.delete')" @click="emit('remove', counter.id)"><AppIcon name="close" :size="16" /></button>
    </div>
    <div class="ccard__main">
      <button class="ccard__pm" :aria-label="t('icounter.decrease')" @click="bump(-1)"><AppIcon name="minus" :size="22" /></button>
      <input class="ccard__val" type="number" :aria-labelledby="`ccard-rowslabel-${counter.id}`" :value="counter.value" inputmode="numeric" @change="onValue" />
      <button class="ccard__pm" :aria-label="t('icounter.increase')" @click="bump(1)"><AppIcon name="plus" :size="22" /></button>
    </div>
    <p :id="`ccard-rowslabel-${counter.id}`" class="ccard__rowslabel">{{ t('icounter.rowsCounted') }}</p>

    <!-- Module augmentations / diminutions -->
    <template v-if="hasShaping(counter)">
      <div class="shaping" :class="{ 'shaping--now': isShapingRow(counter) }">
        <p class="shaping__every">{{ everyText(counter) }}</p>
        <p class="shaping__status">{{ statusText(counter) }}</p>
        <p class="shaping__count">{{ doneText(counter) }}</p>
        <p v-if="(Number(counter.stitchesPerShaping) || 0) > 0" class="shaping__stitches">{{ stitchesText(counter) }}</p>
      </div>
      <div v-if="shapingGoal(counter) > 0" class="bar"><span :style="{ width: shapingPct(counter) + '%' }"></span></div>
    </template>

    <!-- Module répétitions -->
    <template v-if="hasRepeat(counter)">
      <div class="shaping shaping--repeat" :class="{ 'shaping--now': isRepeatBoundary(counter) }">
        <p class="shaping__every">{{ t('icounter.repeatEvery', { n: repeatRows(counter) }) }}</p>
        <p class="shaping__status">{{ repeatProgressText(counter) }}</p>
        <p class="shaping__count">{{ t('icounter.repeatRow', { r: rowInRepeat(counter), of: repeatRows(counter) }) }}</p>
      </div>
      <div v-if="repeatGoal(counter) > 0" class="bar"><span :style="{ width: repeatPct(counter) + '%' }"></span></div>
    </template>

    <!-- Objectif de rangs + remise à zéro -->
    <div class="ccard__foot">
      <button class="link--reset" @click="reset">{{ t('icounter.reset') }}</button>
      <label class="tgt">{{ t('icounter.target') }} <input class="tgt__in" type="number" :value="counter.target || ''" inputmode="numeric" @change="onTarget" /></label>
    </div>
    <div v-if="counter.target > 0" class="bar"><span :style="{ width: pct(counter) + '%' }"></span></div>
  </div>
</template>

<style scoped>
.ccard { background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-lg); padding: var(--sp-4); box-shadow: var(--clay-sm); }
.ccard--rich { border-color: var(--brand); }
.ccard__head { display: flex; align-items: center; gap: var(--sp-2); }
.ccard__name { flex: 1; border: none; background: transparent; font-family: var(--font-display); font-weight: 600; font-size: 16px; color: var(--ink); }
.ccard__del { display: flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; margin: calc(-1 * var(--sp-2)) calc(-1 * var(--sp-2)) calc(-1 * var(--sp-2)) 0; border: none; background: transparent; color: var(--ink-55); font-size: 15px; }
.ccard__main { display: flex; align-items: center; justify-content: center; gap: var(--sp-4); margin: var(--sp-3) 0; }
/* Centrage flex explicite : le centrage natif d'un <button> passe par la ligne de base
   du texte et laissait l'icône (remplaçante du glyphe 28 px) dériver dans le carré 56 px. */
.ccard__pm { display: inline-flex; align-items: center; justify-content: center; width: 56px; height: 56px; border: none; border-radius: var(--r-md); background: var(--brand-grad); color: var(--on-accent); font-size: 28px; font-weight: 700; box-shadow: 0 8px 16px -7px rgba(var(--brand-rgb), 0.55), 0 1px 1px rgba(255, 255, 255, 0.3) inset; }
.ccard__pm:active { box-shadow: var(--clay-press); transform: scale(0.96); }
/* `tabular-nums` : sans lui, le `1` de Literata est plus étroit que le `8` et le
   nombre danse entre les boutons − et + à chaque appui. C'est le plus gros chiffre
   de l'app ; il était le seul à ne pas l'avoir. La déclaration n'a d'effet que
   parce que --font-display porte la feature `tnum` depuis le 17/08/2026. */
.ccard__val { width: 96px; text-align: center; font-family: var(--font-display); font-size: 44px; font-variant-numeric: tabular-nums; border: none; background: transparent; color: var(--ink); }
.ccard__rowslabel { text-align: center; color: var(--ink-55); font-size: 12px; font-weight: 600; margin: 0 0 var(--sp-3); }
.shaping { background: var(--surface-lin); border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--sp-3); text-align: center; margin-bottom: var(--sp-2); }
.shaping--now { background: var(--brand); border-color: var(--brand); }
.shaping__every { margin: 0; font-size: 13px; color: var(--ink-55); font-weight: 600; }
.shaping__status { margin: var(--sp-2) 0 0; font-family: var(--font-display); font-size: 18px; color: var(--brand-deep); }
.shaping__count { margin: var(--sp-2) 0 0; font-size: 13px; color: var(--ink-55); }
.shaping__stitches { margin: var(--sp-2) 0 0; font-size: 13px; font-weight: 600; color: var(--brand-deep); }
.shaping--now .shaping__every,
.shaping--now .shaping__status,
.shaping--now .shaping__count,
.shaping--now .shaping__stitches { color: var(--on-accent); }
.ccard__foot { display: flex; align-items: center; justify-content: space-between; margin-top: var(--sp-4); padding-top: var(--sp-3); border-top: 1px solid var(--line); }
.link--reset { border: 1px solid var(--line); border-radius: var(--r-sm); padding: 6px 12px; color: var(--ink-55); background: transparent; font-weight: 600; }
.tgt { color: var(--ink-55); font-size: 13px; font-weight: 600; }
.tgt__in { width: 64px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--bg); padding: 5px; margin-left: var(--sp-2); text-align: center; }
.bar { height: 8px; background: var(--bg); border-radius: var(--r-pill); overflow: hidden; margin-top: var(--sp-3); }
.bar span { display: block; height: 100%; background: var(--sage); }
</style>
