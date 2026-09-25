<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { chartBands, chartRings, hexagonPoints, chartPathRows, DEFAULT_PATH_SPACING, nextChartPosition, curtainBand, retractCurtain, flipCurtainSide, chartMotifLabel } from '@/utils/reader'
import { usePinchZoom } from '@/composables/usePinchZoom'
import AppIcon from '@/components/AppIcon.vue'
import RadialCalibrationWizard from '@/components/RadialCalibrationWizard.vue'

const props = defineProps({
  chart: { type: Object, required: true },
  row: { type: Number, default: 1 },
  rep: { type: Number, default: 1 },
  frame: { type: Object, default: null },
  curtain: { type: Object, default: null },
  readOnly: { type: Boolean, default: false },
  variant: { type: String, default: 'full' }, // 'full' | 'panel'
})
const emit = defineEmits(['update:row', 'update:rep', 'update:frame', 'update:curtain'])

const { t } = useI18n()

const viewport = ref(null)
const canvasEl = ref(null)
const { zoom, setZoom, onPointerDown, onPointerMove, onPointerUp, reset: resetZoom, activePointers } = usePinchZoom({ getViewport: () => viewport.value })
const calibrating = ref(false)
const draft = ref({ top: 0, bottom: 100 })
const draftPath = ref({ points: [], spacing: DEFAULT_PATH_SPACING })
let dragging = null // 'top' | 'bottom'

// Arrondi au dixième, motif répété à chaque écriture de coordonnée/borne en pourcentage
// dans ce fichier (poignées, points de tracé, rideau) — factorisé pour ne porter le calcul
// qu'à un seul endroit.
const round1 = (n) => Math.round(n * 10) / 10

const chart = computed(() => props.chart || {})
// Revue finale (31/07) : `chart.repeat` ne survit pas à un aller-retour Rowtine-MD
// (import zip, synchro patron.md) — voir ReaderChart.vue et parse.js pour le détail.
const motifLabel = computed(() => chartMotifLabel(chart.value, t))
const isRadial = computed(() => chart.value.shape === 'radial-square' || chart.value.shape === 'radial-circle' || chart.value.shape === 'radial-hexagon')
const isPath = computed(() => chart.value.shape === 'path')
const pathRows = computed(() =>
  chartPathRows(
    calibrating.value && isPath.value ? draftPath.value.points : frame.value?.points,
    chart.value.rows,
    calibrating.value && isPath.value ? draftPath.value.spacing : frame.value?.spacing,
  ),
)
const rings = computed(() => chartRings(row.value, chart.value.rows, frame.value, chart.value.shape))
const hexOrientation = computed(() => (frame.value?.hexOrientation === 'pointy' ? 'pointy' : 'flat'))
function hexRingPoints(r) {
  return hexagonPoints(rings.value.cx, rings.value.cy, r, hexOrientation.value, canvasAspect.value)
    .map((p) => `${p.x},${p.y}`)
    .join(' ')
}
// Le cadre SVG (viewBox 100×100, preserveAspectRatio="none") étire ses deux axes selon le
// ratio réel du canvas — voir la note "Décision : compensation d'aspect" du plan. `ry` d'une
// ellipse radial-circle en dépend ; lu ici plutôt que fixé à 1, mis à jour au montage et à
// chaque redimensionnement du canvas (image chargée, fenêtre redimensionnée). Exposé pour
// que les tests puissent forcer une valeur sans dépendre de la mise en page réelle de jsdom
// (qui ne calcule jamais de vraies dimensions).
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

// Composant CONTRÔLÉ : l'état local n'est qu'un tampon d'affichage, la vérité est chez le
// propriétaire (ReaderView). Deux instances peuvent être montées en même temps (le volet
// droit + le plein écran ouvert par-dessus) : sans cette resynchronisation, le volet
// resterait figé sur le rang d'avant après la fermeture du plein écran.
const row = ref(props.row || 1)
const rep = ref(props.rep || 1)
const frame = ref(props.frame || null)
const curtain = ref(props.curtain || null)
watch(() => props.row, (v) => { row.value = v || 1 })
watch(() => props.rep, (v) => { rep.value = v || 1 })
// Course entre les deux instances (volet + plein écran) : un calage peut être ENREGISTRÉ
// dans l'une pendant que l'autre est restée en mode `calibrating` avec un brouillon (`draft`)
// non sauvegardé. Sans sortir cette 2e instance du mode calage, son brouillon obsolète pourrait
// ensuite écraser le calage qui vient d'être enregistré ailleurs. `props.frame` est la SEULE
// donnée qui matérialise un calage enregistré à l'extérieur (calibrating n'est jamais dans les
// props, il est purement local à chaque instance) — on la traite donc comme le signal.
// Aucun effet visible dans l'instance QUI VIENT d'enregistrer : `saveCalibrate` sort déjà de
// `calibrating` avant d'émettre, ce `false` supplémentaire, quand la prop revient via le
// magasin, est un no-op.
watch(() => props.frame, (v) => { frame.value = v || null; calibrating.value = false })
watch(() => props.curtain, (v) => { curtain.value = v || null })
// Diagramme remplacé (on épingle une autre grille dans le volet) : le zoom repart à 100 %,
// sinon la nouvelle image hérite du zoom de la précédente, calé sur d'autres proportions.
// Le DÉFILEMENT du viewport doit repartir en haut/à gauche pour la même raison :
// sans ceci, la nouvelle grille s'affiche là où le scroll de la précédente l'avait laissée
// (potentiellement au milieu de l'image), pas depuis son premier rang.
watch(() => props.chart, () => {
  resetZoom()
  calibrating.value = false
})

// Grille importée sans nombre de rangs saisi (rows:0) : pas de suivi rang-par-rang ni de
// bandes en plein écran non plus (miroir de ReaderChart) — l'image reste zoomable.
const hasRows = computed(() => Number(chart.value.rows) > 0)
// bandes : pendant le calage, aperçu sur le draft (le surlignage suit les poignées)
const bands = computed(() => chartBands(row.value, chart.value.rows, calibrating.value ? draft.value : frame.value))
// Rideau : x/side avec repli sur l'état rétracté par défaut quand rien n'a encore été posé
// (curtain.value === null) — même principe que `bands` pour `frame`.
const effectiveCurtain = computed(() =>
  curtain.value && Number.isFinite(curtain.value.x) ? curtain.value : retractCurtain(curtain.value),
)
const curtainRect = computed(() => curtainBand(effectiveCurtain.value))

// Focus initial du dialogue : c'est la coquille (ChartFullscreen) qui le pilote, mais le
// viewport défilant vit ici — on lui expose donc le seul geste dont elle a besoin.
function focusViewport() {
  viewport.value?.focus()
}
defineExpose({ focusViewport, canvasAspect, draftPath })

// ─── Suivi rang/répétition ────────────────────────────────────────────────────
function step(delta) {
  const next = nextChartPosition(chart.value, row.value, rep.value, delta)
  // Borne atteinte (rang 1, ou dernier rang de la dernière répétition) : rien ne bouge,
  // donc rien à émettre, sinon le parent persiste `worked: true` et inscrit un jour actif.
  if (next.row === row.value && next.rep === rep.value) return
  if (next.rep !== rep.value) {
    rep.value = next.rep
    emit('update:rep', next.rep)
  }
  row.value = next.row
  if (curtain.value) curtain.value = retractCurtain(curtain.value)
  emit('update:row', next.row)
}

// ─── Mode caler (poignées haut/bas) ──────────────────────────────────────────
function startCalibrate() {
  // Radial : rien à préparer ici, RadialCalibrationWizard lit `frame` directement et
  // gère son propre brouillon (draft interne au composant).
  if (isPath.value) {
    draftPath.value = {
      points: Array.isArray(frame.value?.points) ? frame.value.points.map((p) => ({ x: p.x, y: p.y })) : [],
      spacing: Number.isFinite(frame.value?.spacing) ? frame.value.spacing : DEFAULT_PATH_SPACING,
    }
  } else if (!isRadial.value) {
    draft.value = { top: frame.value?.top ?? 0, bottom: frame.value?.bottom ?? 100 }
  }
  calibrating.value = true
}
function cancelCalibrate() {
  calibrating.value = false
}
// Tracé : moins de 2 repères ne décrit aucun rang. L'enregistrer effaçait l'affichage des
// rangs ET l'invite de calage (le `frame` n'étant plus nul), sans aucun signal.
const pathTooShort = computed(() => isPath.value && draftPath.value.points.length < 2)
function saveCalibrate() {
  if (pathTooShort.value) return
  calibrating.value = false
  const next = isPath.value
    ? { points: draftPath.value.points.map((p) => ({ x: p.x, y: p.y })), spacing: draftPath.value.spacing }
    : { ...draft.value }
  frame.value = next
  emit('update:frame', next)
}
function onRadialWizardSave(next) {
  calibrating.value = false
  frame.value = next
  emit('update:frame', next)
}
function resetCalibrate() {
  calibrating.value = false
  frame.value = null
  emit('update:frame', null)
}
function onHandleDown(which, e) {
  dragging = which
  e.target.setPointerCapture?.(e.pointerId)
}
function onHandleMove(e) {
  if (!dragging || !canvasEl.value) return
  const r = canvasEl.value.getBoundingClientRect()
  const pct = Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100))
  const d = draft.value
  if (dragging === 'top') d.top = Math.min(pct, d.bottom - 5)
  else d.bottom = Math.max(pct, d.top + 5)
  draft.value = { top: round1(d.top), bottom: round1(d.bottom) }
}
function onHandleUp() {
  dragging = null
}
// Accessibilité clavier des poignées : ArrowUp/ArrowLeft diminuent le %, Arrow-
// Down/ArrowRight l'augmentent (0 % = haut de l'image, cf. l'axe Y du drag) ; Shift = pas de
// 5 au lieu de 1. Mêmes bornes ±5 % que le drag (onHandleMove ci-dessus).
function onHandleKey(which, e) {
  const STEP = e.shiftKey ? 5 : 1
  let dir
  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') dir = -1
  else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') dir = 1
  else return
  e.preventDefault()
  const d = { ...draft.value }
  if (which === 'top') d.top = Math.max(0, Math.min(d.bottom - 5, d.top + dir * STEP))
  else d.bottom = Math.min(100, Math.max(d.top + 5, d.bottom + dir * STEP))
  draft.value = { top: round1(d.top), bottom: round1(d.bottom) }
}

// ─── Mode caler par tracé (pose/déplace/supprime des repères + espacement) ─────────────────
// Trois gestes sur le même canvas : glisser un repère existant (déplace), taper sur un
// repère existant SANS glisser (supprime, si > 2 restent), taper sur le canvas EN DEHORS
// de tout repère (ajoute). Seuil de 5px, même convention que le rideau/les poignées radiales.
//
// PAS de stopPropagation (contrairement à une 1re version) : même raison que le rideau plus
// bas dans ce fichier — .cfs__canvas est un enfant de .cfs__viewport, qui a besoin de voir
// CHAQUE doigt pour que son pincement (usePinchZoom) reste correct, y compris en LECTURE
// normale d'un diagramme par tracé (pas seulement pendant le calage). On laisse donc les
// events bulle normalement et on lit `activePointers()` pour décider, uniquement pour NOUS-
// MÊMES, si ce tap doit compter comme "ajouter un repère" — jamais pour bloquer le pincement.
let canvasPointerStart = null
function onPathCanvasDown(e) {
  if (!calibrating.value || !isPath.value) return
  if (activePointers() > 0) return // un doigt déjà posé ailleurs = pincement en cours, pas un tap solo
  canvasPointerStart = { x: e.clientX, y: e.clientY }
}
function onPathCanvasUp(e) {
  if (!calibrating.value || !isPath.value || !canvasPointerStart) return
  if (activePointers() >= 2) { canvasPointerStart = null; return } // 2e doigt arrivé depuis : on cède au pincement
  if (!canvasEl.value) { canvasPointerStart = null; return }
  const moved = Math.hypot(e.clientX - canvasPointerStart.x, e.clientY - canvasPointerStart.y)
  canvasPointerStart = null
  if (moved > 5) return
  const r = canvasEl.value.getBoundingClientRect()
  const px = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100))
  const py = Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100))
  draftPath.value = {
    ...draftPath.value,
    points: [...draftPath.value.points, { x: round1(px), y: round1(py) }],
  }
}
let draggingPointIndex = null
let pointDragStart = null
let pointDragMoved = false
function onPathPointDown(index, e) {
  draggingPointIndex = index
  pointDragStart = { x: e.clientX, y: e.clientY }
  pointDragMoved = false
  e.target.setPointerCapture?.(e.pointerId)
}
function onPathPointMove(e) {
  if (draggingPointIndex === null || !canvasEl.value) return
  if (Math.hypot(e.clientX - pointDragStart.x, e.clientY - pointDragStart.y) > 5) pointDragMoved = true
  const r = canvasEl.value.getBoundingClientRect()
  const px = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100))
  const py = Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100))
  const points = draftPath.value.points.slice()
  points[draggingPointIndex] = { x: round1(px), y: round1(py) }
  draftPath.value = { ...draftPath.value, points }
}
function onPathPointUp() {
  if (draggingPointIndex === null) return
  if (!pointDragMoved && draftPath.value.points.length > 2) {
    const points = draftPath.value.points.slice()
    points.splice(draggingPointIndex, 1)
    draftPath.value = { ...draftPath.value, points }
  }
  draggingPointIndex = null
  pointDragStart = null
  pointDragMoved = false
}
function onPathPointKey(index, e) {
  const STEP = e.shiftKey ? 5 : 1
  const points = draftPath.value.points.slice()
  if ((e.key === 'Delete' || e.key === 'Backspace') && points.length > 2) {
    e.preventDefault()
    points.splice(index, 1)
    draftPath.value = { ...draftPath.value, points }
    nextTick(() => {
      const handles = canvasEl.value?.querySelectorAll('.cfs__phandle')
      if (!handles || !handles.length) return
      handles[Math.min(index, handles.length - 1)]?.focus()
    })
    return
  }
  const p = { ...points[index] }
  if (e.key === 'ArrowLeft') p.x = Math.max(0, p.x - STEP)
  else if (e.key === 'ArrowRight') p.x = Math.min(100, p.x + STEP)
  else if (e.key === 'ArrowUp') p.y = Math.max(0, p.y - STEP)
  else if (e.key === 'ArrowDown') p.y = Math.min(100, p.y + STEP)
  else return
  e.preventDefault()
  points[index] = { x: round1(p.x), y: round1(p.y) }
  draftPath.value = { ...draftPath.value, points }
}
function decSpacing() {
  draftPath.value = { ...draftPath.value, spacing: Math.max(1, round1(draftPath.value.spacing - 0.5)) }
}
function incSpacing() {
  draftPath.value = { ...draftPath.value, spacing: Math.min(9, round1(draftPath.value.spacing + 0.5)) }
}

// ─── Rideau : drag pleine hauteur (touch-action pan-y — le défilement vertical natif reste
// disponible même un doigt posé sur la ligne, seul le mouvement horizontal pilote le rideau) +
// clavier. Live pendant le drag (retour visuel immédiat), notifié au relâché seulement (évite
// une écriture à chaque pixel) ; clavier et bascule notifient immédiatement (actions discrètes).
//
// PAS de `.stop` sur les events pointer (contrairement aux poignées de calage) : le calage
// est un sous-mode exclusif où le pincement/pan du viewport n'a de toute façon aucun sens,
// `.stop` y est donc gratuit. Le rideau, lui, vit PENDANT la lecture normale — le pincement à
// deux doigts doit continuer à marcher même quand un doigt se pose sur la ligne. Or le
// pincement du viewport est géré par `usePinchZoom` (composable partagé) : ses gestionnaires comptent les doigts via SA PROPRE Map interne,
// remplie uniquement par les events qui l'atteignent — un `.stop` sur la ligne empêcherait
// ce doigt d'y être jamais compté, et bloquerait tout pincement dont l'un des deux doigts
// touche la ligne. Solution : laisser les events bulle normalement (le viewport voit donc
// aussi ce doigt, via ses propres écouteurs @pointerdown/@pointermove/@pointerup), et lire
// `activePointers()` — exposé par le composable pour cet usage — pour NE PAS démarrer de
// drag si un doigt est déjà posé ailleurs, et pour CÉDER (annuler le drag en cours, sans
// notifier) si un 2e doigt arrive pendant qu'on glisse — le pincement du viewport prend
// alors le relais normalement. Un tap bref sur la ligne (sans glisser) continue de remonter
// comme un tap ordinaire sur l'image (comportement déjà existant, inchangé) : le mouvement
// réel d'un vrai drag dépasse largement le seuil de tap du composable, qui le classe donc
// en pan, jamais en tap — pas de risque de double-tap fantôme.
let curtainDragging = false
// Position au posé du doigt : un appui SANS glisser ne change rien, il n'émet donc rien
// (le parent persisterait sinon `worked: true`, un jour actif pour un simple toucher).
let curtainAtDown = null
function onCurtainDown(e) {
  if (activePointers() > 0) return // un doigt déjà posé ailleurs = pincement en cours, pas un drag
  curtainDragging = true
  curtainAtDown = JSON.stringify(curtain.value)
  e.target.setPointerCapture?.(e.pointerId)
}
function onCurtainMove(e) {
  if (!curtainDragging || !canvasEl.value) return
  if (activePointers() >= 2) { curtainDragging = false; return } // 2e doigt arrivé depuis : on cède au pincement
  const r = canvasEl.value.getBoundingClientRect()
  const pct = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100))
  curtain.value = { x: round1(pct), side: effectiveCurtain.value.side }
}
function onCurtainUp() {
  if (!curtainDragging) return
  curtainDragging = false
  if (JSON.stringify(curtain.value) === curtainAtDown) return
  emit('update:curtain', curtain.value)
}
function onCurtainKey(e) {
  const STEP = e.shiftKey ? 5 : 1
  let dir
  if (e.key === 'ArrowLeft') dir = -1
  else if (e.key === 'ArrowRight') dir = 1
  else return
  e.preventDefault()
  const base = effectiveCurtain.value
  const x = Math.max(0, Math.min(100, base.x + dir * STEP))
  curtain.value = { x: round1(x), side: base.side }
  emit('update:curtain', curtain.value)
}
function flipCurtain() {
  curtain.value = flipCurtainSide(effectiveCurtain.value)
  emit('update:curtain', curtain.value)
}
</script>

<template>
  <div class="cstage" :class="`cstage--${variant}`">
    <div class="cfs__bar">
      <span class="cfs__title">{{ t('reader.chart.fullTitle') }}<template v-if="motifLabel"> · {{ motifLabel }}</template></span>
      <button v-if="!readOnly" class="cfs__tool cfs__cal" :aria-label="t('reader.chart.calibrate')" @click="calibrating ? cancelCalibrate() : startCalibrate()"><AppIcon name="calibrate" :size="20" /></button>
      <button class="cfs__tool cfs__zoomout" :aria-label="t('reader.chart.zoomOut')" @click="setZoom(zoom - 50)"><AppIcon name="zoomOut" :size="20" /></button>
      <button class="cfs__tool cfs__zoomin" :aria-label="t('reader.chart.zoomIn')" @click="setZoom(zoom + 50)"><AppIcon name="zoomIn" :size="20" /></button>
      <slot name="tools" />
    </div>

    <div
      ref="viewport"
      class="cfs__viewport"
      v-show="!(calibrating && isRadial)"
      tabindex="0"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <div ref="canvasEl" class="cfs__canvas" :style="{ width: zoom + '%' }" @pointerdown="onPathCanvasDown" @pointerup="onPathCanvasUp">
        <img :src="chart.img" :alt="t('reader.chart.alt', { motif: motifLabel })" draggable="false" />
        <template v-if="!readOnly && hasRows">
          <!-- Compensation d'aspect du carré (retour terrain 26/08, APRÈS l'assistant de calage
               à loupe fixe) : la décision d'origine (pas de compensation sur le rect, cf. plan
               2026-08-23-calage-radial-affichage) reposait sur le calage par glissé DIRECTEMENT
               sur ce même rendu — l'œil de l'utilisatrice absorbait alors l'étirement du canevas
               non carré. L'assistant actuel cale sur une loupe CSS toujours réellement carrée,
               indépendante du canevas : ce filet de sécurité a disparu, la prémisse ne tient
               plus. `height`/`y` suivent donc désormais `canvasAspect`, comme `ry` de l'ellipse
               juste en dessous — même dérivation, un carré doit rester carré à l'écran. -->
          <svg v-if="isRadial" class="cfs__rings" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <rect v-if="rings.doneShape === 'square' && !calibrating" class="cfs__ring cfs__ring--done" :x="rings.cx - rings.doneR" :y="rings.cy - rings.doneR * canvasAspect" :width="rings.doneR * 2" :height="rings.doneR * 2 * canvasAspect" :stroke-width="rings.doneStrokeWidth" />
            <!-- Contour à couleur FIXE (indépendante teinte/thème) sous la bande colorée : garantit
                 ≥3:1 (WCAG 1.4.11) même quand --brand ne peut pas l'atteindre (cf. .cfs__ring--hl-edge). -->
            <rect v-if="rings.hlShape === 'square'" class="cfs__ring cfs__ring--hl-edge" :x="rings.cx - rings.hlR" :y="rings.cy - rings.hlR * canvasAspect" :width="rings.hlR * 2" :height="rings.hlR * 2 * canvasAspect" :stroke-width="rings.hlStrokeWidth + 3" />
            <rect v-if="rings.hlShape === 'square'" class="cfs__ring cfs__ring--hl" :class="{ 'cfs__ring--calibrating': calibrating }" :x="rings.cx - rings.hlR" :y="rings.cy - rings.hlR * canvasAspect" :width="rings.hlR * 2" :height="rings.hlR * 2 * canvasAspect" :stroke-width="rings.hlStrokeWidth" />
            <ellipse v-if="rings.doneShape === 'circle' && !calibrating" class="cfs__ring cfs__ring--done" :cx="rings.cx" :cy="rings.cy" :rx="rings.doneR" :ry="rings.doneR * canvasAspect" :stroke-width="rings.doneStrokeWidth" />
            <ellipse v-if="rings.hlShape === 'circle'" class="cfs__ring cfs__ring--hl-edge" :cx="rings.cx" :cy="rings.cy" :rx="rings.hlR" :ry="rings.hlR * canvasAspect" :stroke-width="rings.hlStrokeWidth + 3" />
            <ellipse v-if="rings.hlShape === 'circle'" class="cfs__ring cfs__ring--hl" :class="{ 'cfs__ring--calibrating': calibrating }" :cx="rings.cx" :cy="rings.cy" :rx="rings.hlR" :ry="rings.hlR * canvasAspect" :stroke-width="rings.hlStrokeWidth" />
            <polygon v-if="rings.doneShape === 'hexagon' && !calibrating" class="cfs__ring cfs__ring--done" :points="hexRingPoints(rings.doneR)" :stroke-width="rings.doneStrokeWidth" />
            <polygon v-if="rings.hlShape === 'hexagon'" class="cfs__ring cfs__ring--hl-edge" :points="hexRingPoints(rings.hlR)" :stroke-width="rings.hlStrokeWidth + 3" />
            <polygon v-if="rings.hlShape === 'hexagon'" class="cfs__ring cfs__ring--hl" :class="{ 'cfs__ring--calibrating': calibrating }" :points="hexRingPoints(rings.hlR)" :stroke-width="rings.hlStrokeWidth" />
          </svg>
          <svg v-else-if="isPath" class="cfs__path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <polyline
              v-for="(pts, i) in pathRows"
              :key="i"
              :points="pts.map((p) => `${p.x},${p.y}`).join(' ')"
              class="cfs__pathrow"
              :class="{ 'cfs__pathrow--hl': i + 1 === row, 'cfs__pathrow--done': i + 1 < row, 'cfs__pathrow--future': i + 1 > row }"
            />
          </svg>
          <template v-else>
            <div v-if="!calibrating" class="cfs__done" :style="{ top: bands.doneTop + '%', height: bands.doneHeight + '%' }"></div>
            <div class="cfs__hl" :class="{ 'cfs__hl--calibrating': calibrating }" :style="{ top: bands.hlTop + '%', height: bands.hlHeight + '%' }"></div>
            <template v-if="!calibrating">
              <div
                class="cfs__curtain"
                :style="{ left: curtainRect.left + '%', width: curtainRect.width + '%', top: bands.hlTop + '%', height: bands.hlHeight + '%' }"
              ></div>
              <div
                class="cfs__curtain-line"
                :style="{ left: `clamp(calc(var(--cfs-grip-w) / 2), ${effectiveCurtain.x}%, calc(100% - var(--cfs-grip-w) / 2))` }"
                role="slider"
                aria-orientation="horizontal"
                tabindex="0"
                :aria-label="t('reader.chart.curtainHandle')"
                :aria-valuenow="effectiveCurtain.x"
                aria-valuemin="0"
                aria-valuemax="100"
                @pointerdown="onCurtainDown"
                @pointermove="onCurtainMove"
                @pointerup="onCurtainUp"
                @pointercancel="onCurtainUp"
                @keydown="onCurtainKey"
              >
                <span class="cfs__curtain-col" aria-hidden="true" style="pointer-events: none;"></span>
                <span class="cfs__curtain-grip" :style="{ top: bands.hlTop + bands.hlHeight / 2 + '%' }">
                  <AppIcon name="dragHorizontal" :size="16" aria-hidden="true" />
                </span>
              </div>
            </template>
          </template>
        </template>
        <template v-if="calibrating && !isRadial && !isPath">
          <div class="cfs__handle cfs__handle--top" :style="{ top: draft.top + '%' }" role="slider" aria-orientation="vertical" tabindex="0" :aria-label="t('reader.chart.handleTop')" :aria-valuenow="draft.top" aria-valuemin="0" aria-valuemax="100" @pointerdown.stop="onHandleDown('top', $event)" @pointermove.stop="onHandleMove" @pointerup.stop="onHandleUp" @pointercancel.stop="onHandleUp" @keydown="onHandleKey('top', $event)">
            <span class="cfs__line"></span>
            <span class="cfs__grip cfs__grip--top"><AppIcon name="dragVertical" :size="16" aria-hidden="true" />{{ t('reader.chart.handleTop') }}</span>
          </div>
          <div class="cfs__handle cfs__handle--bottom" :style="{ top: draft.bottom + '%' }" role="slider" aria-orientation="vertical" tabindex="0" :aria-label="t('reader.chart.handleBottom')" :aria-valuenow="draft.bottom" aria-valuemin="0" aria-valuemax="100" @pointerdown.stop="onHandleDown('bottom', $event)" @pointermove.stop="onHandleMove" @pointerup.stop="onHandleUp" @pointercancel.stop="onHandleUp" @keydown="onHandleKey('bottom', $event)">
            <span class="cfs__line"></span>
            <span class="cfs__grip cfs__grip--bottom"><AppIcon name="dragVertical" :size="16" aria-hidden="true" />{{ t('reader.chart.handleBottom') }}</span>
          </div>
        </template>
        <template v-if="calibrating && isPath">
          <div
            v-for="(p, i) in draftPath.points"
            :key="i"
            class="cfs__phandle"
            :style="{ left: p.x + '%', top: p.y + '%' }"
            role="slider"
            tabindex="0"
            :aria-label="t('reader.chart.handlePoint', { n: i + 1 })"
            :aria-valuenow="Math.round(p.x)"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuetext="`${Math.round(p.x)}%, ${Math.round(p.y)}%`"
            @pointerdown.stop="onPathPointDown(i, $event)"
            @pointermove.stop="onPathPointMove"
            @pointerup.stop="onPathPointUp"
            @pointercancel.stop="onPathPointUp"
            @keydown="onPathPointKey(i, $event)"
          >
            <span class="cfs__pdot"></span>
          </div>
        </template>
      </div>
    </div>
    <RadialCalibrationWizard
      v-if="calibrating && isRadial"
      :chart="chart"
      :frame="frame"
      @save="onRadialWizardSave"
      @cancel="cancelCalibrate"
    />
    <div v-if="calibrating && !isRadial" class="cfs__calbar">
      <p class="cfs__calhint">{{ isPath ? t('reader.chart.calibrateHintPath') : t('reader.chart.calibrateHint') }}</p>
      <div v-if="isPath" class="cfs__pathctl">
        <span class="cfs__pathlab">{{ t('reader.chart.spacing') }}</span>
        <button class="cfs__pathbtn cfs__pathdec" :aria-label="t('reader.chart.spacingDec')" @click="decSpacing"><AppIcon name="minus" :size="16" /></button>
        <span class="cfs__pathval">{{ draftPath.spacing }}</span>
        <button class="cfs__pathbtn cfs__pathinc" :aria-label="t('reader.chart.spacingInc')" @click="incSpacing"><AppIcon name="plus" :size="16" /></button>
      </div>
      <div class="cfs__calbtns">
        <button class="btn cfs__calreset" @click="resetCalibrate">{{ t('reader.chart.calibrateReset') }}</button>
        <button class="btn cfs__calcancel" @click="cancelCalibrate">{{ t('reader.chart.calibrateCancel') }}</button>
        <button class="btn primary cfs__calsave" :disabled="pathTooShort" @click="saveCalibrate">{{ t('reader.chart.calibrateSave') }}</button>
      </div>
    </div>
    <!-- `!calibrating` explicite : la barre de calage juste au-dessus est conditionnée à
         `calibrating && !isRadial`, donc en calage RADIAL elle est absente et ce `v-else-if`
         reprenait la main — la barre de rang s'affichait sous l'assistant radial (un simple
         frère en flux, pas un calque), et son `+` écrivait `persist({ worked: true })` depuis
         ce que l'utilisatrice lit comme un écran de réglage. -->
    <div v-else-if="!calibrating && !readOnly && hasRows" class="cfs__rowbar">
      <button class="cfs__big cfs__prev" :disabled="row <= 1" :aria-label="t('reader.chart.prev')" @click="step(-1)"><AppIcon name="minus" :size="22" /></button>
      <div class="cfs__vals">
        <span class="cfs__rowval">{{ row }} / {{ chart.rows }}</span>
        <span v-if="Number(chart.reps) > 0" class="cfs__repval">{{ rep }} / {{ chart.reps }}</span>
      </div>
      <button class="cfs__big cfs__next" :aria-label="t('reader.chart.next')" @click="step(1)"><AppIcon name="plus" :size="22" /></button>
      <button class="cfs__flip" :aria-label="t('reader.chart.curtainFlip')" @click="flipCurtain"><AppIcon name="flipHorizontal" :size="18" /></button>
    </div>
    <!-- Grille importée sans rangs saisis : pas de suivi ici ; l'invite de saisie est sur la carte du diagramme. -->
    <p v-else-if="!calibrating && !readOnly" class="cfs__norows">{{ t('reader.chart.rowsUnknownFull') }}</p>
  </div>
</template>

<style scoped>
.cstage { display: flex; flex-direction: column; min-height: 0; }
/* Le volet est collé au bord droit : il n'y a jamais d'encoche à sa gauche. Neutraliser
   --sa-left localement évite de dupliquer les paddings des 4 barres, qui utilisent tous
   max(valeur, var(--sa-left)). */
.cstage--panel { --sa-left: 0px; }
/* Marge d'encoche (relecture finale 27/07, complète le correctif .cfs__viewport
   ci-dessous) : en paysage sur téléphone à encoche, les outils tout à gauche de
   cette barre (calage/zoom) passaient sous l'encoche — le padding horizontal
   restait figé à 12px alors que le viewport, lui, avait déjà été corrigé. La
   valeur d'origine sert de plancher : sans encoche (web, --sa-* à 0), le rendu
   ne bouge pas. */
.cfs__bar { display: flex; align-items: center; gap: var(--sp-2); padding: max(var(--sp-2), var(--sa-top)) max(var(--sp-3), var(--sa-right)) var(--sp-2) max(var(--sp-3), var(--sa-left)); }
.cfs__title { flex: 1; color: rgba(255, 255, 255, 0.9); font-size: 13px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cfs__tool { width: 44px; height: 44px; border: none; border-radius: var(--r-pill); background: rgba(255, 255, 255, 0.14); color: #fff; display: grid; place-items: center; }
/* Marge d'encoche (retour device 27/07, Mate 20 Pro) : en paysage l'encoche passe sur
   le côté et masquait la poignée du rideau, qui est positionnée en % de l'image et
   atteint donc les deux bords. Un padding latéral sur le viewport de défilement décale
   l'image ET tout ce qui est positionné dessus (rideau, bandes, poignées de calage),
   sans toucher à leurs pourcentages. Le fond blanc reste bord à bord. */
.cfs__viewport {
  flex: 1;
  overflow: auto;
  touch-action: pan-x pan-y;
  background: #fff;
  -webkit-overflow-scrolling: touch;
  padding-left: var(--sa-left);
  padding-right: var(--sa-right);
  box-sizing: border-box;
}
.cfs__canvas { position: relative; min-width: 100%; }
.cfs__canvas img { display: block; width: 100%; height: auto; -webkit-user-select: none; user-select: none; }
.cfs__done { position: absolute; left: 0; right: 0; background: rgba(90, 122, 94, 0.16); border-bottom: 1.5px solid var(--sage); pointer-events: none; }
/* Retour terrain 26/08 : --brand plafonne à ~2:1 contre le papier blanc du diagramme en
   thème sombre, quelle que soit la teinte choisie (mesuré : L=78,51 en OKLCH, aucune
   opacité ne peut atteindre 3:1 — même constat que .cfs__ring--hl-edge ci-dessous). Le
   box-shadow 4px à couleur FIXE (indépendante teinte/thème) garantit 3:1 (WCAG 1.4.11) ;
   le fond suit désormais la teinte via --brand-rgb (triplet nu, cf. theme/palette.js)
   au lieu d'un littéral figé qui l'ignorait. */
.cfs__hl { position: absolute; left: 0; right: 0; background: rgba(var(--brand-rgb), 0.16); box-shadow: inset 0 0 0 2px var(--brand), inset 0 0 0 4px rgba(58, 46, 40, 0.55); pointer-events: none; }
.cfs__hl--calibrating { background: rgba(var(--brand-rgb), 0.08); box-shadow: inset 0 0 0 4px rgba(58, 46, 40, 0.55); }
.cfs__handle { position: absolute; left: 0; right: 0; height: 44px; margin-top: -22px; cursor: ns-resize; touch-action: none; display: flex; align-items: center; justify-content: center; }
.cfs__line { position: absolute; left: 0; right: 0; top: 50%; height: 3px; margin-top: -1.5px; background: var(--brand); box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.8); pointer-events: none; }
.cfs__grip {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: var(--r-pill);
  background: var(--brand);
  color: var(--on-accent);
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}
/* poignée du haut : pilule vers l'intérieur de l'image, donc SOUS sa ligne */
.cfs__grip--top { margin-top: 20px; }
/* poignée du bas : pilule vers l'intérieur de l'image, donc AU-DESSUS de sa ligne */
.cfs__grip--bottom { margin-top: -20px; }
.cfs__curtain { position: absolute; background: rgba(90, 122, 94, 0.28); pointer-events: none; }
/* --cfs-grip-w = largeur de .cfs__curtain-grip ci-dessous, déclarée ici pour que le clamp
   inline du `left` (voir template, sur ce même élément) reste calé sur la moitié de la
   poignée même si sa taille change un jour — un seul nombre à retoucher. Résidu
   (retour Mate 20 Pro 27/07) : sans ce clamp, la poignée déborde de sa demi-largeur (14px)
   aux deux positions extrêmes du rideau (0 % / 100 %), et ce débordement tombe dans la
   zone d'encoche depuis que .cfs__viewport a un padding latéral --sa-left/--sa-right. */
.cfs__curtain-line { position: absolute; top: 0; bottom: 0; width: 44px; margin-left: -22px; touch-action: pan-y; cursor: ew-resize; display: flex; align-items: center; justify-content: center; --cfs-grip-w: 28px; }
/* Repère plein-hauteur (demande 23/08) : la petite pastille ronde ne rend visible que le
   milieu de la bande du rang courant — sur un grand diagramme, on perd de vue où se trouve
   le rideau en dehors de cette bande. Cette ligne + halo rend toute la colonne visible,
   façon anneau de focus clavier ; purement décoratif (pointer-events: none), le drag/tap
   reste porté par .cfs__curtain-line lui-même. */
.cfs__curtain-col {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 3px;
  margin-left: -1.5px;
  background: var(--brand);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.85),
    0 0 0 6px rgba(var(--brand-rgb), 0.16);
  pointer-events: none;
}
.cfs__curtain-grip { position: absolute; display: flex; align-items: center; justify-content: center; width: var(--cfs-grip-w); height: var(--cfs-grip-w); border-radius: var(--r-pill); background: rgba(255, 255, 255, 0.92); color: var(--ink-70); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25); pointer-events: none; }
.cfs__rings { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.cfs__ring { fill: none; }
.cfs__ring--done { stroke: var(--sage); stroke-opacity: 0.45; }
.cfs__ring--hl { stroke: var(--brand); stroke-opacity: 0.45; }
/* Retour terrain 26/08 : contour à couleur FIXE (indépendante teinte/thème), 3 unités plus
   large que --hl et peint DESSOUS lui (cf. ordre du template) — dépasse de part et d'autre
   du trait coloré, ce qui garantit 3:1 (WCAG 1.4.11) même dans les cas (thème sombre, toute
   teinte) où --brand ne peut structurellement pas l'atteindre. Jamais assourdi par
   --calibrating (cf. règle suivante) : la bande colorée peut s'estomper pendant le calage,
   le contour qui indique le rang en cours doit rester net. */
.cfs__ring--hl-edge { stroke: rgba(58, 46, 40, 0.55); }
.cfs__ring--calibrating { stroke-opacity: 0.25; }
.cfs__path { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.cfs__pathrow { fill: none; stroke-width: 0.8; }
.cfs__pathrow--hl { stroke: var(--brand); stroke-width: 1.2; }
.cfs__pathrow--done { stroke: var(--sage); }
.cfs__pathrow--future { stroke: rgba(58, 46, 40, 0.32); }
.cfs__phandle { position: absolute; width: 32px; height: 32px; margin-left: -16px; margin-top: -16px; touch-action: none; display: flex; align-items: center; justify-content: center; }
.cfs__pdot { width: 14px; height: 14px; border-radius: 50%; background: var(--brand); box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.9), 0 1px 3px rgba(0, 0, 0, 0.35); pointer-events: none; }
.cfs__pathctl { display: flex; align-items: center; gap: var(--sp-2); margin-bottom: var(--sp-2); }
.cfs__pathlab { flex: 1; font-size: 12.5px; font-weight: 700; color: rgba(255, 255, 255, 0.8); }
.cfs__pathbtn { width: 32px; height: 32px; border: none; border-radius: var(--r-md); background: rgba(255, 255, 255, 0.16); color: #fff; font-size: 18px; font-weight: 800; }
.cfs__pathval { min-width: 28px; text-align: center; font-variant-numeric: tabular-nums; color: #fff; font-weight: 700; }
/* Retour device 28/07 (tablette) : à 28 px de pastille dans une zone de 44 px, la
   poignée est difficile à viser au doigt sur grand écran — ~7 mm sur un écran à 320 dpi, là
   où Android recommande 48 dp (~9 mm). Elle grossit donc au-dessus de 900 px de large.
   `--cfs-grip-w` suffit à redimensionner la pastille ET le clamp anti-débordement du `left`
   (cf. commentaire plus haut) ; `margin-left` reste la moitié négative de `width`.
   Pourquoi seulement la largeur, sans condition de hauteur : ce seuil n'est PAS celui du
   lecteur à deux volets (qui vit en JS dans useSplitReader.js et commande une mise en page).
   Ici la poignée est un objet horizontal — sur un écran large mais court, une poignée
   généreuse est tout aussi souhaitable. Ne pas « corriger » ce seuil en croyant à un oubli.
   Sur téléphone rien ne bouge : la taille actuelle y a été validée sur appareil, et une
   pastille plus grosse y masquerait davantage de mailles. */
@media (min-width: 900px) {
  .cfs__curtain-line {
    width: 56px;
    margin-left: -28px;
    --cfs-grip-w: 40px;
  }
}
/* Même correctif que .cfs__bar plus haut, sur les 3 barres du bas de cette fenêtre :
   en paysage encoché, le bouton Enregistrer du calage (extrémité droite) et le
   bouton bascule du rideau (.cfs__flip, extrémité droite de .cfs__rowbar) restaient
   partiellement sous l'encoche. Plancher = valeur d'origine, comme ci-dessus. */
.cfs__calbar { padding: var(--sp-2) max(var(--sp-3), var(--sa-right)) max(var(--sp-2), var(--sa-bottom)) max(var(--sp-3), var(--sa-left)); color: #fff; }
.cfs__calhint { margin: 0 0 var(--sp-2); font-size: 12.5px; color: rgba(255, 255, 255, 0.8); }
.cfs__calbtns { display: flex; gap: var(--sp-2); justify-content: flex-end; }
.cfs__rowbar { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-2) max(var(--sp-3), var(--sa-right)) max(var(--sp-2), var(--sa-bottom)) max(var(--sp-3), var(--sa-left)); }
.cfs__norows { margin: 0; padding: var(--sp-3) max(var(--sp-3), var(--sa-right)) max(var(--sp-3), var(--sa-bottom)) max(var(--sp-3), var(--sa-left)); font-size: 12.5px; font-weight: 700; color: rgba(255, 255, 255, 0.85); text-align: center; }
/* Centrage flex explicite (même raison que .ccard__pm) : glyphe 28 px remplacé par une
   icône 22 px, le centrage natif par ligne de base laissait une dérive visible dans le
   grand bouton. */
.cfs__big { display: inline-flex; align-items: center; justify-content: center; width: 64px; height: 56px; border: none; border-radius: var(--r-md); background: rgba(255, 255, 255, 0.16); color: #fff; font-size: 28px; font-weight: 800; }
.cfs__big:disabled { opacity: 0.35; }
.cfs__vals { flex: 1; display: flex; flex-direction: column; align-items: center; color: #fff; font-variant-numeric: tabular-nums; }
.cfs__rowval { font-size: 20px; font-weight: 800; }
.cfs__repval { font-size: 13px; font-weight: 700; color: rgba(255, 255, 255, 0.75); }
.cfs__flip { width: 40px; height: 40px; border: none; border-radius: var(--r-pill); background: rgba(255, 255, 255, 0.14); color: #fff; display: grid; place-items: center; }
</style>
