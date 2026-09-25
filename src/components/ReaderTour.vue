<script setup>
// Visite guidée du lecteur (lot du 23/09/2026, onboarding guidé) : trois bulles posées
// par-dessus le lecteur ouvert sur le projet d'exemple, chacune autour d'une zone de
// l'écran (taille, étapes à cocher, diagramme).
//
// La visite ne fait QUE MONTRER. Le voile plein écran intercepte tous les appuis : rien
// de ce qui est dessous (taille, coches, rang du diagramme) ne peut être touché, donc rien
// n'est écrit. Le défilement, lui, reste libre : il sert à recadrer la cible.
//
// Le composant ne connaît pas le lecteur. ReaderView lui passe une liste d'étapes
// `{ key, target }`, où `target()` rend l'élément à entourer ou `null`. Une étape dont la
// cible est introuvable à l'ouverture est sautée, et les points ne comptent que les
// étapes présentes. Aucune étape présente : la visite se termine aussitôt.
//
// La fermeture (Passer, Échap ou Commencer) émet `done` avec sa raison. Un démontage
// SANS `done` (un message plus urgent a pris la file, cf. useNoticeSlot) n'est pas une
// fin : c'est au parent de décider, il reprendra la visite depuis le début.
import { ref, computed, onMounted, onBeforeUnmount, nextTick, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { trapTabFocus, useDialogFocusReturn } from '@/composables/useFocusTrap'
import { measureStickyTopHeight, RESPIRATION_SOUS_BANDEAUX } from '@/utils/sticky-top'
import { scrollBehavior } from '@/utils/scroll-behavior'

const props = defineProps({
  // [{ key: 'size' | 'steps' | 'chart', target: () => Element | null,
  //    focus?: () => Element | null  (la part de la cible qui doit rester visible),
  //    prepare?: (target) => void  (mise en place avant mesure, sans écriture) }]
  steps: { type: Array, required: true },
})
const emit = defineEmits(['done'])
const { t } = useI18n()

// Marge entre la bulle et l'anneau, et marge minimale aux bords de l'écran (maquette : 18px).
const GAP = 16
const EDGE = 18
// Épaisseur totale de l'anneau (4px de fond de carte + 4px d'accent) : la bulle se pose
// au-delà, jamais dessus.
const RING = 8

const titleId = useId()
const labelId = useId()
const bodyId = useId()
const present = ref([])
const index = ref(0)
const rect = ref(null)
const bubbleTop = ref(0)
const bubble = ref(null)
const primaryBtn = ref(null)
// Sonde de la zone sûre (fixe, invisible) : sa boîte rendue EST la bande
// [--sa-top, 100% - --sa-bottom], que la variable vienne d'env() ou du plugin natif.
const safeProbe = ref(null)

const current = computed(() => present.value[index.value] || null)
const isLast = computed(() => index.value === present.value.length - 1)

useDialogFocusReturn()

function finish(reason) {
  emit('done', reason)
}
function next() {
  if (isLast.value) finish('start')
  else goTo(index.value + 1)
}

/* ── mesure et placement ── */
// Règle de mise en page (revue du lot du 23/09/2026) : la partie VISIBLE de la cible n'est
// jamais recouverte par la bulle. La bulle se pose sous la cible, sinon au-dessus ; une
// cible trop haute pour partager l'écran avec la bulle est coupée : la découpe et l'anneau
// ne couvrent que la part qui reste visible à côté de la bulle, et le défilement a d'abord
// amené dans cette part ce qui compte (le haut de la cible, ou son `focus`, par exemple la
// bande du rang en cours d'un diagramme).
let rafId = 0
// Haut de la zone où une cible peut être vue : sous les bandeaux collants, mesuré UNE fois
// par étape (measureStickyTopHeight parcourt tout le DOM). Une cible `position: fixed` (le
// volet du diagramme en deux volets) n'est pas sous le bandeau du fil : la zone sûre suffit.
let visTop = 0
let observer = null
function safeBand() {
  const r = safeProbe.value?.getBoundingClientRect()
  const top = r ? r.top : 0
  const bottom = r && r.bottom > 0 ? r.bottom : window.innerHeight
  return { top, bottom }
}
function isFixed(el) {
  return getComputedStyle(el).position === 'fixed'
}
function measure() {
  rafId = 0
  const el = current.value?.target()
  if (!el) {
    rect.value = null
    return
  }
  const r = el.getBoundingClientRect()
  const h = bubble.value?.offsetHeight || 0
  const { top: safeTop, bottom: safeBottom } = safeBand()
  const minTop = safeTop + EDGE
  const maxTop = safeBottom - EDGE - h
  // Part de la cible à l'écran (sous les bandeaux, au-dessus du bas de la zone sûre).
  let top = Math.max(r.top, visTop)
  let bottom = Math.min(r.bottom, safeBottom)
  let y
  if (bottom + RING + GAP <= maxTop) {
    y = bottom + RING + GAP // sous la cible
  } else if (top - RING - GAP - h >= minTop) {
    y = top - RING - GAP - h // au-dessus
  } else if (r.top >= visTop || r.bottom > safeBottom) {
    // Cible trop haute : la bulle prend le bas de l'écran, la cible est coupée au-dessus
    // d'elle (son haut, où le défilement a amené ce qui compte, reste visible).
    y = maxTop
    bottom = Math.min(bottom, y - GAP - RING)
  } else {
    // Seul le BAS de la cible est à l'écran (son haut a défilé sous le bandeau) : c'est
    // lui qu'on garde, la bulle passe en haut.
    y = minTop
    top = Math.max(top, y + h + GAP + RING)
  }
  bubbleTop.value = Math.max(minTop, y)
  rect.value = bottom - top > 0 ? { top, left: r.left, width: r.width, height: bottom - top } : null
}
function scheduleMeasure() {
  if (rafId) return
  rafId = requestAnimationFrame(measure)
}

// Recadre la cible avant de poser sa bulle. Si la cible et la bulle tiennent ensemble
// entre les bandeaux collants et le bas de l'écran, le bloc « cible + bulle » y est centré.
// Sinon la cible est calée en haut, sous le bandeau ; et si son `focus` tomberait alors
// sous la bulle, c'est lui qui est centré dans la part visible. Une cible fixe ne défile pas.
function scrollToTarget(step, el) {
  const { top: safeTop, bottom: safeBottom } = safeBand()
  if (isFixed(el)) {
    visTop = safeTop
    return
  }
  visTop = Math.max(safeTop, measureStickyTopHeight())
  const h = bubble.value?.offsetHeight || 0
  const top0 = visTop + RESPIRATION_SOUS_BANDEAUX + RING
  // Hauteur laissée à la cible quand la bulle est posée dessous.
  const room = safeBottom - EDGE - h - GAP - RING - top0
  const r = el.getBoundingClientRect()
  let delta
  if (r.height <= room) {
    delta = r.top - (top0 + (room - r.height) / 2)
  } else {
    delta = r.top - top0
    const f = step.focus?.()
    if (f && el.contains(f)) {
      const fr = f.getBoundingClientRect()
      if (fr.bottom - delta > top0 + room) delta = fr.top - (top0 + Math.max(0, (room - fr.height) / 2))
    }
  }
  if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: scrollBehavior() })
}

function observe(el) {
  observer?.disconnect()
  if (el && typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(scheduleMeasure)
    observer.observe(el)
  }
}

async function goTo(i) {
  index.value = i
  // Le texte de la bulle change : sa hauteur, qui décide du placement, d'abord.
  await nextTick()
  const step = current.value
  const el = step?.target()
  if (el) {
    step.prepare?.(el)
    scrollToTarget(step, el)
  }
  observe(el)
  measure()
  primaryBtn.value?.focus({ preventScroll: true })
}

/* ── clavier et appuis ── */
function onKey(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    finish('skip')
  }
}
// Un appui sur le voile ne doit ni atteindre la page ni faire tomber le focus sur <body>
// (le piège de Tab ne tiendrait plus) : on l'avale.
function swallow(e) {
  e.preventDefault()
  e.stopPropagation()
}

onMounted(() => {
  present.value = props.steps.filter((s) => s && typeof s.target === 'function' && s.target())
  if (!present.value.length) {
    finish('skip')
    return
  }
  window.addEventListener('keydown', onKey)
  window.addEventListener('scroll', scheduleMeasure, { passive: true })
  window.addEventListener('resize', scheduleMeasure)
  goTo(0)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('scroll', scheduleMeasure)
  window.removeEventListener('resize', scheduleMeasure)
  if (rafId) cancelAnimationFrame(rafId)
  observer?.disconnect()
})

const holeStyle = computed(() => {
  const r = rect.value
  if (!r) return null
  return { top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px' }
})
</script>

<template>
  <div v-if="present.length" class="tour" data-test="reader-tour">
    <span ref="safeProbe" class="tour__safe" aria-hidden="true"></span>
    <!-- Bloqueur : capte TOUS les appuis au-dessus de la page, cible comprise. -->
    <div
      class="tour__block"
      :class="{ 'tour__block--dim': !rect }"
      data-test="reader-tour-block"
      @pointerdown="swallow"
      @mousedown="swallow"
      @click="swallow"
    ></div>
    <!-- Découpe : le voile est l'ombre géante de ce cadre, l'anneau ses deux premières
         ombres. Purement visuel (pointer-events: none), le bloqueur ci-dessus reste dessous. -->
    <div v-if="rect" class="tour__hole" :style="holeStyle" aria-hidden="true"></div>

    <div
      ref="bubble"
      class="tour__bubble"
      :style="{ top: bubbleTop + 'px' }"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="`${labelId} ${titleId}`"
      :aria-describedby="bodyId"
      @keydown="trapTabFocus"
    >
      <!-- Nom accessible = « Visite guidée du lecteur » + titre de la bulle : le seul titre
           ne disait pas qu'il s'agit d'une visite, ni qu'elle a plusieurs étapes. -->
      <span :id="labelId" class="sr-only">{{ t('tour.label') }}</span>
      <h2 :id="titleId" class="tour__title">{{ t(`tour.${current.key}.title`) }}</h2>
      <p :id="bodyId" class="tour__body">{{ t(`tour.${current.key}.body`) }}</p>
      <div class="tour__foot">
        <span class="tour__dots" aria-hidden="true">
          <span
            v-for="(s, i) in present"
            :key="s.key"
            class="tour__dot"
            :class="{ 'tour__dot--on': i === index }"
          ></span>
        </span>
        <span class="sr-only">{{ t('tour.progress', { n: index + 1, total: present.length }) }}</span>
        <button type="button" class="tour__skip" data-test="tour-skip" @click="finish('skip')">
          {{ t('tour.skip') }}
        </button>
        <button ref="primaryBtn" type="button" class="btn btn--primary tour__next" data-test="tour-next" @click="next">
          {{ isLast ? t('tour.start') : t('tour.next') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Z-index 70 : au-dessus du bandeau et de la barre d'action du lecteur (40), de la bande
   de zone sûre (45), de la feuille d'aide-mémoire (50-51) et de l'infobulle d'abréviation
   (60) ; SOUS les dialogues (ConfirmDialog 80, messages de la file à 1200+). La cible
   n'est jamais remontée au-dessus du voile : le lecteur a ses propres contextes
   d'empilement (.rhdr/.actionbar 40, .rpane 35), on dessine la découpe par-dessus. */
.tour {
  position: fixed;
  inset: 0;
  z-index: 70;
  /* Voile de la maquette (clair). Écrit en dur comme tous les voiles du projet. */
  --tour-veil: rgba(30, 22, 18, 0.62);
}
/* Sombre : le voile clair n'assombrit presque pas un fond déjà sombre (#151215), la
   découpe ne se lisait qu'à l'anneau. Voile plus dense, noir. Même double définition que
   le thème (media « Système » + attribut du choix explicite), cf. tokens.css. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .tour {
    --tour-veil: rgba(0, 0, 0, 0.8);
  }
}
:root[data-theme='dark'] .tour {
  --tour-veil: rgba(0, 0, 0, 0.8);
}
.tour__safe {
  position: fixed;
  top: var(--sa-top);
  bottom: var(--sa-bottom);
  left: 0;
  width: 0;
  visibility: hidden;
  pointer-events: none;
}
.tour__block {
  position: absolute;
  inset: 0;
  touch-action: pan-y;
}
/* Pas encore de cible mesurée : voile uni, sans découpe. Couleur du voile écrite en dur,
   comme tous les voiles du projet (aucun jeton n'existe pour eux). */
.tour__block--dim {
  background: var(--tour-veil);
}
.tour__hole {
  position: fixed;
  border-radius: 18px;
  pointer-events: none;
  box-shadow:
    0 0 0 4px var(--tile),
    0 0 0 8px var(--mustard),
    0 0 0 200vmax var(--tour-veil);
}
/* Fond --tile, celui de `.card` : la maquette pose la bulle et le liseré intérieur de
   l'anneau sur le même fond de carte (blanc en clair). --surface est le fond bleuté des
   boutons secondaires, il se confondrait avec eux. */
.tour__bubble {
  position: fixed;
  left: max(18px, calc(var(--sa-left) + 18px));
  right: max(18px, calc(var(--sa-right) + 18px));
  max-width: 480px;
  margin: 0 auto;
  padding: 20px;
  border-radius: var(--r-lg);
  background: var(--tile);
  color: var(--ink);
  box-shadow: 0 24px 50px -16px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tour__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 21px;
  font-weight: 700;
  line-height: 1.2;
}
.tour__body {
  margin: 0;
  font-size: 16px;
  line-height: 1.45;
  color: var(--ink-70);
}
.tour__foot {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
}
.tour__dots {
  display: flex;
  gap: 6px;
}
.tour__dot {
  width: 8px;
  height: 8px;
  border-radius: var(--r-pill);
  background: var(--ink-40);
}
.tour__dot--on {
  background: var(--brand);
}
.tour__skip {
  margin-left: auto;
  min-height: 44px;
  padding: 0 14px;
  border: 0;
  background: transparent;
  font-size: 16px;
  font-weight: 700;
  color: var(--ink-55);
}
.tour__next {
  min-height: 44px;
  padding: 0 20px;
  border-radius: var(--r-pill);
  font-size: 16px;
  font-weight: 700;
}
.sr-only {
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
</style>
