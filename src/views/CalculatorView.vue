<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AppHeader from '@/components/AppHeader.vue'
import FieldHelp from '@/components/FieldHelp.vue'
import { computeShaping } from '@/utils/stitch-shaping'

const { t, locale } = useI18n()

const mode = ref('inc') // 'inc' | 'dec' — augmentations ou diminutions
const shape = ref('flat') // 'flat' | 'round' — à plat (rangs) ou en rond (tours)
const solveFor = ref('rows') // 'rows' = répartir sur N rangs | 'length' = combien de rangs
const current = ref('')
const target = ref('')
const rows = ref('')
const perTime = ref('') // vide = 1 maille à chaque fois (le cas courant)
const cadence = ref('')

// Le calcul vit dans src/utils/stitch-shaping.js ; cet écran ne fait que saisir
// et mettre en mots.
const res = computed(() =>
  computeShaping({
    mode: mode.value,
    solveFor: solveFor.value,
    current: current.value,
    target: target.value,
    perTime: perTime.value,
    rows: rows.value,
    cadence: cadence.value,
  }),
)
const round = computed(() => shape.value === 'round')

// Mot d'unité selon « à plat » (rangs) ou « en rond » (tours), ACCORDÉ selon
// le nombre `n` auquel il se rapporte : singulier à 1, pluriel sinon — SAUF
// à 0, qui est une règle grammaticale propre au FRANÇAIS (le repli « 0 fois »
// du calcul dit alors « 0 rang », correct en français) et ne se généralise
// pas : en anglais, allemand et espagnol, 0 prend le pluriel comme n'importe
// quel nombre ≥ 2 (« 0 rows », « 0 Reihen », « 0 filas »), exactement comme
// pour `times()` ci-dessous. `unitPlural()` force le pluriel là où aucun
// nombre n'est associé (ex. « le nombre de rangs » du texte d'invite).
const singularCount = (n) => Number(n) === 1 || (Number(n) === 0 && locale.value === 'fr')
const unit = (n) => {
  if (round.value) return t(singularCount(n) ? 'calc.unitRoundSing' : 'calc.unitRounds')
  return t(singularCount(n) ? 'calc.unitRowSing' : 'calc.unitRows')
}
const unitPlural = () => (round.value ? t('calc.unitRounds') : t('calc.unitRows'))
const unitSing = () => (round.value ? t('calc.unitRoundSing') : t('calc.unitRowSing'))

// Mot « fois » (fr/de invariables, en/es non), accordé comme l'unité
// ci-dessus mais avec une règle différente à 0 : contrairement à « 0 rang »
// (singulier propre au français), « 0 fois » est du PLURIEL partout où la
// distinction existe (« 0 times », « 0 veces ») — seul n === 1 est singulier.
const times = (n) => t(Number(n) === 1 ? 'calc.timesSing' : 'calc.timesPlural')

// Fragment « tous les N rangs » / « à chaque rang » (cadence ou intervalle
// x) : « tous les 1 rang » n'existe pas, donc x === 1 bascule sur la forme
// « à chaque » plutôt que d'accorder l'unité seule.
const everyFragment = (x) =>
  Number(x) === 1 ? t('calc.everyOne', { unitSing: unitSing() }) : t('calc.everyN', { x, unit: unit(x) })

// Libellé selon la forme de l'ouvrage : à plat on parle de rangs, en rond de
// tours. Deux clés distinctes par libellé (…/…Round) plutôt qu'une phrase à
// trou : une phrase à trou imposerait la même construction grammaticale aux
// quatre langues.
const label = (base) => (round.value ? t(`calc.${base}Round`) : t(`calc.${base}`))

// Libellé selon augmentations/diminutions : le champ « à chaque fois » ne
// parle pas de « mailles » dans l'absolu, mais d'augmentations ou de
// diminutions, comme `label()` ci-dessus le fait pour à plat/en rond.
const modeLabel = (base) => t(mode.value === 'inc' ? `calc.${base}Inc` : `calc.${base}Dec`)
</script>

<template>
<div>
  <AppHeader :title="t('calc.title')" back />
  <main class="screen">
    <div class="toggle">
      <button class="toggle__opt" :class="{ 'toggle__opt--on': mode === 'inc' }" @click="mode = 'inc'">{{ t('calc.inc') }}</button>
      <button class="toggle__opt" :class="{ 'toggle__opt--on': mode === 'dec' }" @click="mode = 'dec'">{{ t('calc.dec') }}</button>
    </div>
    <div class="toggle mt">
      <button class="toggle__opt" :class="{ 'toggle__opt--on': shape === 'flat' }" @click="shape = 'flat'">{{ t('calc.flat') }}</button>
      <button class="toggle__opt" :class="{ 'toggle__opt--on': shape === 'round' }" @click="shape = 'round'">{{ t('calc.round') }}</button>
    </div>
    <div class="toggle mt">
      <button class="toggle__opt" :class="{ 'toggle__opt--on': solveFor === 'rows' }" @click="solveFor = 'rows'">{{ t('calc.solveRows') }}</button>
      <button class="toggle__opt" :class="{ 'toggle__opt--on': solveFor === 'length' }" @click="solveFor = 'length'">{{ label('solveLength') }}</button>
    </div>

    <div class="mt"><FieldHelp for="calc-current" :label="t('calc.current')" :hint="t('calc.currentHint')" /></div>
    <input id="calc-current" v-model="current" class="input" inputmode="numeric" placeholder="60" />
    <div class="mt"><FieldHelp for="calc-target" :label="t('calc.target')" :hint="t('calc.targetHint')" /></div>
    <input id="calc-target" v-model="target" class="input" inputmode="numeric" placeholder="80" />
    <div class="mt"><FieldHelp for="calc-per-time" :label="modeLabel('perTime')" :hint="modeLabel('perTimeHint')" /></div>
    <input id="calc-per-time" v-model="perTime" class="input" inputmode="numeric" placeholder="1" />
    <template v-if="solveFor === 'rows'">
      <div class="mt"><FieldHelp for="calc-rows" :label="label('rows')" :hint="label('rowsHint')" /></div>
      <input id="calc-rows" v-model="rows" class="input" inputmode="numeric" placeholder="40" />
    </template>
    <template v-else>
      <div class="mt"><FieldHelp for="calc-cadence" :label="label('cadence')" :hint="label(mode === 'inc' ? 'cadenceHintInc' : 'cadenceHintDec')" /></div>
      <input id="calc-cadence" v-model="cadence" class="input" inputmode="numeric" placeholder="4" />
    </template>

    <div v-if="res.kind !== 'incomplete'" class="card resultbox">
      <p v-if="res.kind === 'mismatch'" class="result__main">{{ t('calc.mismatch') }}</p>
      <p v-else-if="res.kind === 'noChange'" class="result__main">{{ t('calc.noChange') }}</p>
      <template v-else>
        <p v-if="res.exact && res.kind === 'rows' && res.options[0].perTime === 1" class="result__lead">
          {{ mode === 'inc' ? t('calc.leadInc', { n: res.changes }) : t('calc.leadDec', { n: res.changes }) }}
        </p>
        <!-- Une augmentation vaut une MAILLE dans le vocabulaire de l'app (cf.
             le sens « Nombre de rangs »). Avec perTime === 1, mailles et fois
             coïncident : la phrase courante suffit. Avec perTime > 1 (manche à
             2 mailles à chaque fois...), il faut distinguer les deux nombres,
             sous peine de lire « 20 augmentations : × 10 » sans lien entre eux. -->
        <p v-else-if="res.exact && res.kind === 'rows'" class="result__lead">
          {{ mode === 'inc'
            ? t('calc.leadIncMulti', { c: res.changes, k: res.options[0].occurrences, s: res.options[0].perTime, times: times(res.options[0].occurrences) })
            : t('calc.leadDecMulti', { c: res.changes, k: res.options[0].occurrences, s: res.options[0].perTime, times: times(res.options[0].occurrences) }) }}
        </p>
        <p v-else-if="!res.exact" class="result__lead">
          {{ mode === 'inc' ? t('calc.notExactInc', { s: res.options[0].perTime }) : t('calc.notExactDec', { s: res.options[0].perTime }) }}
        </p>
        <div v-for="o in res.options" :key="o.occurrences" class="option">
          <p v-if="!res.exact" class="option__head">
            {{ t('calc.optionTimes', { k: o.occurrences, st: o.stitches, times: times(o.occurrences) }, o.stitches) }}
            <span class="option__delta">({{ o.delta < 0 ? t('calc.deltaLess', { d: -o.delta }) : t('calc.deltaMore', { d: o.delta }) }})</span>
          </p>
          <template v-if="res.kind === 'rows'">
            <ul v-if="!o.dense" class="result__list">
              <li v-if="o.a">{{ t('calc.everyTimes', { every: everyFragment(o.base), count: o.a }) }}</li>
              <li v-if="o.b">{{ t('calc.everyTimes', { every: everyFragment(o.base + 1), count: o.b }) }}</li>
            </ul>
            <p v-else-if="o.perTime === 1" class="result__dense">{{ t('calc.dense', { per: o.perRow, unit: unitSing() }) }}</p>
            <!-- Idem : « ≈ 2 par rang » sous-entendrait 2 mailles quand perTime
                 vaut 2 fois plus (2 fois × 2 mailles = 4 mailles par rang). -->
            <p v-else class="result__dense">{{ t('calc.denseMulti', { per: o.perRow, st: o.perRow * o.perTime, unit: unitSing(), times: times(o.perRow) }) }}</p>
          </template>
          <template v-else>
            <p v-if="res.exact" class="result__headline">{{ t('calc.lengthMain', { n: o.rows, unit: unit(o.rows) }) }}</p>
            <p v-else class="result__dense">{{ t('calc.optionRows', { n: o.rows, unit: unit(o.rows) }) }}</p>
            <!-- Une augmentation vaut une MAILLE dans le vocabulaire de l'app
                 (cf. « Répartis 20 augmentations » dans l'autre sens). Avec
                 perTime === 1, occurrences et mailles coïncident : la phrase
                 courante suffit, mais explicitement avec res.changes pour que
                 ça ne soit plus une coïncidence. Avec perTime > 1 (manche à 2
                 mailles à chaque fois...), il faut distinguer les FOIS des
                 MAILLES : une autre phrase compte les deux. -->
            <p v-if="res.exact && o.perTime === 1" class="result__detail">
              {{ mode === 'inc'
                ? t('calc.lengthDetailInc', { n: res.changes, every: everyFragment(o.cadence) })
                : t('calc.lengthDetailDec', { n: res.changes, every: everyFragment(o.cadence) }) }}
            </p>
            <p v-else-if="res.exact" class="result__detail">
              {{ mode === 'inc'
                ? t('calc.lengthDetailMultiInc', { c: res.changes, k: o.occurrences, s: o.perTime, every: everyFragment(o.cadence), times: times(o.occurrences) })
                : t('calc.lengthDetailMultiDec', { c: res.changes, k: o.occurrences, s: o.perTime, every: everyFragment(o.cadence), times: times(o.occurrences) }) }}
            </p>
            <p v-if="res.exact" class="result__detail">
              {{ mode === 'inc'
                ? t('calc.lastRowInc', { n: o.rows, unitSing: unitSing() })
                : t('calc.lastRowDec', { n: o.rows, unitSing: unitSing() }) }}
            </p>
          </template>
        </div>
        <p v-if="res.exact" class="result__final">{{ t('calc.final', { target }, Number(target)) }}</p>
      </template>
    </div>
    <p v-else class="muted mt">{{ solveFor === 'rows' ? t('calc.fillIn') : t('calc.fillInLength', { unit: unitPlural() }) }}</p>
  </main>
</div>
</template>

<style scoped>
.toggle { display: flex; gap: var(--sp-2); background: var(--bg); border: 1px solid var(--line); border-radius: var(--r-pill); padding: 4px; }
.toggle__opt { flex: 1; border: none; background: transparent; color: var(--ink-55); font-weight: 600; padding: 10px; border-radius: var(--r-pill); }
.toggle__opt--on { background: var(--brand); color: var(--on-accent); }
.mt { margin-top: var(--sp-3); }
.muted { color: var(--ink-55); }
.resultbox { margin-top: var(--sp-5); background: var(--surface-lin); }
.result__lead { font-weight: 600; color: var(--ink); margin: 0 0 var(--sp-2); }
.result__list { margin: 0; padding-left: var(--sp-5); color: var(--brand-deep); }
.result__list li { font-family: var(--font-display); font-size: 17px; padding: 3px 0; }
.result__dense { font-family: var(--font-display); font-size: 17px; color: var(--brand-deep); margin: 0; }
.result__final { color: var(--ink-55); font-size: 13px; margin: var(--sp-3) 0 0; }
.result__detail { color: var(--ink-55); font-size: 13.5px; margin: var(--sp-1) 0 0; }
.result__headline { font-family: var(--font-display); font-size: 22px; color: var(--brand-deep); margin: 0 0 var(--sp-2); }
.option { margin-top: var(--sp-3); }
.option:first-of-type { margin-top: 0; }
.option__head { font-weight: 600; color: var(--ink); margin: 0 0 var(--sp-1); }
.option__delta { font-weight: 400; color: var(--ink-55); font-size: 13px; }
</style>
