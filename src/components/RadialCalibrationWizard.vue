<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { chartRings, hexagonPoints } from '@/utils/reader'
import AppIcon from '@/components/AppIcon.vue'

const props = defineProps({
  chart: { type: Object, required: true },
  frame: { type: Object, default: null },
})
const emit = defineEmits(['save', 'cancel'])

const { t } = useI18n()

// Forme par défaut d'une limite sans valeur explicite : dérivée de chart.shape, même
// repli que `chartRings` (reader.js) — garde le calage cohérent avec la lecture.
function defaultShape() {
  if (props.chart?.shape === 'radial-square') return 'square'
  if (props.chart?.shape === 'radial-hexagon') return 'hexagon'
  return 'circle'
}
function isValidShape(s) {
  return s === 'square' || s === 'circle' || s === 'hexagon'
}
function makeDraft(frame) {
  const f = frame || {}
  return {
    cx: Number.isFinite(f.cx) ? f.cx : 50,
    cy: Number.isFinite(f.cy) ? f.cy : 50,
    // r0/r1 par défaut non nuls (15/45, pas 0/50) : donne un point de départ raisonnable au
    // zoom de l'écran 1/2 (cf. loupe fixe ci-dessous) sans exiger un premier réglage à vide.
    r0: Number.isFinite(f.r0) ? f.r0 : 15,
    r1: Number.isFinite(f.r1) ? f.r1 : 45,
    r0Shape: isValidShape(f.r0Shape) ? f.r0Shape : defaultShape(),
    r1Shape: isValidShape(f.r1Shape) ? f.r1Shape : defaultShape(),
    switchRound: Number.isFinite(f.switchRound) ? f.switchRound : null,
    // Orientation de l'hexagone ('flat' = côté plat en haut/bas, 'pointy' = sommet en haut) :
    // propriété du CHART entier (pas par limite r0/r1) — un motif garde la même orientation
    // du centre au bord, seule sa forme (rond/carré/hexagone) peut varier par limite.
    // Toujours présente dans le draft (même hors hexagone) : évite un `undefined` à
    // renseigner ailleurs, ignorée au rendu quand aucune limite n'est hexagonale.
    hexOrientation: f.hexOrientation === 'pointy' ? 'pointy' : 'flat',
  }
}

const step = ref('inner') // 'inner' | 'outer' | 'switch' | 'review'
const activeTool = ref('move') // 'move' | 'resize' — écrans inner/outer seulement
const draft = ref(makeDraft(props.frame))

const rows = computed(() => Math.max(1, Number(props.chart?.rows) || 1))
const needsSwitch = computed(() => draft.value.r0Shape !== draft.value.r1Shape && rows.value >= 2)
const shapeField = computed(() => (step.value === 'inner' ? 'r0Shape' : 'r1Shape'))
const currentShape = computed(() => draft.value[shapeField.value])
const isZoomStep = computed(() => step.value === 'inner' || step.value === 'outer')
const currentR = computed(() => (step.value === 'inner' ? draft.value.r0 : draft.value.r1))

// ─── Loupe fixe (retour terrain 26/08 : l'ancien cercle, dimensionné à r0/r1 sur une image
// à taille fixe, était trop petit et difficile à attraper) ───────────────────────────────
// Le repère reste maintenant TOUJOURS au centre de l'écran, à une taille d'affichage
// CONSTANTE — c'est le DESSIN qui zoome/se déplace dessous pour amener son bord réel sous ce
// repère fixe, comme un objectif qu'on approche/éloigne et qu'on recadre, plutôt qu'un cercle
// qu'on étire sur une photo figée. Taille différente par écran (retour terrain 26/08) : à une
// seule taille pour les deux limites, soit le rayon par défaut de l'écran 1 (15) forçait déjà
// un zoom inutile, soit le repère de l'écran 2 — qui représente le bord du motif ENTIER, pas
// un simple point — paraissait trop petit une fois la taille réduite pour corriger le premier
// souci. Le repère de l'écran extérieur est donc deux fois plus grand (en % du viewport).
const GUIDE_R_PCT_INNER = 15
const GUIDE_R_PCT_OUTER = 30
const GUIDE_R_PCT = computed(() => (step.value === 'outer' ? GUIDE_R_PCT_OUTER : GUIDE_R_PCT_INNER))
const RESIZE_SENSITIVITY = 0.15 // % de rayon par pixel de glissé vertical en mode Agrandir·Rétrécir
const MIN_RING_GAP = 2 // écart minimal (en %) entre r0 et r1, dans les deux sens
const MAX_RADIUS = 60 // rayon maximal (en %) atteignable par r1

// Arrondi au dixième — motif répété à chaque écriture de cx/cy/r0/r1 (glissé, pavé
// directionnel), factorisé pour ne porter le calcul qu'à un seul endroit.
function round1(n) {
  return Math.round(n * 10) / 10
}
// Fusionne un patch dans `draft` : évite de répéter `draft.value = { ...draft.value, … }`
// à chaque site d'écriture (glissé, formes, pas, pavé directionnel — huit occurrences
// avant cette factorisation).
function patchDraft(patch) {
  draft.value = { ...draft.value, ...patch }
}

const viewportEl = ref(null)
const imgwrapEl = ref(null)
const viewportW = ref(1)
const viewportH = ref(1)
let viewportRO = null
onMounted(() => {
  if (viewportEl.value && typeof ResizeObserver !== 'undefined') {
    viewportRO = new ResizeObserver(() => {
      const r = viewportEl.value?.getBoundingClientRect()
      if (r && r.width > 0) {
        viewportW.value = r.width
        viewportH.value = r.height
        // Rejouer le recentrage une fois la taille mesurée (bug 09/09 : la pose du montage
        // tombait sur un scroll range de 0, viewportW/H valant encore 1, et n'était jamais
        // rejouée — l'assistant s'ouvrait sur le COIN du motif). nextTick : imgWidthPx (la
        // taille du dessin) dérive de viewportW — laisser le DOM se repatcher avant de
        // mesurer l'imgwrap et reposer scrollLeft/scrollTop.
        nextTick(syncScroll)
      }
    })
    viewportRO.observe(viewportEl.value)
  }
  nextTick(syncScroll)
})
onUnmounted(() => viewportRO?.disconnect())

// zoom (largeur du dessin en % de la largeur du viewport) déduit du rayon COURANT (r0 à
// l'écran intérieur, r1 à l'écran extérieur) pour que le repère fixe (GUIDE_R_PCT) coïncide
// exactement avec ce rayon sur le dessin — indépendant des dimensions réelles du viewport
// (les deux ratios sont relatifs à sa largeur, elle s'annule dans le calcul).
const zoom = computed(() => Math.min(2000, (GUIDE_R_PCT.value * 100) / Math.max(currentR.value, 1)))
const guideDiameterPx = computed(() => viewportW.value * (GUIDE_R_PCT.value / 100) * 2)
// Largeur RÉELLE (px) du dessin au zoom courant — le `<img>` est dimensionné en pixels
// explicites (voir template), jamais en % : un % se serait résolu contre la largeur de
// CONTENU du viewport, réduite par le padding ci-dessous, un piège classique de ce montage.
const imgWidthPx = computed(() => (viewportW.value * zoom.value) / 100)
// Retour terrain 26/08 : à zoom=100 % (rayon par défaut = GUIDE_R_PCT), le dessin fait pile
// la largeur du viewport — sans marge, rien à faire défiler, le geste Déplacer ne pouvait
// donc RIEN bouger à l'écran, quelle que soit l'amplitude du glissé. Une marge fixe, posée en
// `padding` sur le viewport (jamais en `margin` sur le dessin : la fusion de marges avec le
// bord du conteneur scrollable ferait disparaître la marge du HAUT), égale à la MOITIÉ des
// dimensions du viewport de chaque côté, garantit que le centre du viewport peut toujours
// atteindre n'importe quel point du dessin ORIGINAL (0-100 %), à n'importe quel zoom — la
// preuve : la plage de défilement obtenue est alors exactement [0, largeur du dessin].
const padX = computed(() => viewportW.value / 2)
const padY = computed(() => viewportH.value / 2)

// Recale le défilement pour que le point (cx,cy) du dessin ORIGINAL retombe exactement au
// centre du viewport, à la largeur de dessin ACTUELLE (donc au zoom courant) — seul endroit
// qui touche scrollLeft/scrollTop, appelé après toute variation de cx/cy/r0/r1/étape.
function syncScroll() {
  const vp = viewportEl.value
  const wrap = imgwrapEl.value
  if (!vp || !wrap) return
  const imgRect = wrap.getBoundingClientRect()
  if (!imgRect.width || !imgRect.height) return
  vp.scrollLeft = (draft.value.cx / 100) * imgRect.width
  vp.scrollTop = (draft.value.cy / 100) * imgRect.height
}
watch([() => draft.value.cx, () => draft.value.cy, zoom, step], () => {
  if (isZoomStep.value) nextTick(syncScroll)
})

// ─── Glisser sur le viewport (écrans inner/outer uniquement) : mode Déplacer fait défiler
// le dessin sous la loupe fixe (dCx/dCy en % du dessin, convertis depuis le pixel glissé et
// la largeur de contenu au début du geste) ; mode Agrandir·Rétrécir change directement le
// rayon de l'étape en cours depuis le glissé vertical — le zoom (dérivé) suit, et l'effet
// ci-dessus recale le défilement pour garder le même point centré pendant qu'on zoome.
let dragMode = null
let dragStart = null
function onViewportDown(e) {
  if (!isZoomStep.value) return
  dragMode = activeTool.value
  const wrapRect = imgwrapEl.value?.getBoundingClientRect()
  dragStart = {
    x: e.clientX,
    y: e.clientY,
    cx: draft.value.cx,
    cy: draft.value.cy,
    r: currentR.value,
    contentW: wrapRect?.width || 1,
    contentH: wrapRect?.height || 1,
  }
  e.target.setPointerCapture?.(e.pointerId)
}
function onViewportMove(e) {
  if (!dragStart) return
  const dxPx = e.clientX - dragStart.x
  const dyPx = e.clientY - dragStart.y
  if (dragMode === 'move') {
    const dCx = (dxPx / dragStart.contentW) * 100
    const dCy = (dyPx / dragStart.contentH) * 100
    patchDraft({
      cx: round1(Math.max(0, Math.min(100, dragStart.cx - dCx))),
      cy: round1(Math.max(0, Math.min(100, dragStart.cy - dCy))),
    })
  } else {
    const newR = dragStart.r + dyPx * RESIZE_SENSITIVITY
    if (step.value === 'inner') patchDraft({ r0: round1(Math.max(0, Math.min(newR, draft.value.r1 - MIN_RING_GAP))) })
    else patchDraft({ r1: round1(Math.max(draft.value.r0 + MIN_RING_GAP, Math.min(MAX_RADIUS, newR))) })
  }
}
function onViewportUp() {
  dragMode = null
  dragStart = null
}

function setShape(field, shape) {
  patchDraft({ [field]: shape })
}
function setOrientation(orientation) {
  patchDraft({ hexOrientation: orientation })
}
// Points du polygone hexagonal (canvas statique), aspect-compensés comme les <rect> carrés
// voisins — cf. hexagonPoints (reader.js) pour la convention (r = apothème).
function hexPointsAttr(r) {
  return hexagonPoints(draft.value.cx, draft.value.cy, r, draft.value.hexOrientation, canvasAspect.value)
    .map((p) => `${p.x},${p.y}`)
    .join(' ')
}

// ─── Canvas statique (écrans switch/review uniquement) : dessin figé, formes affichées à
// leur position/taille réelle en % — même patron que l'ancien calage (canvasAspect corrige
// l'étirement du viewBox 0-100 non carré pour qu'un cercle reste rond). ───────────────────
const staticCanvasEl = ref(null)
// La boîte `.rcw__canvas` (flex: 1) n'a PAS les proportions du dessin : l'image y est posée
// en `object-fit: contain`, avec des bandes vides. cx/cy/r0/r1 sont en % de l'IMAGE (écrans
// loupe, lecteur) : le calque des formes doit donc couvrir le rectangle réellement occupé
// par l'image, sinon l'aperçu du récapitulatif est décalé et trop grand (tablette paysage :
// anneaux ~2× trop larges) et la croix de recentrage fait enregistrer un calage faux.
const staticBox = ref({ w: 0, h: 0 })
const staticImgAspect = ref(0) // naturalWidth / naturalHeight, 0 tant que l'image n'est pas chargée
function onStaticImgLoad(e) {
  const img = e.target
  if (img?.naturalWidth && img?.naturalHeight) staticImgAspect.value = img.naturalWidth / img.naturalHeight
}
// Rectangle « contain » (px, repère de la boîte), null tant qu'une mesure manque : le calque
// retombe alors sur la boîte entière (comportement d'origine).
const staticFit = computed(() => {
  const { w, h } = staticBox.value
  const ia = staticImgAspect.value
  if (!w || !h || !ia) return null
  const fw = w / h > ia ? h * ia : w
  const fh = w / h > ia ? h : w / ia
  return { left: (w - fw) / 2, top: (h - fh) / 2, width: fw, height: fh }
})
const overlayStyle = computed(() => {
  const f = staticFit.value
  return f ? { left: `${f.left}px`, top: `${f.top}px`, width: `${f.width}px`, height: `${f.height}px` } : null
})
const canvasAspect = computed(() => {
  const f = staticFit.value
  if (f) return f.width / f.height
  const { w, h } = staticBox.value
  return w && h ? w / h : 1
})
let staticRO = null
onMounted(() => {
  if (staticCanvasEl.value && typeof ResizeObserver !== 'undefined') {
    staticRO = new ResizeObserver(() => {
      const r = staticCanvasEl.value?.getBoundingClientRect()
      if (r && r.height > 0) staticBox.value = { w: r.width, h: r.height }
    })
    staticRO.observe(staticCanvasEl.value)
  }
})
onUnmounted(() => staticRO?.disconnect())

// ─── Navigation entre écrans ──────────────────────────────────────────────────
function validateInner() { step.value = 'outer' }
function backToInner() { step.value = 'inner' }
function validateOuter() {
  if (needsSwitch.value) {
    if (draft.value.switchRound == null) patchDraft({ switchRound: 2 })
    step.value = 'switch'
  } else {
    // Un seul rang possible (chart.rows < 2, écran de transition inatteignable) mais des
    // formes différentes tout de même posées : le rang doit rendre la forme EXTÉRIEURE
    // (r1Shape, le contour visible), pas retomber silencieusement sur r0Shape par défaut.
    // switchRound: 1 fait toujours choisir r1Shape dans chartRings.shapeForRound (round >= 1).
    patchDraft({ switchRound: draft.value.r0Shape !== draft.value.r1Shape ? 1 : null })
    step.value = 'review'
  }
}
function backFromSwitch() { step.value = 'outer' }
function validateSwitch() { step.value = 'review' }
function backFromReview() { step.value = needsSwitch.value ? 'switch' : 'outer' }

// ─── Écran de transition : sélecteur de rang + aperçu réutilisant chartRings (aucune
// duplication du calcul de rayon/forme par rang, déjà écrit pour la lecture) ─────────
function decSwitchRound() {
  patchDraft({ switchRound: Math.max(2, draft.value.switchRound - 1) })
}
function incSwitchRound() {
  patchDraft({ switchRound: Math.min(rows.value, draft.value.switchRound + 1) })
}
const switchPreview = computed(() => chartRings(draft.value.switchRound || 2, rows.value, draft.value))

// ─── Écran récapitulatif : nudge du centre partagé (bouge donc les deux limites,
// concentriques par construction) ──────────────────────────────────────────────
function nudgeCenter(dx, dy) {
  patchDraft({
    cx: round1(Math.max(0, Math.min(100, draft.value.cx + dx))),
    cy: round1(Math.max(0, Math.min(100, draft.value.cy + dy))),
  })
}

// Réinitialiser (écran 1 seulement) : recommence à zéro SANS quitter l'assistant — un
// pas de calage n'a de sens qu'au tout début du parcours, contrairement à l'ancien
// bouton qui effaçait le frame ET fermait le calage.
function resetDraft() {
  draft.value = makeDraft(null)
  step.value = 'inner'
}
function save() {
  const next = { cx: draft.value.cx, cy: draft.value.cy, r0: draft.value.r0, r1: draft.value.r1, r0Shape: draft.value.r0Shape, r1Shape: draft.value.r1Shape }
  if (draft.value.switchRound != null) next.switchRound = draft.value.switchRound
  if (draft.value.r0Shape === 'hexagon' || draft.value.r1Shape === 'hexagon') next.hexOrientation = draft.value.hexOrientation
  emit('save', next)
}
function cancel() {
  emit('cancel')
}

const hintText = computed(() => {
  if (step.value === 'inner') return t('reader.chart.wizardStepInnerHint')
  if (step.value === 'outer') return t('reader.chart.wizardStepOuterHint')
  if (step.value === 'switch') {
    if (draft.value.r1Shape === 'square') return t('reader.chart.wizardStepSwitchHintToSquare')
    if (draft.value.r1Shape === 'hexagon') return t('reader.chart.wizardStepSwitchHintToHexagon')
    return t('reader.chart.wizardStepSwitchHintToCircle')
  }
  return t('reader.chart.wizardStepReviewHint')
})

defineExpose({ step, draft, canvasAspect, zoom })
</script>

<template>
  <div class="rcw">
    <div v-show="isZoomStep" class="rcw__zoomstage">
      <div
        ref="viewportEl"
        class="rcw__viewport"
        :style="{ padding: padY + 'px ' + padX + 'px' }"
        @pointerdown="onViewportDown"
        @pointermove="onViewportMove"
        @pointerup="onViewportUp"
        @pointercancel="onViewportUp"
      >
        <div ref="imgwrapEl" class="rcw__imgwrap" :style="{ width: imgWidthPx + 'px' }">
          <img :src="chart.img" alt="" draggable="false" />
        </div>
      </div>
      <!-- Repère HORS du viewport défilant à dessein : posé DEDANS (même en position absolue),
           il suivrait le défilement au lieu de rester fixe à l'écran (retour terrain 26/08). -->
      <div
        class="rcw__guide"
        :class="{ 'rcw__guide--square': currentShape === 'square', 'rcw__guide--hexagon': currentShape === 'hexagon', 'rcw__guide--pointy': currentShape === 'hexagon' && draft.hexOrientation === 'pointy' }"
        :style="{ width: guideDiameterPx + 'px', height: guideDiameterPx + 'px' }"
      >
        <span class="rcw__guide-cross"></span>
      </div>
    </div>

    <div v-show="!isZoomStep" ref="staticCanvasEl" class="rcw__canvas">
      <img :src="chart.img" alt="" draggable="false" @load="onStaticImgLoad" />
      <svg class="rcw__overlay" :style="overlayStyle" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <!-- Les <rect> compensent l'aspect du canvas exactement comme les <ellipse> voisines
             (`viewBox` 100x100 + preserveAspectRatio="none" étire les deux axes) : sans
             `canvasAspect` sur y/height, un carré se peignait aplati ICI alors que le lecteur
             le peint compensé (ChartStage.vue:375/378/379, « un carré doit rester carré à
             l'écran ») — l'utilisatrice calait donc une forme et en obtenait une autre. -->
        <template v-if="step === 'review'">
          <rect v-if="draft.r0Shape === 'square'" class="rcw__shape rcw__shape--inner" :x="draft.cx - draft.r0" :y="draft.cy - draft.r0 * canvasAspect" :width="draft.r0 * 2" :height="draft.r0 * 2 * canvasAspect" />
          <polygon v-else-if="draft.r0Shape === 'hexagon'" class="rcw__shape rcw__shape--inner" :points="hexPointsAttr(draft.r0)" />
          <ellipse v-else class="rcw__shape rcw__shape--inner" :cx="draft.cx" :cy="draft.cy" :rx="draft.r0" :ry="draft.r0 * canvasAspect" />
          <rect v-if="draft.r1Shape === 'square'" class="rcw__shape rcw__shape--outer" :x="draft.cx - draft.r1" :y="draft.cy - draft.r1 * canvasAspect" :width="draft.r1 * 2" :height="draft.r1 * 2 * canvasAspect" />
          <polygon v-else-if="draft.r1Shape === 'hexagon'" class="rcw__shape rcw__shape--outer" :points="hexPointsAttr(draft.r1)" />
          <ellipse v-else class="rcw__shape rcw__shape--outer" :cx="draft.cx" :cy="draft.cy" :rx="draft.r1" :ry="draft.r1 * canvasAspect" />
        </template>
        <template v-if="step === 'switch'">
          <rect v-if="draft.r0Shape === 'square'" class="rcw__shape rcw__shape--ghost" :x="draft.cx - draft.r0" :y="draft.cy - draft.r0 * canvasAspect" :width="draft.r0 * 2" :height="draft.r0 * 2 * canvasAspect" />
          <polygon v-else-if="draft.r0Shape === 'hexagon'" class="rcw__shape rcw__shape--ghost" :points="hexPointsAttr(draft.r0)" />
          <ellipse v-else class="rcw__shape rcw__shape--ghost" :cx="draft.cx" :cy="draft.cy" :rx="draft.r0" :ry="draft.r0 * canvasAspect" />
          <rect v-if="draft.r1Shape === 'square'" class="rcw__shape rcw__shape--ghost" :x="draft.cx - draft.r1" :y="draft.cy - draft.r1 * canvasAspect" :width="draft.r1 * 2" :height="draft.r1 * 2 * canvasAspect" />
          <polygon v-else-if="draft.r1Shape === 'hexagon'" class="rcw__shape rcw__shape--ghost" :points="hexPointsAttr(draft.r1)" />
          <ellipse v-else class="rcw__shape rcw__shape--ghost" :cx="draft.cx" :cy="draft.cy" :rx="draft.r1" :ry="draft.r1 * canvasAspect" />
          <rect v-if="draft.r1Shape === 'square'" class="rcw__shape rcw__shape--preview" :x="draft.cx - switchPreview.hlR" :y="draft.cy - switchPreview.hlR * canvasAspect" :width="switchPreview.hlR * 2" :height="switchPreview.hlR * 2 * canvasAspect" :stroke-width="switchPreview.hlStrokeWidth" />
          <polygon v-else-if="draft.r1Shape === 'hexagon'" class="rcw__shape rcw__shape--preview" :points="hexPointsAttr(switchPreview.hlR)" :stroke-width="switchPreview.hlStrokeWidth" />
          <ellipse v-else class="rcw__shape rcw__shape--preview" :cx="draft.cx" :cy="draft.cy" :rx="switchPreview.hlR" :ry="switchPreview.hlR * canvasAspect" :stroke-width="switchPreview.hlStrokeWidth" />
        </template>
        <path class="rcw__center" :d="`M${draft.cx - 3},${draft.cy} h6 M${draft.cx},${draft.cy - 3} v6`" />
      </svg>
    </div>

    <div class="rcw__bar">
      <p class="rcw__hint">{{ hintText }}</p>

      <div v-if="step === 'inner' || step === 'outer'" class="rcw__shapes">
        <button class="rcw__shapebtn" :class="{ 'rcw__shapebtn--active': currentShape === 'circle' }" :aria-pressed="currentShape === 'circle'" @click="setShape(shapeField, 'circle')">{{ t('reader.chart.wizardShapeCircle') }}</button>
        <button class="rcw__shapebtn" :class="{ 'rcw__shapebtn--active': currentShape === 'square' }" :aria-pressed="currentShape === 'square'" @click="setShape(shapeField, 'square')">{{ t('reader.chart.wizardShapeSquare') }}</button>
        <button class="rcw__shapebtn" :class="{ 'rcw__shapebtn--active': currentShape === 'hexagon' }" :aria-pressed="currentShape === 'hexagon'" @click="setShape(shapeField, 'hexagon')">{{ t('reader.chart.wizardShapeHexagon') }}</button>
      </div>

      <!-- Orientation de l'hexagone : propriété du chart entier (draft.hexOrientation, pas
           shapeField) — visible dès qu'une limite est hexagonale, même si ce n'est pas celle
           de l'écran courant, pour que le choix reste accessible aux deux écrans. -->
      <div v-if="draft.r0Shape === 'hexagon' || draft.r1Shape === 'hexagon'" class="rcw__orient">
        <button class="rcw__orientbtn" :class="{ 'rcw__orientbtn--active': draft.hexOrientation !== 'pointy' }" :aria-pressed="draft.hexOrientation !== 'pointy'" @click="setOrientation('flat')">{{ t('reader.chart.wizardHexOrientationFlat') }}</button>
        <button class="rcw__orientbtn" :class="{ 'rcw__orientbtn--active': draft.hexOrientation === 'pointy' }" :aria-pressed="draft.hexOrientation === 'pointy'" @click="setOrientation('pointy')">{{ t('reader.chart.wizardHexOrientationPointy') }}</button>
      </div>

      <div v-if="step === 'inner' || step === 'outer'" class="rcw__tools">
        <button class="rcw__tool" :class="{ 'rcw__tool--active': activeTool === 'move' }" :aria-pressed="activeTool === 'move'" @click="activeTool = 'move'">
          <AppIcon name="move" :size="20" />{{ t('reader.chart.wizardMove') }}
        </button>
        <button class="rcw__tool" :class="{ 'rcw__tool--active': activeTool === 'resize' }" :aria-pressed="activeTool === 'resize'" @click="activeTool = 'resize'">
          <AppIcon name="dragHorizontal" :size="20" />{{ t('reader.chart.wizardResize') }}
        </button>
      </div>

      <div v-if="step === 'switch'" class="rcw__stepper">
        <button class="rcw__stepbtn rcw__stepdec" :aria-label="t('reader.chart.wizardSwitchDec')" :disabled="draft.switchRound <= 2" @click="decSwitchRound"><AppIcon name="minus" :size="16" /></button>
        <span class="rcw__stepval">{{ draft.switchRound }} / {{ rows }}</span>
        <button class="rcw__stepbtn rcw__stepinc" :aria-label="t('reader.chart.wizardSwitchInc')" :disabled="draft.switchRound >= rows" @click="incSwitchRound"><AppIcon name="plus" :size="16" /></button>
      </div>

      <div v-if="step === 'review'" class="rcw__dpad">
        <button class="rcw__dbtn rcw__dbtn--up" :aria-label="t('reader.chart.wizardMoveUp')" @click="nudgeCenter(0, -1)"><AppIcon name="chevronUp" :size="20" /></button>
        <button class="rcw__dbtn rcw__dbtn--down" :aria-label="t('reader.chart.wizardMoveDown')" @click="nudgeCenter(0, 1)"><AppIcon name="chevronDown" :size="20" /></button>
        <button class="rcw__dbtn rcw__dbtn--left" :aria-label="t('reader.chart.wizardMoveLeft')" @click="nudgeCenter(-1, 0)"><AppIcon name="chevronLeft" :size="20" /></button>
        <button class="rcw__dbtn rcw__dbtn--right" :aria-label="t('reader.chart.wizardMoveRight')" @click="nudgeCenter(1, 0)"><AppIcon name="chevronRight" :size="20" /></button>
      </div>

      <div class="rcw__btns">
        <button v-if="step === 'inner'" class="btn rcw__reset" @click="resetDraft">{{ t('reader.chart.calibrateReset') }}</button>
        <button class="btn rcw__cancel" @click="cancel">{{ t('reader.chart.calibrateCancel') }}</button>
        <button v-if="step === 'outer'" class="btn rcw__back" @click="backToInner">{{ t('reader.chart.wizardBack') }}</button>
        <button v-if="step === 'switch'" class="btn rcw__back" @click="backFromSwitch">{{ t('reader.chart.wizardBack') }}</button>
        <button v-if="step === 'review'" class="btn rcw__back" @click="backFromReview">{{ t('reader.chart.wizardBack') }}</button>
        <button v-if="step === 'inner'" class="btn primary rcw__next" @click="validateInner">{{ t('reader.chart.wizardValidate') }}</button>
        <button v-if="step === 'outer'" class="btn primary rcw__next" @click="validateOuter">{{ t('reader.chart.wizardValidate') }}</button>
        <button v-if="step === 'switch'" class="btn primary rcw__next" @click="validateSwitch">{{ t('reader.chart.wizardValidate') }}</button>
        <button v-if="step === 'review'" class="btn primary rcw__save" @click="save">{{ t('reader.chart.calibrateSave') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rcw { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.rcw__zoomstage { position: relative; flex: 1; min-height: 0; }
.rcw__viewport { position: absolute; inset: 0; overflow: auto; touch-action: none; background: #fff; }
.rcw__imgwrap { position: relative; }
.rcw__imgwrap img { display: block; width: 100%; height: auto; -webkit-user-select: none; user-select: none; -webkit-user-drag: none; }
.rcw__guide {
  position: absolute;
  pointer-events: none;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  border: 2px solid var(--brand);
  border-radius: 50%;
  background: rgba(var(--brand-rgb), 0.12);
  display: grid;
  place-items: center;
}
.rcw__guide--square { border-radius: 0; }
/* Hexagone régulier "côté plat en haut" (clip-path standard) ; --pointy le tourne de 90°
   pour un sommet en haut — même repère fixe, orientation seule change. */
.rcw__guide--hexagon { border-radius: 0; clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%); }
.rcw__guide--hexagon.rcw__guide--pointy { clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%); }
.rcw__guide-cross { position: relative; width: 16px; height: 16px; }
.rcw__guide-cross::before, .rcw__guide-cross::after { content: ''; position: absolute; background: var(--brand); }
.rcw__guide-cross::before { left: 50%; top: 0; bottom: 0; width: 2px; margin-left: -1px; }
.rcw__guide-cross::after { top: 50%; left: 0; right: 0; height: 2px; margin-top: -1px; }
.rcw__canvas { position: relative; flex: 1; overflow: hidden; touch-action: none; background: #fff; }
.rcw__canvas img { display: block; width: 100%; height: 100%; object-fit: contain; -webkit-user-select: none; user-select: none; -webkit-user-drag: none; }
.rcw__overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.rcw__shape { fill: rgba(var(--brand-rgb), 0.12); stroke: var(--brand); stroke-width: 1.2; vector-effect: non-scaling-stroke; }
.rcw__shape--ghost { fill: none; stroke: rgba(58, 46, 40, 0.4); stroke-dasharray: 2 2; }
.rcw__shape--preview { fill: none; stroke: var(--brand); }
.rcw__center { stroke: var(--brand); stroke-width: 1; vector-effect: non-scaling-stroke; }
.rcw__bar { padding: var(--sp-2) max(var(--sp-3), var(--sa-right)) max(var(--sp-2), var(--sa-bottom)) max(var(--sp-3), var(--sa-left)); color: #fff; background: rgb(20, 18, 16); }
.rcw__hint { margin: 0 0 var(--sp-2); font-size: 12.5px; color: rgba(255, 255, 255, 0.8); }
.rcw__shapes, .rcw__tools, .rcw__orient { display: flex; gap: var(--sp-2); margin-bottom: var(--sp-2); }
.rcw__shapebtn, .rcw__tool, .rcw__orientbtn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; height: 40px; border: none; border-radius: var(--r-md); background: rgba(255, 255, 255, 0.14); color: #fff; font-size: 12.5px; font-weight: 700; }
.rcw__shapebtn--active, .rcw__tool--active, .rcw__orientbtn--active { background: var(--brand); color: var(--on-accent); }
.rcw__stepper, .rcw__dpad { display: flex; align-items: center; justify-content: center; gap: var(--sp-3); margin-bottom: var(--sp-2); }
.rcw__stepbtn { width: 40px; height: 40px; border: none; border-radius: var(--r-md); background: rgba(255, 255, 255, 0.16); color: #fff; font-size: 20px; font-weight: 800; }
.rcw__stepbtn:disabled { opacity: 0.35; }
.rcw__stepval { min-width: 56px; text-align: center; font-variant-numeric: tabular-nums; color: #fff; font-weight: 700; }
.rcw__dbtn { width: 44px; height: 44px; border: none; border-radius: var(--r-pill); background: rgba(255, 255, 255, 0.16); color: #fff; display: grid; place-items: center; }
.rcw__btns { display: flex; gap: var(--sp-2); justify-content: center; }
</style>
