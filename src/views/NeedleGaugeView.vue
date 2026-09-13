<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppHeader from '@/components/AppHeader.vue'
import FieldHelp from '@/components/FieldHelp.vue'
import { TECHNIQUES } from '@/constants/status'
import { recommendNeedle } from '@/utils/needle-gauge'
import { parseDecimal } from '@/utils/decimal'
import { useSettingsStore } from '@/stores/settings'

const { t, locale } = useI18n()
const settings = useSettingsStore()

const technique = ref('knitting') // 'knitting' | 'crochet'
// S'applique au carré de l'échantillon (10x10cm ou 4x4po) — pas à la taille
// d'aiguilles, toujours exprimée en mm quel que soit ce choix. Pré-rempli d'après le
// système d'unités choisi (revue finale) : une utilisatrice en impérial ne doit
// pas retomber sur cm à chaque ouverture de l'écran.
const unit = ref(settings.unitSystem === 'imperial' ? 'in' : 'cm') // 'cm' | 'in'

const labelNeedleMm = ref('')
const labelStitches = ref('')
const labelRows = ref('')
const targetStitches = ref('')
const targetRows = ref('')

const isCrochet = computed(() => technique.value === 'crochet')
const square = computed(() => t(unit.value === 'in' ? 'needleGauge.squareIn' : 'needleGauge.squareCm'))

const result = computed(() =>
  recommendNeedle({
    technique: technique.value,
    labelNeedleMm: parseDecimal(labelNeedleMm.value),
    labelStitches: parseDecimal(labelStitches.value),
    targetStitches: parseDecimal(targetStitches.value),
    labelRows: parseDecimal(labelRows.value),
    targetRows: parseDecimal(targetRows.value),
  }),
)

const fmt = (mm) => mm.toLocaleString(locale.value, { maximumFractionDigits: 2 })

const resultKey = computed(() => {
  if (!result.value) return ''
  if (result.value.direction === 'bigger') return 'needleGauge.resultBigger'
  if (result.value.direction === 'smaller') return 'needleGauge.resultSmaller'
  return 'needleGauge.resultSame'
})

// La recommandation se calcule au clic (pas en direct) : avec 5 champs répartis sur
// l'écran, un calcul silencieux en arrière-plan ne donne aucun signal visible — retour
// device (retour d'usage, 21/07). Toute modification d'un champ après un calcul invalide le
// résultat affiché, pour ne jamais montrer une reco qui ne correspond plus aux chiffres.
const hasSearched = ref(false)
watch([technique, unit, labelNeedleMm, labelStitches, labelRows, targetStitches, targetRows], () => {
  hasSearched.value = false
})
function search() {
  hasSearched.value = true
}

// Remontée du champ actif au-dessus du clavier virtuel : DEPUIS le 29/07, un mécanisme
// GLOBAL unique (src/utils/keyboard-avoidance.js, posé une fois dans main.js) gère
// cela pour toute l'app — ce qui était ici un gestionnaire par écran ferait désormais
// double emploi (deux défilements concurrents produiraient un tremblement visible).
// Le raisonnement d'origine (pourquoi ce projet n'utilise ni `visualViewport` ni le
// plugin clavier de Capacitor) a été déplacé, pas perdu : cf. l'en-tête de
// src/utils/keyboard-avoidance.js.
</script>

<template>
<div>
  <AppHeader :title="t(isCrochet ? 'needleGauge.titleCrochet' : 'needleGauge.titleKnitting')" back />
  <main class="screen">
    <div class="toggle">
      <button
        v-for="tech in TECHNIQUES"
        :key="tech"
        class="toggle__opt"
        :class="{ 'toggle__opt--on': technique === tech }"
        @click="technique = tech"
      >
        {{ t(`technique.${tech}`) }}
      </button>
    </div>
    <div class="toggle mt">
      <button class="toggle__opt" :class="{ 'toggle__opt--on': unit === 'cm' }" @click="unit = 'cm'">{{ t('needleGauge.unitCm') }}</button>
      <button class="toggle__opt" :class="{ 'toggle__opt--on': unit === 'in' }" @click="unit = 'in'">{{ t('needleGauge.unitIn') }}</button>
    </div>

    <h2 class="section-title mt2">{{ t('needleGauge.labelSection') }}</h2>
    <div class="mt"><FieldHelp for="ng-label-mm" :label="t('needleGauge.labelNeedle')" :hint="t('needleGauge.labelNeedleHint')" /></div>
    <input id="ng-label-mm" v-model="labelNeedleMm" class="input" inputmode="decimal" placeholder="4" />
    <div class="row mt">
      <div class="col">
        <FieldHelp for="ng-label-stitches" :label="t('needleGauge.labelStitches', { square })" :hint="t('needleGauge.labelStitchesHint')" />
        <input id="ng-label-stitches" v-model="labelStitches" class="input" inputmode="decimal" placeholder="22" />
      </div>
      <div class="col">
        <label class="field-label" for="ng-label-rows">{{ t('needleGauge.labelRows', { square }) }}</label>
        <input id="ng-label-rows" v-model="labelRows" class="input" inputmode="decimal" placeholder="30" />
      </div>
    </div>

    <h2 class="section-title mt2">{{ t('needleGauge.targetSection') }}</h2>
    <div class="row mt">
      <div class="col">
        <FieldHelp for="ng-target-stitches" :label="t('needleGauge.targetStitches', { square })" :hint="t('needleGauge.targetStitchesHint')" />
        <input id="ng-target-stitches" v-model="targetStitches" class="input" inputmode="decimal" placeholder="20" />
      </div>
      <div class="col">
        <label class="field-label" for="ng-target-rows">{{ t('needleGauge.targetRows', { square }) }}</label>
        <input id="ng-target-rows" v-model="targetRows" class="input" inputmode="decimal" placeholder="28" />
      </div>
    </div>

    <button class="btn btn--primary btn--block mt2" @click="search">{{ t('needleGauge.search') }}</button>

    <div v-if="hasSearched && result" class="card resultbox mt2">
      <p v-if="result.sameGauge" class="result__lead">{{ t('needleGauge.sameGauge') }}</p>
      <template v-else>
        <p class="result__lead">{{ t(resultKey, { mm: fmt(result.recommendedMm) }) }}</p>
        <p class="result__raw">{{ t('needleGauge.rawValue', { mm: fmt(result.rawMm) }) }}</p>
      </template>
      <p v-if="result.outOfRange" class="result__warn">{{ t('needleGauge.outOfRange') }}</p>
      <p v-if="result.rowNote" class="result__warn">{{ t('needleGauge.rowNote') }}</p>
      <p class="result__caveat">{{ t('needleGauge.caveat') }}</p>
    </div>
    <p v-else class="muted mt2">{{ t('needleGauge.fillIn') }}</p>
  </main>
</div>
</template>

<style scoped>
.toggle { display: flex; gap: var(--sp-2); background: var(--bg); border: 1px solid var(--line); border-radius: var(--r-pill); padding: 4px; }
.toggle__opt { flex: 1; border: none; background: transparent; color: var(--ink-55); font-weight: 600; padding: 10px; border-radius: var(--r-pill); }
.toggle__opt--on { background: var(--brand); color: var(--on-accent); }
.mt { margin-top: var(--sp-3); }
.mt2 { margin-top: var(--sp-5); }
.muted { color: var(--ink-55); }
.section-title { font-size: 17px; }
.row { display: flex; gap: var(--sp-3); }
.col { flex: 1; }
.resultbox { background: var(--surface-lin); }
.result__lead { font-weight: 600; color: var(--ink); margin: 0 0 var(--sp-2); font-family: var(--font-display); font-size: 17px; }
.result__raw { color: var(--ink-55); font-size: 12.5px; margin: 0 0 var(--sp-2); }
.result__warn { color: var(--warning); font-size: 13px; font-weight: 600; margin: 0 0 var(--sp-2); }
.result__caveat { color: var(--ink-55); font-size: 13px; margin: 0; }
</style>
