<script setup>
// Diagramme interactif : image du diagramme (source de vérité) + suivi de rang par-dessus
// (bande surlignée sur le rang courant, rangs faits estompés) + compteur « Rang X / total ».
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { chartBands, chartRings, chartPathRows, nextChartPosition, readDirLabel, chartMotifLabel } from '@/utils/reader'
import AppIcon from '@/components/AppIcon.vue'

const { t } = useI18n()

const props = defineProps({
  chart: { type: Object, required: true }, // { rows, img, repeat, readDir, reps? }
  modelValue: { type: Number, default: 1 }, // rang courant (1..rows)
  currentRep: { type: Number, default: 1 }, // répétition courante du diagramme (1..chart.reps)
  readOnly: { type: Boolean, default: false }, // aperçu patron : diagramme non interactif
  frame: { type: Object, default: null }, // calage { top, bottom } (%) — null = plein cadre
})
const emit = defineEmits(['update:modelValue', 'update:currentRep', 'request-reps', 'request-rows', 'zoom'])

const viewport = ref(null)
const hl = ref(null)
const canvasEl = ref(null)
// Grille importée : le nombre de rangs est inconnu tant que la tricoteuse ne l'a pas indiqué
// (rows:0 = sentinel « à renseigner »). Sans rows connu, pas de suivi rang-par-rang ni de bandes.
const hasRows = computed(() => Number(props.chart.rows) > 0)
const isRadial = computed(() => props.chart.shape === 'radial-square' || props.chart.shape === 'radial-circle')
const isPath = computed(() => props.chart.shape === 'path')
// Grille classique (ni radiale ni tracé) : les bandes de suivi haut/bas, seules pertinentes
// pour cette forme, sont conditionnées à ce seul booléen plutôt qu'à `!isRadial && !isPath`
// répété à chaque site d'affichage.
const isLinear = computed(() => !isRadial.value && !isPath.value)
const pathRows = computed(() => chartPathRows(props.frame?.points, props.chart.rows, props.frame?.spacing))
const rings = computed(() => chartRings(props.modelValue, props.chart.rows, props.frame, props.chart.shape))
const bands = computed(() => chartBands(props.modelValue, props.chart.rows, props.frame))
// Les deux cartes d'étape (nombre de rangs + calage) sont visibles ensemble uniquement
// pour une grille fraîche (rangs inconnus ET non calée) → on numérote 1/2 dans ce seul cas.
const bothSteps = computed(() => !props.readOnly && !props.frame && !hasRows.value)
// Revue finale (31/07) : `chart.repeat` ne survit pas à un aller-retour Rowtine-MD
// (import zip, synchro patron.md) — voir le commentaire de parse.js. `chartMotifLabel`
// affiche le libellé fourni verbatim, ou le reconstruit à partir de cols/rows dans la
// langue courante quand il est absent, sans jamais rien fabriquer en français en dur.
const motifLabel = computed(() => chartMotifLabel(props.chart, t))
// Même logique que `isLinear` (ligne 31) : nommée une seule fois plutôt que répétée en
// ternaire en chaîne au site d'affichage.
const calibrateInviteKey = computed(() =>
  isRadial.value
    ? 'reader.chart.calibrateInviteRadial'
    : isPath.value
      ? 'reader.chart.calibrateInvitePath'
      : 'reader.chart.calibrateInvite',
)

// Voir le commentaire jumeau dans ChartStage.vue (même contrat, même raison) — le ratio
// largeur/hauteur réel du canvas, nécessaire pour qu'une ellipse radial-circle reste ronde
// sur une image non carrée. Exposé pour les tests, qui ne peuvent pas dépendre de jsdom
// pour calculer une vraie mise en page.
const canvasAspect = ref(1)
let canvasRO = null
onMounted(() => {
  if (canvasEl.value && typeof ResizeObserver !== 'undefined') {
    canvasRO = new ResizeObserver(() => {
      const r = canvasEl.value?.getBoundingClientRect()
      if (r && r.height > 0) canvasAspect.value = r.width / r.height
    })
    canvasRO.observe(canvasEl.value)
  }
})
onUnmounted(() => canvasRO?.disconnect())

defineExpose({ canvasAspect })

function setRow(r) {
  const next = nextChartPosition(props.chart, props.modelValue, props.currentRep, r - props.modelValue)
  if (next.rep !== props.currentRep) emit('update:currentRep', next.rep)
  emit('update:modelValue', next.row)
}
// recentrer le viewport sur le rang courant à chaque changement
watch(
  () => props.modelValue,
  async () => {
    await nextTick()
    const vp = viewport.value
    const band = hl.value
    if (vp && band) vp.scrollTop = band.offsetTop - vp.clientHeight / 2 + band.offsetHeight / 2
  },
)
</script>

<template>
  <div class="chart">
    <div class="chart__title">
      <AppIcon name="motif" :size="18" /> {{ $t('reader.chart.title') }}
      <div class="chart__title-tools">
        <!-- Emplacement pour les commandes du propriétaire (ReaderView y met « Afficher à
             droite » / « Ramener dans le texte »). Ce composant ignore volontairement ce
             qu'est le mode deux volets : il est aussi monté par le banc tools/mdedit, qui ne
             fournit jamais ce slot — sans contenu, ce conteneur ne porte alors que le bouton
             plein écran, à l'identique d'avant (le `margin-left: auto` qui le pousse à droite
             est resté sur ce conteneur, pas sur `.chart__zoom`, précisément pour que les deux
             groupes de boutons restent collés l'un à l'autre quand le slot est fourni). -->
        <slot name="title-actions" />
        <button class="chart__zoom" :aria-label="$t('reader.chart.zoomOpen')" @click="emit('zoom')"><AppIcon name="expand" :size="18" /></button>
      </div>
    </div>
    <p v-if="motifLabel && isLinear" class="chart__read">
      {{ $t('reader.chart.read', { dir: readDirLabel(chart.readDir, t) }) }} · {{ $t('reader.chart.motif', { motif: motifLabel }) }}
    </p>
    <!-- Étape 1 — grille importée sans nombre de rangs : le renseigner active le suivi rang-par-rang. -->
    <button v-if="!readOnly && !hasRows" class="chart__setrows" @click="emit('request-rows')">
      <span v-if="bothSteps" class="chart__stepnum">1</span>
      <AppIcon name="motif" :size="16" aria-hidden="true" />
      {{ $t('reader.chart.setRows') }}
    </button>
    <!-- Étape 2 — inviter au calage (retour terrain 26/08 : granny/path en avaient été
         exclus, sans autre entrée possible que de deviner le zoom plein écran ; le libellé
         varie par forme, seul le rideau de suivi (curtainhint) reste propre au calage
         haut/bas — aucune capacité équivalente pour radial/path). -->
    <button v-if="!readOnly && !frame" class="chart__calinvite" @click="emit('zoom')">
      <span v-if="bothSteps" class="chart__stepnum">2</span>
      <AppIcon name="calibrate" :size="16" aria-hidden="true" />
      {{ $t(calibrateInviteKey) }}
    </button>
    <p v-if="!readOnly && !frame && isLinear" class="chart__curtainhint">{{ $t('reader.chart.curtainDiscover') }}</p>
    <div v-if="!readOnly && hasRows" class="chart__rowbar">
      <span class="chart__lab">{{ $t('reader.chart.row') }}</span>
      <button class="chart__btn" :disabled="modelValue <= 1" :aria-label="$t('reader.chart.prev')" @click="setRow(modelValue - 1)"><AppIcon name="minus" :size="16" /></button>
      <span class="chart__val">{{ modelValue }} / {{ chart.rows }}</span>
      <button class="chart__btn chart__next" :aria-label="$t('reader.chart.next')" @click="setRow(modelValue + 1)"><AppIcon name="plus" :size="16" /></button>
      <!-- Corriger un nombre de rangs déjà saisi (retour terrain 26/08 : une fois indiqué, plus
           aucun moyen de rectifier une erreur de frappe, sinon en rouvrant les outils de dev). -->
      <button class="chart__btn chart__editrows" :aria-label="$t('reader.chart.editRows')" @click="emit('request-rows')"><AppIcon name="edit" :size="14" aria-hidden="true" /></button>
    </div>
    <div v-if="!readOnly && hasRows && Number(chart.reps) > 0" class="chart__repbar">
      <span class="chart__lab">{{ $t('reader.chart.rep') }}</span>
      <button class="chart__btn" :disabled="currentRep <= 1" :aria-label="$t('reader.chart.repPrev')" @click="emit('update:currentRep', currentRep - 1)"><AppIcon name="minus" :size="16" /></button>
      <span class="chart__repval">{{ currentRep }} / {{ chart.reps }}</span>
      <button class="chart__btn" :disabled="currentRep >= chart.reps" :aria-label="$t('reader.chart.repNext')" @click="emit('update:currentRep', currentRep + 1)"><AppIcon name="plus" :size="16" /></button>
    </div>
    <button v-else-if="!readOnly && hasRows" class="chart__addrep btn" @click="emit('request-reps')"><AppIcon name="plus" :size="17" /> {{ $t('reader.chart.addRep') }}</button>
    <div v-if="hasRows && isLinear && Number(chart.cols) > 0" class="chart__colhint">
      <span>{{ $t('reader.chart.stitchN', { n: chart.cols }) }}</span>
      <!-- La flèche montre la direction, elle ne se dit pas : c'est le seul des six
           caractères hors police (21/08/2026) qui devait rester un signe, pas un mot. -->
      <span class="chart__sense"><AppIcon name="arrowLeft" :size="12" aria-hidden="true" /> {{ $t('reader.chart.readSense') }}</span>
      <span>{{ $t('reader.chart.firstStitch') }}</span>
    </div>
    <div v-if="hasRows && isLinear" class="chart__end"><AppIcon name="chevronUp" :size="12" aria-hidden="true" /> {{ $t('reader.chart.rowEnd', { n: chart.rows }) }}</div>
    <!-- Image du diagramme, ou ce que le propriétaire met à sa place quand elle est déjà
         visible ailleurs à l'écran (volet droit). Le contenu n'est jamais supprimé sans
         remplacement — cf. le slot ci-dessus, même logique d'agnosticisme. -->
    <slot v-if="$slots['viewport-replacement']" name="viewport-replacement" />
    <!-- tabindex : la zone est défilable → focusable au clavier (a11y, axe scrollable-region-focusable) -->
    <div v-else ref="viewport" class="chart__viewport" tabindex="0" role="group" :aria-label="$t('reader.chart.title')">
      <div ref="canvasEl" class="chart__canvas">
        <img :src="chart.img" :alt="$t('reader.chart.alt', { motif: motifLabel })" style="cursor: zoom-in" @click="emit('zoom')" />
        <template v-if="!readOnly && hasRows">
          <!-- Compensation d'aspect du carré (retour terrain 26/08, APRÈS l'assistant de calage
               à loupe fixe) : voir le commentaire jumeau dans ChartStage.vue — le calage se fait
               désormais sur une loupe CSS toujours réellement carrée, indépendante du canevas ;
               `height`/`y` suivent donc `canvasAspect` comme `ry` de l'ellipse ci-dessous. -->
          <svg v-if="isRadial" class="chart__rings" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <rect v-if="rings.doneShape === 'square'" class="chart__ring chart__ring--done" :x="rings.cx - rings.doneR" :y="rings.cy - rings.doneR * canvasAspect" :width="rings.doneR * 2" :height="rings.doneR * 2 * canvasAspect" :stroke-width="rings.doneStrokeWidth" />
            <!-- Contour à couleur FIXE (indépendante teinte/thème) sous la bande colorée : garantit
                 ≥3:1 (WCAG 1.4.11) même quand --brand ne peut pas l'atteindre (cf. .chart__ring--hl-edge). -->
            <rect v-if="rings.hlShape === 'square'" class="chart__ring chart__ring--hl-edge" :x="rings.cx - rings.hlR" :y="rings.cy - rings.hlR * canvasAspect" :width="rings.hlR * 2" :height="rings.hlR * 2 * canvasAspect" :stroke-width="rings.hlStrokeWidth + 3" />
            <rect v-if="rings.hlShape === 'square'" class="chart__ring chart__ring--hl" :x="rings.cx - rings.hlR" :y="rings.cy - rings.hlR * canvasAspect" :width="rings.hlR * 2" :height="rings.hlR * 2 * canvasAspect" :stroke-width="rings.hlStrokeWidth" />
            <ellipse v-if="rings.doneShape === 'circle'" class="chart__ring chart__ring--done" :cx="rings.cx" :cy="rings.cy" :rx="rings.doneR" :ry="rings.doneR * canvasAspect" :stroke-width="rings.doneStrokeWidth" />
            <ellipse v-if="rings.hlShape === 'circle'" class="chart__ring chart__ring--hl-edge" :cx="rings.cx" :cy="rings.cy" :rx="rings.hlR" :ry="rings.hlR * canvasAspect" :stroke-width="rings.hlStrokeWidth + 3" />
            <ellipse v-if="rings.hlShape === 'circle'" class="chart__ring chart__ring--hl" :cx="rings.cx" :cy="rings.cy" :rx="rings.hlR" :ry="rings.hlR * canvasAspect" :stroke-width="rings.hlStrokeWidth" />
          </svg>
          <svg v-else-if="isPath" class="chart__path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <polyline
              v-for="(pts, i) in pathRows"
              :key="i"
              :points="pts.map((p) => `${p.x},${p.y}`).join(' ')"
              class="chart__pathrow"
              :class="{ 'chart__pathrow--hl': i + 1 === modelValue, 'chart__pathrow--done': i + 1 < modelValue, 'chart__pathrow--future': i + 1 > modelValue }"
            />
          </svg>
          <template v-else>
            <div class="chart__done" :style="{ top: bands.doneTop + '%', height: bands.doneHeight + '%' }"></div>
            <div ref="hl" class="chart__hl" :style="{ top: bands.hlTop + '%', height: bands.hlHeight + '%' }"></div>
          </template>
        </template>
      </div>
    </div>
    <div v-if="isLinear" class="chart__start"><AppIcon name="chevronDown" :size="12" aria-hidden="true" /> {{ $t('reader.chart.rowStart') }} · {{ $t('reader.chart.scrollHint') }}</div>
    <div v-if="chart.builtinLegend !== false" class="chart__legend">
      <div class="chart__lg"><span class="chart__sw"></span> {{ $t('reader.chart.legendKnit') }}</div>
      <div class="chart__lg"><span class="chart__sw chart__sw--dot"></span> {{ $t('reader.chart.legendPurl') }}</div>
    </div>
  </div>
</template>

<style scoped>
.chart {
  background: var(--tile);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  box-shadow: var(--clay);
  padding: var(--sp-4);
}
.chart__title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 17px;
}
/* Porte le `margin-left: auto` (au lieu de .chart__zoom) : ce conteneur, pas le bouton
   lui-même, doit être poussé à droite, pour que le contenu du slot title-actions et le
   bouton plein écran restent groupés et collés l'un à l'autre. */
.chart__title-tools {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}
.chart__zoom {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--tile);
  box-shadow: var(--clay-sm);
  color: var(--brand-deep);
  display: grid;
  place-items: center;
}
.chart__read {
  font-size: 12px;
  color: var(--ink-70);
  margin: 2px 0 var(--sp-3);
}
.chart__curtainhint {
  font-size: 12px;
  color: var(--ink-55);
  margin: 0 0 var(--sp-3);
}
.chart__calinvite,
.chart__setrows {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  margin-bottom: var(--sp-3);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--brand-deep);
  font-weight: 700;
  text-align: left;
}
.chart__calinvite {
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--line);
  font-size: 12.5px;
}
.chart__setrows {
  padding: var(--sp-3);
  border: 1px dashed var(--brand);
  font-size: 13px;
}
.chart__stepnum {
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--brand);
  color: var(--on-accent);
  font-size: 12px;
  font-weight: 800;
  display: grid;
  place-items: center;
}
.chart__rowbar {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin-bottom: var(--sp-3);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: var(--sp-2) var(--sp-3);
  box-shadow: var(--clay-press);
}
.chart__lab {
  flex: 1;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink-55);
}
.chart__val {
  font-weight: 800;
  font-size: 17px;
  min-width: 74px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  color: var(--brand-deep);
}
.chart__btn {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--tile);
  box-shadow: var(--clay-sm);
  font-size: 20px;
  font-weight: 700;
  color: var(--brand-deep);
  display: grid;
  place-items: center;
}
.chart__btn:active {
  transform: scale(0.9);
  box-shadow: var(--clay-press);
}
.chart__btn:disabled {
  opacity: 0.35;
  box-shadow: none;
}
.chart__colhint {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--ink-55);
  font-weight: 700;
  padding: 0 2px 4px;
}
/* L'icône du sens de lecture s'aligne sur la ligne de texte au lieu de poser sa
   propre boîte : sans ça, le <span> grandit et décale les deux repères voisins. */
.chart__sense {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.chart__end,
.chart__start {
  font-size: 11px;
  font-weight: 700;
  color: var(--sage-deep);
  text-align: center;
  padding: 2px 0;
}
.chart__start {
  color: var(--brand-deep);
}
.chart__viewport {
  position: relative;
  max-height: 460px;
  overflow-y: scroll; /* ascenseur toujours visible : on voit tout de suite que ça défile */
  border-radius: var(--r-md);
  border: 1px solid var(--line);
  background: #fff;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: thin;
  scrollbar-color: var(--brand) var(--surface);
}
.chart__viewport::-webkit-scrollbar {
  width: 10px;
}
.chart__viewport::-webkit-scrollbar-track {
  background: var(--surface);
  border-radius: var(--r-pill);
}
.chart__viewport::-webkit-scrollbar-thumb {
  background: var(--brand);
  border-radius: var(--r-pill);
  border: 2px solid var(--surface);
}
.chart__canvas {
  position: relative;
  width: 100%;
}
.chart__canvas img {
  display: block;
  width: 100%;
  height: auto;
}
.chart__done {
  position: absolute;
  left: 0;
  right: 0;
  background: rgba(90, 122, 94, 0.16);
  border-bottom: 1.5px solid var(--sage);
  pointer-events: none;
}
/* Retour terrain 26/08 : --brand plafonne à ~2:1 contre le papier blanc du diagramme en
   thème sombre, quelle que soit la teinte choisie — cf. le même commentaire, plus détaillé,
   dans ChartStage.vue (fullscreen), qui porte la correction jumelle. */
.chart__hl {
  position: absolute;
  left: 0;
  right: 0;
  background: rgba(var(--brand-rgb), 0.16);
  box-shadow: inset 0 0 0 2px var(--brand), inset 0 0 0 4px rgba(58, 46, 40, 0.55);
  pointer-events: none;
}
.chart__rings { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.chart__ring { fill: none; }
.chart__ring--done { stroke: var(--sage); stroke-opacity: 0.45; }
.chart__ring--hl-edge { stroke: rgba(58, 46, 40, 0.55); }
.chart__ring--hl { stroke: var(--brand); stroke-opacity: 0.45; }
.chart__path { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.chart__pathrow { fill: none; stroke-width: 0.8; }
.chart__pathrow--hl { stroke: var(--brand); stroke-width: 1.2; }
.chart__pathrow--done { stroke: var(--sage); }
.chart__pathrow--future { stroke: rgba(58, 46, 40, 0.32); }
.chart__legend {
  margin-top: var(--sp-3);
  font-size: 12.5px;
  color: var(--ink-70);
}
.chart__lg {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}
.chart__sw {
  width: 20px;
  height: 20px;
  border: 1px solid var(--ink-40);
  border-radius: 4px;
  flex: none;
  display: grid;
  place-items: center;
  background: #fff;
}
/* Le fond de .chart__sw est FIXE (#fff, papier du diagramme, cf. commentaire sur le
   point intérieur ci-dessous) mais sa bordure suit encore var(--ink-40), qui s'inverse
   en sombre (teinte claire) et devient quasi invisible sur ce même blanc fixe (1,08:1
   mesuré). Même traitement que le point intérieur : couleur fixe, indépendante du
   thème — mesuré ≥ 3:1 sur #fff. */
:root[data-theme='dark'] .chart__sw,
html[data-theme='dark'] .chart__sw {
  border-color: #8a8a8a;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .chart__sw {
    border-color: #8a8a8a;
  }
}
.chart__sw--dot::after {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  /* Fixe (pas var(--ink), qui s'inverse en sombre) : le fond du pastille .chart__sw
     reste blanc à dessein, comme le diagramme (fond papier), donc le point doit
     rester sombre lui aussi, sinon il deviendrait un point crème invisible sur blanc. */
  background: #3a2e28;
}
</style>
