<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLightboxStore } from '@/stores/lightbox'
import { usePinchZoom } from '@/composables/usePinchZoom'
import { fitWithinBox, shouldRotatePanorama } from '@/utils/photo-fit'
import { lockBodyScroll, unlockBodyScroll } from '@/utils/body-scroll-lock'
import AppIcon from '@/components/AppIcon.vue'
import { trapTabFocus, useDialogFocusReturn } from '@/composables/useFocusTrap'

// Visionneuse plein écran montée une seule fois (App.vue). S'ouvre via le store lightbox.
// Fermeture : tap sur le fond, bouton ×, touche Échap, ou geste retour (géré dans App.vue).
const lb = useLightboxStore()
const { t } = useI18n()

// Piège au Tab + restitution au déclencheur à la fermeture (dette audit UX 16/07,
// composable partagé) : le voile ne bloque le Tab que visuellement.
useDialogFocusReturn(() => lb.open)

// Pincer-pour-zoomer, mecanique partagee avec les diagrammes (ChartStage.vue) — meme
// composable, memes seuils. Le viewport defilant est le nouveau conteneur .lb__viewport
// (il n'existait pas avant cette tache : l'image etait simplement centree dans .lb).
const viewport = ref(null)
const pz = usePinchZoom({ getViewport: () => viewport.value })

// Taille "au repos" (zoom 100 %) de la photo courante : ne doit JAMAIS depasser sa taille
// naturelle (correctif du 09/08, suite a revue) — sinon une petite photo basse resolution
// (frequent pour les photos extraites d'un PDF de patron) serait agrandie et floue des le
// repos, la ou l'ancienne visionneuse (`max-width/max-height: 100%`) restait nette. Voir
// src/utils/photo-fit.js pour le detail du calcul et sa justification complete.
//
// `naturalWidth/Height` ne sont connus qu'une fois l'image decodee (evenement `load`) — d'ou
// `natSize`, rempli par `onImgLoad`, et remis a `null` a chaque changement de photo pour ne
// jamais utiliser brievement les dimensions de la PRECEDENTE pendant que la nouvelle decode.
const natSize = ref(null) // { w, h } une fois connu

// Taille du viewport, mesuree explicitement (correctif du 09/08, suite a revue) : une lecture
// directe de `box.clientWidth/Height` DANS le computed ci-dessous n'est PAS reactive (ce ne
// sont pas des refs) — sans ce relevé explicite, `canvasStyle` reste figé sur les dimensions
// d'avant une rotation d'écran. Consequence sans ce correctif : après rotation, la photo garde
// sa taille d'avant (souvent trop haute), le viewport devient défilant alors qu'`isZoomed` est
// FAUX — le balayage « photo suivante » et le défilement natif redeviennent actifs en même
// temps, exactement le conflit que ce lot voulait éliminer.
const boxSize = ref({ w: 0, h: 0 })
function measureBox() {
  const box = viewport.value
  if (box) boxSize.value = { w: box.clientWidth, h: box.clientHeight }
}
function onWindowResize() {
  measureBox()
}
window.addEventListener('resize', onWindowResize)
onBeforeUnmount(() => window.removeEventListener('resize', onWindowResize))

function onImgLoad(e) {
  natSize.value = { w: e.target.naturalWidth, h: e.target.naturalHeight }
  measureBox()
}
watch(() => lb.current, () => { natSize.value = null })
watch(() => lb.open, (v) => { if (v) measureBox() })

// Taille de l'image : base "au repos" (fitWithinBox) multipliee par le zoom courant — c'est ce
// qui fait grandir la photo quand on zoome, sans jamais l'agrandir au-dela du necessaire a
// 100 %. Repli sur 100 % du canvas tant que l'image n'a pas encore decode (ou que le viewport
// n'a pas encore de mise en page connue) : evite un flash de taille 0 au tout premier rendu,
// avant que `onImgLoad` n'ait pu s'executer. Porte par l'<img> elle-meme (voir template) ;
// centree DANS `.lb__canvas` par flexbox (voir CSS et `canvasBoxStyle` ci-dessous, qui pilote
// la taille du canvas lui-meme).
//
// Cas PIVOTÉ (12/08) : la seule chose qui change ici est la BOÎTE passée à `fitWithinBox` — ses
// deux axes sont échangés, parce que présentée d'un quart de tour l'image dispose de la HAUTEUR
// du viewport pour sa largeur. On calcule donc la taille de l'image DEBOUT (non pivotée) qui
// tient dans cette boîte échangée ; la rotation elle-même est purement visuelle et vit dans le
// CSS (`.lb__canvas--rot .lb__img`, `transform: rotate(90deg)`), jamais dans cet objet — dont la
// FORME (deux clés, `width`/`height`, en px) est exposée et assérée telle quelle par trois tests
// existants du 09/08. Empreinte à l'écran une fois pivotée : (base.h × base.w) — elle tient dans
// le viewport par construction, puisque (base.w × base.h) tient dans la boîte échangée.
const rotated = computed(() =>
  natSize.value
    ? shouldRotatePanorama(natSize.value.w, natSize.value.h, boxSize.value.w, boxSize.value.h)
    : false,
)
const canvasStyle = computed(() => {
  const nat = natSize.value
  const box = rotated.value
    ? { w: boxSize.value.h, h: boxSize.value.w } // axes échangés : voir ci-dessus
    : { w: boxSize.value.w, h: boxSize.value.h }
  const base = nat ? fitWithinBox(nat.w, nat.h, box.w, box.h) : null
  if (!base) return { width: '100%', height: '100%' }
  const scale = pz.zoom.value / 100
  return { width: base.w * scale + 'px', height: base.h * scale + 'px' }
})

// Taille du CANVAS lui-meme (le conteneur defilant a l'interieur de `.lb__viewport`) :
// le VIEWPORT ENTIER (pas l'image) multiplie par le zoom courant. Contre-intuitif — on
// s'attendrait a ce que le canvas suive la taille de l'image, comme `canvasStyle` ci-dessus —
// mais c'est la seule forme qui garde le zoom ancre sous le doigt.
//
// La formule d'ancrage du composable partage (`usePinchZoom.js`), `(scrollLeft + ax) * ratio -
// ax`, n'est exacte QUE SI le decalage entre l'origine du contenu defilant (le canvas) et
// l'origine visuelle de l'image reste PROPORTIONNEL au zoom, a tout instant. Avec un canvas
// cale sur l'image (min-width/min-height: 100 %, ou toute taille derivee de `base`), ce
// decalage vaut (viewport − image) / 2 a 100 % puis TOMBE A ZERO des que l'image depasse le
// viewport : il ne suit pas le zoom, la formule perd sa cible — mesure : jusqu'a ~380 px de
// derive sur un double-tap (saut brusque de 100 % a 250 %, cf. `tapZoom` dans le composable).
//
// En calant le canvas sur le VIEWPORT, le decalage devient (viewport − base) * zoom / 100 :
// PROPORTIONNEL au zoom a tout instant (memes `o1 = k·z1`, `o2 = k·z2 = o1·r`), ce qui annule
// EXACTEMENT la derive, au pincement progressif comme au saut du double-tap (calcul algebrique
// + mesure navigateur, voir le rapport de correction). A zoom 100 %, canvas = viewport
// exactement (l'image y est centree, correctif du centrage toujours valide) ; au-dela, canvas >
// viewport, le viewport devient defilant EXACTEMENT quand `isZoomed` devient vrai (les deux
// franchissent leur seuil au meme zoom, ce qui renforce le correctif de la rotation d'ecran).
//
// Prix de cette exactitude, assume : sur l'axe ou l'image est plus petite que le viewport au
// repos, le canvas garde un espace vide PROPORTIONNEL a l'image a TOUT niveau de zoom (il ne se
// resorbe jamais) — defilement mort, pas de contenu inaccessible, mais bel et bien un espace a
// traverser en pan. Ne PAS "simplifier" en recalant le canvas sur l'image : la derive
// reviendrait sans qu'aucun test ne la signale (voir le test de proportionnalite qui protege
// precisement cette propriete).
const canvasBoxStyle = computed(() => {
  if (!boxSize.value.w || !boxSize.value.h) return { width: '100%', height: '100%' }
  const scale = pz.zoom.value / 100
  return { width: boxSize.value.w * scale + 'px', height: boxSize.value.h * scale + 'px' }
})
// `canvasBoxStyle` est VOLONTAIREMENT insensible à la rotation : c'est lui qui porte l'exactitude
// de l'ancrage du zoom, et il ne doit dépendre que du viewport et du zoom. La rotation n'échange
// aucun axe de DÉFILEMENT — seule l'<img>, tout au fond, est transformée ; le canvas défilant,
// lui, reste droit. Le décalage entre l'origine du canvas et l'empreinte pivotée vaut
// ((boxW − base.h)·z/2, (boxH − base.w)·z/2) : PROPORTIONNEL au zoom, exactement comme dans le
// cas debout, donc `(scrollLeft + ax) * ratio - ax` reste exact. Aucune ligne d'`usePinchZoom.js`
// n'a eu besoin de changer pour cette fonctionnalité.
defineExpose({ pz, canvasStyle, canvasBoxStyle, rotated })

// Verrouille le défilement de l'arrière-plan quand la visionneuse est ouverte — via le
// compteur partagé (fermer ici ne doit plus déverrouiller le fond
// tant qu'une autre modale le tient). `verrouPose` : on ne relâche que ce qu'on a posé,
// au watch comme au démontage.
let verrouPose = false
watch(
  () => lb.open,
  (v) => {
    if (v) {
      verrouPose = true
      lockBodyScroll()
    } else if (verrouPose) {
      verrouPose = false
      unlockBodyScroll()
    }
  },
)
onBeforeUnmount(() => {
  if (verrouPose) {
    verrouPose = false
    unlockBodyScroll()
  }
})

// Le zoom ne survit ni a un changement de photo (sinon la suivante s'ouvrirait agrandie au
// hasard) ni a une fermeture (rouvrir doit toujours repartir a 100 %).
watch(() => lb.index, () => pz.reset())
// `justPinched` non plus (revue du 09/08) : sans ce reset, un pincement fait juste avant de
// fermer laisserait la garde armee au prochain ouverture, bloquant a tort le premier balayage
// ou le premier tap sur le fond de la NOUVELLE session d'ouverture.
watch(() => lb.open, (v) => { if (!v) { pz.reset(); justPinched = false } })

function onKey(e) {
  if (!lb.open) return
  if (e.key === 'Escape') lb.close()
  else if (e.key === 'ArrowRight') lb.next()
  else if (e.key === 'ArrowLeft') lb.prev()
}
window.addEventListener('keydown', onKey)
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// Repere qu'une sequence a 2 doigts vient de se produire (pincement), jusqu'au debut d'un
// NOUVEAU geste a un seul doigt (voir onViewportPointerDown ci-dessous, qui remet a zero).
// Deux consommateurs en ont besoin, pour la MEME raison : `isZoomed` peut etre `false` au
// moment ou le geste se termine (relachement, ou touchend du balayage) alors qu'un pincement
// vient d'avoir lieu — pincement qui retombe a 100 %, ou contact accidentel a 2 doigts. Meme
// classe de defaut que la garde `wasMultiTouch` du composable partage (cf. usePinchZoom.js).
//
// UN SEUL drapeau, lu (jamais consomme/nettoye) par les deux consommateurs ci-dessous : un
// second drapeau parallele finirait par diverger du premier (deja arrive ailleurs dans ce
// projet). Il ne se nettoie qu'au prochain geste a UN SEUL doigt qui commence vraiment (pas au
// relachement) — sinon un clic ou un touchend qui suit de peu le relachement le liraient deja
// remis a zero.
let justPinched = false
function onViewportPointerDown(e) {
  if (pz.activePointers() === 0) justPinched = false // nouveau geste : on repart a zero
  pz.onPointerDown(e)
  if (pz.activePointers() >= 2) justPinched = true
}

// Balayage horizontal pour naviguer entre les photos — uniquement a taille normale : une
// fois l'image agrandie, le meme geste sert a se deplacer dans le detail (defilement natif
// du viewport), pas a changer de photo. Decision produit (09/08).
//
// `justPinched` protege un AUTRE cas : `sx`/`sy` sont poses par le PREMIER doigt touche
// (`touches[0]` dans `onTouchStart`, jamais mis a jour pendant le geste — pas d'ecoute de
// `touchmove`), alors que `dx` est mesure depuis `changedTouches[0]` du `touchend`, c'est-a-
// dire le doigt qui se LEVE — potentiellement l'AUTRE doigt d'un pincement a 2 doigts.
// L'ecart entre deux doigts differents depasse facilement le seuil de 50 px : sans cette
// garde, un pincement leger pourrait faire changer de photo par surprise.
let sx = 0
let sy = 0
function onTouchStart(e) {
  const tch = e.touches[0]
  sx = tch.clientX
  sy = tch.clientY
}
function onTouchEnd(e) {
  if (justPinched || pz.isZoomed.value) return
  const tch = e.changedTouches[0]
  const dx = tch.clientX - sx
  const dy = tch.clientY - sy
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
    if (dx < 0) lb.next()
    else lb.prev()
  }
}

// Garde anti-tap-fantome sur le fond (`@click="onBackdropClick"` sur .lb, remplace l'ancien
// `@click="lb.close()"` direct) : un pincement ou un deplacement dans l'image agrandie qui se
// termine au-dessus du fond ne doit pas fermer la visionneuse. Le fond n'a pas de
// gestionnaire pointer propre (le geste vit sur .lb__viewport/.lb__img).
//
// `isZoomed` reste un second filet, pour le cas simple ou le geste se termine ENCORE zoome
// (deplacement a un doigt qui s'acheve sur le fond) — `justPinched` ne couvre que la sequence
// a 2 doigts qui vient de finir, ce n'est pas le meme cas et les deux gardes sont necessaires.
function onBackdropClick() {
  if (justPinched) return
  if (pz.isZoomed.value) return
  lb.close()
}

// Garde anti-pincement sur les boutons (revue du 09/08) : `.lb__close` et les deux `.lb__nav`
// sont des FRERES de `.lb__viewport`, pas des descendants — un doigt de pincement qui se pose
// sur un chevron (48×48, à 12 px du bord, exactement là où atterrissent les doigts d'un
// écartement) n'est jamais vu par le composable (`pz.activePointers()` ne compte que les
// pointeurs poses sur le viewport), donc ni `justPinched` ni `isZoomed` ne peuvent voir ce cas.
// Au relachement de ce doigt, le clic sur le bouton part normalement et declenche l'action —
// la photo change, ou la visionneuse se ferme, a la fin d'un pincement qui n'a rien a voir avec
// ce bouton.
//
// Garde : si un AUTRE pointeur est encore actif sur le viewport au moment du clic (l'autre
// doigt du pincement, pas encore releve), on ignore le clic. Limite assumee : si ce doigt se
// releve juste AVANT le clic sur le bouton, activePointers() est deja a 0 et la garde ne le
// voit pas — inherent au mecanisme (on ne peut pas voir un pointeur qui n'a jamais touche le
// viewport), pas quelque chose a corriger ici sans construire un dispositif plus lourd.
function onCloseClick() {
  if (pz.activePointers() > 0) return
  lb.close()
}
function onPrevClick() {
  if (pz.activePointers() > 0) return
  lb.prev()
}
function onNextClick() {
  if (pz.activePointers() > 0) return
  lb.next()
}
</script>

<template>
  <Transition name="lb-fade">
    <div v-if="lb.open" class="lb" role="dialog" aria-modal="true" @click="onBackdropClick" @keydown="trapTabFocus">
      <button class="lb__close" :aria-label="t('common.close')" @click.stop="onCloseClick"><AppIcon name="close" :size="24" /></button>

      <button
        v-if="lb.hasMany"
        class="lb__nav lb__nav--prev"
        :aria-label="t('common.previous')"
        @click.stop="onPrevClick"
      >
        <AppIcon name="chevronLeft" :size="28" />
      </button>

      <div
        ref="viewport"
        class="lb__viewport"
        @pointerdown="onViewportPointerDown"
        @pointermove="pz.onPointerMove"
        @pointerup="pz.onPointerUp"
        @pointercancel="pz.onPointerUp"
      >
        <div class="lb__canvas" :class="{ 'lb__canvas--rot': rotated }" :style="canvasBoxStyle">
          <img
            :src="lb.current"
            data-test="lb-img"
            :data-rotated="rotated ? 'true' : 'false'"
            class="lb__img"
            :style="canvasStyle"
            alt=""
            @click.stop
            @load="onImgLoad"
            @touchstart.passive="onTouchStart"
            @touchend.passive="onTouchEnd"
          />
        </div>
      </div>

      <button
        v-if="lb.hasMany"
        class="lb__nav lb__nav--next"
        :aria-label="t('common.next')"
        @click.stop="onNextClick"
      >
        <AppIcon name="chevronRight" :size="28" />
      </button>

      <p v-if="lb.hasMany" class="lb__count">{{ lb.index + 1 }} / {{ lb.photos.length }}</p>
    </div>
  </Transition>
</template>

<style scoped>
.lb {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  background: rgba(0, 0, 0, 0.9);
  padding: max(var(--sp-4), var(--sa-top)) var(--sp-4) max(var(--sp-4), var(--sa-bottom));
}
/* Conteneur defilant (09/08) : avant cela, l'image etait directement centree
   dans .lb (flex + align/justify-content center) — il n'y avait rien a defiler. Le pincement
   a besoin d'un vrai viewport (overflow: auto), comme .cfs__viewport dans ChartStage. */
.lb__viewport {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  touch-action: pan-x pan-y;
  -webkit-overflow-scrolling: touch;
}
/* Taille pilotee depuis le script (`canvasBoxStyle`, voir <script setup> pour la justification
   complete de la formule et le prix assume) : le VIEWPORT ENTIER multiplie par le zoom courant,
   PAS la taille de l'image (contre-intuitif, ecrit en detail cote script pour qu'un futur
   remaniement ne l'efface pas sans le relire). A zoom 100 %, canvas = viewport exactement, ce
   qui restaure le centrage de la photo perdu par ce lot (correctif du 09/08 — avant lui,
   .lb__canvas etait un simple bloc colle en haut a gauche, jusqu'a 376 px de bande noire sous
   la photo, zero au-dessus, une zone morte pour les gestes ET pour le tap-pour-fermer).
   L'image (taille pilotee par `canvasStyle`) est centree dedans par flexbox, a tout niveau de
   zoom. */
.lb__canvas {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}
.lb__img {
  display: block;
  object-fit: contain;
  border-radius: var(--r-sm);
}
/* Présentation pivotée d'un panorama dans un viewport portrait (12/08 — critère et seuil dans
   src/utils/photo-fit.js, `shouldRotatePanorama`). UNE seule déclaration, volontairement.

   SEULE l'<img> tourne. `.lb__canvas` (le contenu défilant) et `.lb__viewport` restent droits :
   aucun axe de DÉFILEMENT n'est échangé, et la formule d'ancrage du zoom d'`usePinchZoom` reste
   exacte sans qu'une ligne du composable ait à changer (démonstration dans le <script>). Ne PAS
   « simplifier » en pivotant le canvas ou le viewport : l'ancrage y mourrait, et le lot du 09/08
   a déjà payé une fois pour l'obtenir. La rotation est purement visuelle ; la TAILLE, elle, est
   calculée côté script dans une boîte aux axes échangés.

   L'image reste centrée par le flexbox de `.lb__canvas`, comme dans le cas droit : la rotation se
   fait autour du centre (`transform-origin` par défaut), qui ne bouge donc pas.

   ⚠️ Une première version ajoutait ici `position: absolute` + `overflow: hidden` sur le canvas,
   « au cas où » : une rotation CSS ne changeant jamais la mise en page, la boîte de mise en page
   de l'image reste couchée, plus large que le canvas, et on craignait qu'elle rende
   `.lb__viewport` défilant dès le zoom 100 % (le conflit balayage/défilement éliminé le 09/08).
   MESURE du 12/08 : retirer l'une ou l'autre ne change RIEN — le débordement de défilement se
   calcule sur la boîte APRÈS transformation, et l'empreinte pivotée tient dans le canvas par
   construction. ⚠️ Mesure faite sur le Chromium de Playwright (Pixel 5 émulé), PAS encore sur la
   WebView du Nexus 7, bien plus ancienne : ce point-là a évolué au fil des versions de Chromium.
   Si le panorama montrait un défilement horizontal parasite à zoom 100 % sur un vieil appareil,
   `overflow: hidden` sur `.lb__canvas--rot` est le correctif d'une ligne. En attendant, c'étaient
   deux lignes qu'aucun test ne pouvait retenir ; ne pas les remettre « par sécurité » sans un
   test qui rougisse en leur absence. L'invariant lui-même (le viewport ne défile pas à zoom
   100 %) est asséré dans tests/e2e/guide-panorama.spec.js, et cette assertion-là mord (mutation
   M10 vérifiée).

   Sens de rotation : +90° (horaire). L'image se redresse quand l'appareil est tourné dans l'autre
   sens (vers la gauche). Les deux paysages sont atteignables — le manifeste Android ne fixe aucun
   `screenOrientation` — et l'app se ré-agence à la rotation (`configChanges` inclut
   `orientation`) : une fois le viewport en paysage, le critère cesse de mordre et l'image
   s'affiche droite, sans rotation résiduelle. */
.lb__canvas--rot .lb__img {
  transform: rotate(90deg);
}
.lb__close {
  position: absolute;
  top: max(var(--sp-3), var(--sa-top));
  right: var(--sp-3);
  width: 44px;
  height: 44px;
  border: none;
  border-radius: var(--r-pill);
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  font-size: 26px;
  line-height: 1;
}
.lb__nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 48px;
  height: 48px;
  border: none;
  border-radius: var(--r-pill);
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  font-size: 30px;
  line-height: 1;
}
.lb__nav--prev {
  left: var(--sp-3);
}
.lb__nav--next {
  right: var(--sp-3);
}
.lb__count {
  position: absolute;
  bottom: max(var(--sp-4), var(--sa-bottom));
  left: 0;
  right: 0;
  text-align: center;
  color: rgba(255, 255, 255, 0.85);
  font-size: 13px;
  font-weight: 600;
}
.lb-fade-enter-active,
.lb-fade-leave-active {
  transition: opacity var(--motion-fast);
}
.lb-fade-enter-from,
.lb-fade-leave-to {
  opacity: 0;
}
</style>
