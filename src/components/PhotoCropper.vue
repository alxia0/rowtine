<script setup>
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCropperStore } from '@/stores/cropper'
import { lockBodyScroll, unlockBodyScroll } from '@/utils/body-scroll-lock'
import { trapTabFocus, useDialogFocusReturn } from '@/composables/useFocusTrap'
import { initialRectForAspect, resizeWithAspect } from '@/utils/crop-geometry'

// Recadreur in-app : l'image s'affiche en entier (contain) ; un rectangle ajustable (déplaçable
// + 4 poignées d'angle, tout ratio) définit la zone gardée. À la validation, on découpe via canvas.
// Monté une seule fois dans App.vue, piloté par le store cropper (promesse).
const cropper = useCropperStore()

// Piège au Tab + restitution au déclencheur à la fermeture (dette audit UX 16/07,
// composable partagé) : le voile ne bloque le Tab que visuellement.
useDialogFocusReturn(() => cropper.open)
const { t } = useI18n()

const stage = ref(null) // conteneur de l'image
const imgEl = ref(null)
const disp = ref({ x: 0, y: 0, w: 0, h: 0 }) // rect d'affichage de l'image (px, repère du stage)
const rect = ref({ x: 0, y: 0, w: 0, h: 0 }) // rect de recadrage (px, repère du stage)
const MIN = 40 // taille mini du cadre (px)

// Calcule le rect d'affichage « contain » de l'image dans le stage, puis initialise le cadre
// à ~80 % centré, pour que les poignées soient visibles d'emblée.
function computeLayout() {
  const img = imgEl.value
  const st = stage.value
  if (!img || !st || !img.naturalWidth) return
  const sw = st.clientWidth
  const sh = st.clientHeight
  const ia = img.naturalWidth / img.naturalHeight
  const sa = sw / sh
  let w, h
  if (ia > sa) {
    w = sw
    h = sw / ia
  } else {
    h = sh
    w = sh * ia
  }
  disp.value = { x: (sw - w) / 2, y: (sh - h) / 2, w, h }
  if (cropper.aspect) {
    rect.value = initialRectForAspect(disp.value, cropper.aspect)
    return
  }
  const inset = 0.1
  rect.value = {
    x: disp.value.x + w * inset,
    y: disp.value.y + h * inset,
    w: w * (1 - 2 * inset),
    h: h * (1 - 2 * inset),
  }
}

// Verrou de défilement via le compteur partagé (refermer ICI ne doit
// plus déverrouiller le fond tant qu'une autre modale le tient). `verrouPose` : on ne
// libère que ce qu'on a posé — le démontage ne décompte jamais le verrou d'un autre.
let verrouPose = false
watch(
  () => cropper.open,
  async (v) => {
    if (v) {
      verrouPose = true
      lockBodyScroll()
    } else if (verrouPose) {
      verrouPose = false
      unlockBodyScroll()
    }
    if (v) {
      await nextTick()
      // L'image peut déjà être en cache : si chargée, calcule tout de suite.
      if (imgEl.value?.complete) computeLayout()
    }
  },
)
onBeforeUnmount(() => {
  if (verrouPose) {
    verrouPose = false
    unlockBodyScroll()
  }
  // Le glissé pose ses écouteurs sur `window`, pas sur un nœud du composant : sans ce
  // démontage explicite ils survivraient à l'instance (singleton monté par App.vue, donc
  // rare, mais un démontage en plein glissé laisserait deux écouteurs orphelins).
  onPointerUp()
})

function onImgLoad() {
  computeLayout()
}

function onImgError() {
  cropper.settle(null)
}

// --- Interactions (pointer = tactile + souris) ---
let drag = null // { mode, startX, startY, orig }

function clientToStage(e, r = stage.value.getBoundingClientRect()) {
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}
function onPointerDown(mode, e) {
  e.preventDefault()
  e.stopPropagation()
  // Rect du stage mesuré UNE fois ici (force un reflow) et réutilisé pendant tout le
  // geste (`onPointerMove` ci-dessous) : le stage ne bouge ni ne change de taille
  // pendant un glisser, le relire à chaque `pointermove` ne faisait que payer le même
  // reflow à chaque frame sans rien apprendre de plus.
  const stageRect = stage.value.getBoundingClientRect()
  drag = { mode, ...clientToStage(e, stageRect), orig: { ...rect.value }, stageRect }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  // `pointercancel` AUTANT que `pointerup` : sur WebView Android c'est LUI qui part quand le
  // système confisque le doigt (volet de notifications tiré, geste de retour au bord, appel
  // entrant). Sans cette ligne, `drag` restait armé et les écouteurs fenêtre attachés — le
  // doigt suivant, posé pour toucher « Recadrer », repartait de l'ANCIEN `drag.orig` et
  // déplaçait le cadre vers une zone jamais choisie, que le clic validait dans la foulée.
  window.addEventListener('pointercancel', onPointerUp)
}
function onPointerMove(e) {
  if (!drag) return
  const p = clientToStage(e, drag.stageRect)
  const dx = p.x - drag.x
  const dy = p.y - drag.y
  const o = drag.orig
  const b = disp.value // bornes = rect d'affichage de l'image
  if (drag.mode === 'move') {
    let nx = o.x + dx
    let ny = o.y + dy
    nx = Math.max(b.x, Math.min(nx, b.x + b.w - o.w))
    ny = Math.max(b.y, Math.min(ny, b.y + b.h - o.h))
    rect.value = { ...o, x: nx, y: ny }
    return
  }
  if (cropper.aspect) {
    rect.value = resizeWithAspect(drag.mode, o, dx, dy, b, cropper.aspect, MIN)
    return
  }
  // Redimensionnement par un coin : on borne les bords à l'image, mini MIN.
  let { x, y, w, h } = o
  const right = o.x + o.w
  const bottom = o.y + o.h
  if (drag.mode.includes('l')) {
    x = Math.max(b.x, Math.min(o.x + dx, right - MIN))
    w = right - x
  }
  if (drag.mode.includes('r')) {
    w = Math.max(MIN, Math.min(o.w + dx, b.x + b.w - o.x))
  }
  if (drag.mode.includes('t')) {
    y = Math.max(b.y, Math.min(o.y + dy, bottom - MIN))
    h = bottom - y
  }
  if (drag.mode.includes('b')) {
    h = Math.max(MIN, Math.min(o.h + dy, b.y + b.h - o.y))
  }
  rect.value = { x, y, w, h }
}
function onPointerUp() {
  drag = null
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
}

function cancel() {
  cropper.settle(null)
}
function confirm() {
  const img = imgEl.value
  const d = disp.value
  const r = rect.value
  if (!img || !d.w) return cropper.settle(cropper.src) // sécurité : renvoie l'original
  const scale = img.naturalWidth / d.w // px source par px affiché
  const sx = Math.max(0, (r.x - d.x) * scale)
  const sy = Math.max(0, (r.y - d.y) * scale)
  const sw = Math.min(img.naturalWidth - sx, r.w * scale)
  const sh = Math.min(img.naturalHeight - sy, r.h * scale)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(sw)
    canvas.height = Math.round(sh)
    const ctx = canvas.getContext('2d')
    // Fond blanc AVANT le dessin — même règle que resizeDataUrl (image-resize.js) et
    // cropCanvas (pdf.js) : le canvas naît transparent, le JPEG n'a pas d'alpha. Ce
    // remplissage est un DURCISSEMENT pour tout chemin où une image à alpha peut
    // arriver jusqu'ici (page PDF aujourd'hui, future version du
    // plugin caméra, tout futur chemin qui recadrerait une image à alpha). Il ne guérit PAS le défaut mesuré sur appareil le
    // 04/09/2026 : sur le chemin
    // galerie du plugin @capacitor/camera, LegacyCameraFlow ré-encode TOUT en JPEG
    // côté natif (compress JPEG, sans remplissage) — un PNG transparent y est déjà
    // un JPEG opaque fond noir quand la webview le reçoit ; aucune retouche JS ne
    // peut rattraper une alpha cuite dans les pixels. Sortie de secours pour ce
    // chemin : à arbitrer (galerie via input fichier, ou correctif natif).
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    cropper.settle(canvas.toDataURL('image/jpeg', 0.85))
  } catch {
    cropper.settle(cropper.src)
  }
}
</script>

<template>
  <div v-if="cropper.open" class="cr" role="dialog" aria-modal="true" @keydown="trapTabFocus">
    <div ref="stage" class="cr__stage">
      <img ref="imgEl" :src="cropper.src" class="cr__img" alt="" @load="onImgLoad" @error="onImgError" />
      <!-- masque assombri autour du cadre (4 bandes) -->
      <div class="cr__shade" :style="{ left: 0, top: 0, right: 0, height: rect.y + 'px' }"></div>
      <div class="cr__shade" :style="{ left: 0, top: rect.y + 'px', width: rect.x + 'px', height: rect.h + 'px' }"></div>
      <div
        class="cr__shade"
        :style="{ left: rect.x + rect.w + 'px', top: rect.y + 'px', right: 0, height: rect.h + 'px' }"
      ></div>
      <div class="cr__shade" :style="{ left: 0, top: rect.y + rect.h + 'px', right: 0, bottom: 0 }"></div>
      <!-- cadre de recadrage -->
      <div
        class="cr__frame"
        :style="{ left: rect.x + 'px', top: rect.y + 'px', width: rect.w + 'px', height: rect.h + 'px' }"
        @pointerdown="onPointerDown('move', $event)"
      >
        <span class="cr__h cr__h--tl" @pointerdown="onPointerDown('tl', $event)"></span>
        <span class="cr__h cr__h--tr" @pointerdown="onPointerDown('tr', $event)"></span>
        <span class="cr__h cr__h--bl" @pointerdown="onPointerDown('bl', $event)"></span>
        <span class="cr__h cr__h--br" @pointerdown="onPointerDown('br', $event)"></span>
      </div>
    </div>
    <div class="cr__bar">
      <button class="btn" @click="cancel">{{ t('common.cancel') }}</button>
      <button class="btn btn--primary" @click="confirm">{{ t('photo.crop') }}</button>
    </div>
  </div>
</template>

<style scoped>
.cr {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  flex-direction: column;
  background: #000;
}
.cr__stage {
  position: relative;
  flex: 1;
  overflow: hidden;
  touch-action: none; /* on gère nous-mêmes les gestes (pas de scroll/zoom natif) */
}
.cr__img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  user-select: none;
  -webkit-user-drag: none;
  pointer-events: none;
}
.cr__shade {
  position: absolute;
  background: rgba(0, 0, 0, 0.55);
  pointer-events: none;
}
.cr__frame {
  position: absolute;
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
  touch-action: none;
}
.cr__h {
  position: absolute;
  width: 26px;
  height: 26px;
  background: #fff;
  border: 2px solid var(--brand-deep);
  border-radius: 50%;
  touch-action: none;
}
.cr__h--tl {
  left: -13px;
  top: -13px;
}
.cr__h--tr {
  right: -13px;
  top: -13px;
}
.cr__h--bl {
  left: -13px;
  bottom: -13px;
}
.cr__h--br {
  right: -13px;
  bottom: -13px;
}
.cr__bar {
  display: flex;
  gap: var(--sp-3);
  padding: var(--sp-3) max(var(--sp-4), var(--sa-left)) max(var(--sp-4), var(--sa-bottom));
  background: #000;
}
.cr__bar .btn {
  flex: 1;
}
</style>
