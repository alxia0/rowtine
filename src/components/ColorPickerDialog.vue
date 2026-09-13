<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/AppIcon.vue'
import { hsvToHslString, hslStringToHsv, hexToHsl, hslToHex } from '@/constants/swatch'
import { trapTabFocus, useDialogFocusReturn } from '@/composables/useFocusTrap'

// Pop-up « au doigt » (retour device : l'ancien <input type=color> natif était « moche et
// pas user-friendly »). Look GIMP : carré saturation × valeur qu'on glisse au doigt, bande
// de teinte, champ hexa pour la saisie précise. Émet toujours une chaîne hsl(...) — jamais
// de hex/HSV — pour rester au format de stockage de l'app (cf. constants/swatch.js).

const props = defineProps({
  open: { type: Boolean, default: false },
  color: { type: String, default: '' }, // couleur courante, chaîne hsl (peut être vide)
})
const emit = defineEmits(['close', 'pick'])
const { t } = useI18n()

// Défaut si `color` est vide/invalide à l'ouverture : un corail lisible (ni délavé ni noyé),
// pour qu'on voie tout de suite un repère dans le carré plutôt qu'un rouge pur aveuglant.
const DEFAULT_HSV = { h: 0, s: 70, v: 90 }

const h = ref(DEFAULT_HSV.h)
const s = ref(DEFAULT_HSV.s)
const v = ref(DEFAULT_HSV.v)

const areaEl = ref(null)
const dragging = ref(false)

// Instantané de l'ouverture (h/s/v + la chaîne hsl REÇUE). `confirm()` s'en sert pour
// renvoyer la couleur d'origine telle quelle quand rien n'a bougé : `hsl -> hsv -> hsl` n'est
// PAS neutre (les deux conversions arrondissent), et 7 des 30 couleurs de COLOR_PALETTE ne
// reviennent pas sur elles-mêmes — beige 30 % -> 29 %, bleu 55 % -> 54 %, jaune 78 % -> 79 %,
// etc. Réémettre la valeur dérivée après une simple ouverture-fermeture suffisait à rompre
// l'égalité de chaîne EXACTE dont dépendent `isCustomColor` et `COLOR_PALETTE.find(...)`
// (StashView) : la pastille se désélectionnait, le nom de coloris auto-rempli était effacé,
// et `save()` se bloquait ensuite sur « nom de coloris requis », sans aucune modification.
const opened = { h: DEFAULT_HSV.h, s: DEFAULT_HSV.s, v: DEFAULT_HSV.v, color: '' }

function initFrom(color) {
  const hsv = hslStringToHsv(color) || DEFAULT_HSV
  h.value = hsv.h
  s.value = hsv.s
  v.value = hsv.v
  opened.h = hsv.h
  opened.s = hsv.s
  opened.v = hsv.v
  // Vide si `color` était absente/illisible : on n'a alors rien de fidèle à renvoyer, et
  // `confirm()` retombe sur la dérivation normale.
  opened.color = hslStringToHsv(color) ? color : ''
  // Revue round-2 (minor) : `dragging` peut rester bloqué à `true` si le pop-up est fermé
  // en plein glissé (le `v-if` du template retire le DOM et saute `pointerup`, mais
  // l'instance du composant survit). Sans ce reset, un simple survol souris à la réouverture
  // reprendrait le glissé comme si le doigt était toujours posé.
  dragging.value = false
}

function onKey(e) {
  if (e.key === 'Escape') emit('close')
}

// `keyboardOpen` ancre le pop-up en HAUT du viewport (au lieu du bas) et donne à la
// carte de la place à défiler pendant la saisie du champ hexa (seul champ texte du
// pop-up — la bande de teinte est un <input type=range>, pas de clavier). Depuis le
// 29/07, le défilement du champ hexa lui-même (`scrollIntoView`) n'est plus fait ici :
// un mécanisme GLOBAL (src/utils/keyboard-avoidance.js, posé une fois dans main.js) le
// fait pour toute l'app — le faire ICI AUSSI ferait double emploi (deux défilements
// concurrents, tremblement visible). `keyboardOpen` reste nécessaire, lui, pour
// l'ancrage/la place à défiler ci-dessus. Le raisonnement complet (pourquoi ni
// `visualViewport` ni le plugin clavier de Capacitor) a été déplacé, pas perdu : cf.
// l'en-tête de src/utils/keyboard-avoidance.js.
const keyboardOpen = ref(false)
function onHexFocus() {
  keyboardOpen.value = true
}
function onHexBlur() {
  keyboardOpen.value = false
}

// Relecture (constat 1, 27/07) : le bouton retour Android ferme le clavier natif
// SANS déclencher `blur` DOM — mesuré au device, `activeElement` reste le champ hexa et
// `keyboardOpen` restait alors bloqué à `true` indéfiniment. Inoffensif avant l'extension
// `--kb-open` du paysage court ; désormais ça masque le carré et la bande de teinte sans
// qu'aucun clavier ne soit à l'écran. On se raccroche au même mécanisme que le blur
// normal (aucune détection de clavier ajoutée) : tout pointerdown sur la carte ailleurs
// referme aussi l'état « clavier ouvert ». Deux exclusions, toutes deux nécessaires :
// - `.cpick__row` (pas seulement `.cpick__hex`) : c'est un `<label>` qui enveloppe le
//   champ — taper le libellé ou le carré de prévisualisation active le champ (déjà actif,
//   donc SANS nouvel évènement `focus`) ; sans cette exclusion élargie, on retomberait à
//   `false` un instant avant que le navigateur ne reconfirme le focus, recréant l'état
//   masqué avec le clavier encore à l'écran.
// - `.cpick__actions` : au toucher (contrairement à la souris), le focus ne change qu'au
//   RELÂCHEMENT du doigt, pas à la pose — un `pointerdown` sur Enregistrer/Annuler
//   reflowerait la grille AVANT le relâchement, avec le doigt encore posé, risquant de
//   faire atterrir le tap sur le champ hexa (qui occupe la position du bouton dans la
//   grille pleine) plutôt que sur le bouton visé. Ces boutons ferment de toute façon le
//   pop-up (blur natif au clic, puis démontage) — pas besoin de ce correctif pour eux.
function onCardPointerDown(e) {
  if (keyboardOpen.value && !e.target.closest('.cpick__row, .cpick__actions')) {
    keyboardOpen.value = false
  }
}

// Relecture, 2e passe (28/07) : DÉCOUVERT en durcissant le correctif ci-dessus —
// taper Enregistrer/Annuler PENDANT que le champ hexa a le focus, en paysage court,
// pouvait ne pas fermer le pop-up. Reproduit tel quel sur le commit de livraison initial
// de cette tâche (0834303) : c'est bien l'extension --kb-open qui a créé ce point mort
// (rien à voir avec un clavier natif, jamais détecté ici). Cause : le blur NATIF du
// champ hexa (déclenché par l'action par défaut du navigateur au `mousedown`, PAS par ce
// composant) fait tomber `keyboardOpen` à `false` — donc la grille reflow (le carré/la
// teinte réapparaissent, la carte change de forme) — AVANT que le doigt ne se relève. Le
// clic synthétique qui suit fait alors son propre test de collision aux coordonnées
// d'origine, désormais occupées par un autre élément : le clic « rate » le bouton.
// Correctif : on empêche seulement l'action par défaut du `mousedown` (PAS du
// `pointerdown`/`touchstart` — les annuler couperait aussi le `click` compatible qui en
// dépend, cassant le bouton) sur Annuler/Enregistrer, uniquement quand ce point mort peut
// se produire : clavier ouvert, dans ce même paysage court (`matchMedia` — pas une
// détection de clavier, la MÊME requête média que la feuille de style, pour ne rien
// changer en portrait ni sur tablette). Le focus reste alors sur le champ hexa jusqu'au
// clic — la grille ne bouge plus sous le doigt — mais `confirm()`/`close()` se déclenchent
// normalement : `h`/`s`/`v` sont déjà à jour (liés en direct à la saisie, jamais au blur).
const KB_OPEN_LANDSCAPE_MQ = '(orientation: landscape) and (max-height: 500px)'
function onActionsMouseDown(e) {
  if (keyboardOpen.value && window.matchMedia(KB_OPEN_LANDSCAPE_MQ).matches) {
    e.preventDefault()
  }
}

// Piège déjà rencontré sur YarnWeightHelp (bloc 1) : sans { immediate: true }, un composant
// monté déjà ouvert n'attache jamais l'écouteur Échap. Ici ça initialise aussi l'état h/s/v.
// Piège au Tab + restitution au déclencheur à la fermeture (dette audit UX 16/07,
// composable partagé) : le voile ne bloque le Tab que visuellement.
useDialogFocusReturn(() => props.open)
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      initFrom(props.color)
      document.addEventListener('keydown', onKey)
    } else {
      document.removeEventListener('keydown', onKey)
      keyboardOpen.value = false
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
})

// Aperçu hexa : dérivé de h/s/v (sens unique). La saisie hexa (onHexInput) ne pousse que
// dans l'autre sens — pas de va-et-vient de watchers qui s'annuleraient l'un l'autre.
const hex = computed(() => hslToHex(hsvToHslString(h.value, s.value, v.value)))

function onHexInput(e) {
  const hslStr = hexToHsl(e.target.value)
  if (!hslStr) return // saisie incomplète/invalide en cours de frappe : on ignore, rien ne casse
  const hsv = hslStringToHsv(hslStr)
  if (!hsv) return
  h.value = hsv.h
  s.value = hsv.s
  v.value = hsv.v
}

function onHueInput(e) {
  h.value = Number(e.target.value) || 0
}

// Carré saturation × valeur (repère GIMP) : position du doigt/pointeur → s/v, bornés 0-100.
function updateFromPointer(e) {
  const rect = areaEl.value.getBoundingClientRect()
  const w = rect.width || 1
  const hh = rect.height || 1
  const x = Math.min(w, Math.max(0, e.clientX - rect.left))
  const y = Math.min(hh, Math.max(0, e.clientY - rect.top))
  s.value = Math.round((x / w) * 100)
  v.value = Math.round(100 - (y / hh) * 100)
}
function onAreaPointerDown(e) {
  dragging.value = true
  e.currentTarget.setPointerCapture?.(e.pointerId)
  updateFromPointer(e) // un simple tap positionne aussi, pas seulement le glissé
}
function onAreaPointerMove(e) {
  if (!dragging.value) return
  updateFromPointer(e)
}
function onAreaPointerUp(e) {
  dragging.value = false
  try {
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  } catch {
    /* déjà relâché (pointercancel) */
  }
}

const markerStyle = computed(() => ({ left: `${s.value}%`, top: `${100 - v.value}%` }))
// Seule la couleur de fond dépend de h — les deux dégradés (saturation/valeur) sont
// FIXES, posés en CSS statique (.cpick__area) plutôt que recalculés à chaque frappe.
const areaStyle = computed(() => ({ backgroundColor: `hsl(${h.value} 100% 50%)` }))

function confirm() {
  const untouched = h.value === opened.h && s.value === opened.s && v.value === opened.v
  emit('pick', untouched && opened.color ? opened.color : hsvToHslString(h.value, s.value, v.value))
  emit('close')
}
</script>

<template>
  <Transition name="fade">
    <div v-if="open" class="cpick" :class="{ 'cpick--kb-open': keyboardOpen }">
      <div class="cpick__scrim" @click="emit('close')"></div>
      <div
        class="cpick__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cpick-title"
        @pointerdown="onCardPointerDown"
        @keydown="trapTabFocus"
      >
        <header class="cpick__head">
          <h2 id="cpick-title" class="cpick__title">{{ t('yarn.colorPickerTitle') }}</h2>
          <button class="cpick__close" type="button" :aria-label="t('common.close')" @click="emit('close')">
            <AppIcon name="close" :size="18" />
          </button>
        </header>

        <div
          ref="areaEl"
          class="cpick__area"
          role="application"
          :aria-label="t('yarn.colorPickerArea')"
          :style="areaStyle"
          @pointerdown="onAreaPointerDown"
          @pointermove="onAreaPointerMove"
          @pointerup="onAreaPointerUp"
          @pointercancel="onAreaPointerUp"
        >
          <span class="cpick__marker" :style="markerStyle"></span>
        </div>

        <input
          class="cpick__hue"
          type="range"
          min="0"
          max="359"
          step="1"
          :value="h"
          :aria-label="t('yarn.colorPickerHue')"
          @input="onHueInput"
        />

        <div class="cpick__row">
          <span class="cpick__preview" :style="{ background: hex }"></span>
          <label class="cpick__hexwrap">
            <span class="cpick__hexlbl">{{ t('yarn.colorPickerHex') }}</span>
            <input
              class="input cpick__hex"
              type="text"
              autocapitalize="off"
              autocorrect="off"
              :value="hex"
              @input="onHexInput"
              @focus="onHexFocus"
              @blur="onHexBlur"
            />
          </label>
        </div>

        <div class="cpick__actions" @mousedown="onActionsMouseDown">
          <button class="btn cpick__cancel" type="button" @click="emit('close')">{{ t('common.cancel') }}</button>
          <button class="btn btn--primary cpick__ok" type="button" @click="confirm">{{ t('common.save') }}</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.cpick { position: fixed; inset: 0; z-index: 85; display: flex; align-items: flex-end; justify-content: center; }
/* Correctif clavier v2 (cf. commentaire du script) : ancre la carte en haut du viewport
   (jamais rétréci sous adjustNothing) au lieu du bas, pendant la saisie du champ hexa. */
.cpick--kb-open { align-items: flex-start; }
.cpick__scrim { position: absolute; inset: 0; background: rgba(58, 46, 40, 0.42); }
.cpick__card {
  position: relative;
  width: 100%;
  max-width: 480px;
  max-height: 90vh;
  overflow-y: auto;
  background: var(--bg);
  border-radius: var(--r-lg) var(--r-lg) 0 0;
  box-shadow: var(--e-3);
  padding: var(--sp-4) max(var(--sp-4), var(--sa-left)) max(var(--sp-4), var(--sa-bottom));
}
/* Marge basse généreuse pendant la saisie : garantit un vrai espace de défilement
   interne à la carte pour que scrollIntoView({block:'start'}) puisse remonter le champ
   hexa jusqu'en haut, quelle que soit la hauteur du carré/de la bande de teinte au-dessus.
   Marge haute (relecture finale 27/07) : en kb-open la carte est ancrée en haut
   (align-items: flex-start ci-dessus) et non plus en bas — sans plancher sur l'inset
   haut, le titre et la croix de fermeture passent sous la barre d'état pendant la
   saisie du champ hexa (8px mesurés sur la tablette, davantage sur écran à encoche). */
.cpick--kb-open .cpick__card { padding-top: max(var(--sp-4), var(--sa-top)); padding-bottom: 20vh; }
.cpick__head { display: flex; align-items: center; gap: var(--sp-2); }
.cpick__title { flex: 1; font-family: var(--font-display); font-size: 20px; margin: 0; }
.cpick__close {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border: 1px solid var(--line);
  background: var(--tile);
  color: var(--ink);
  border-radius: var(--r-md);
  box-shadow: var(--clay-sm);
}

/* Carré GIMP : saturation (gauche→droite) × valeur (bas→haut). touch-action: none
   indispensable — sinon le glissé du doigt scrolle la page sous le carré. */
.cpick__area {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  /* Dégradés saturation/valeur : FIXES (ne dépendent jamais de h/s/v), posés ici plutôt
     que recalculés à chaque frappe par `areaStyle` (cf. script) — seule la teinte de
     fond, elle, reste dynamique et vit en style inline. */
  background-image: linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent);
  /* Retour device 27/07 : `62vw` seul se calcule sur la LARGEUR — en paysage le carré
     dépassait à lui seul la hauteur de l'écran et poussait la bande de teinte, le champ
     hexa et les boutons hors champ. On borne aussi par la hauteur disponible. */
  max-height: min(62vw, 34vh);
  margin-top: var(--sp-3);
  border-radius: var(--r-md);
  border: 1px solid var(--line);
  touch-action: none;
  cursor: crosshair;
  overflow: hidden;
}
.cpick__marker {
  position: absolute;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid #fff;
  box-shadow: 0 0 0 1.5px rgba(0, 0, 0, 0.55), var(--clay-sm);
  transform: translate(-50%, -50%);
  pointer-events: none;
}

/* Bande de teinte : vrai <input type=range> habillé en arc-en-ciel — natif = clavier
   accessible gratuitement (ne pas remplacer par un div). */
.cpick__hue {
  width: 100%;
  height: 44px;
  margin-top: var(--sp-4);
  -webkit-appearance: none;
  appearance: none;
  background: linear-gradient(
    to right,
    hsl(0 100% 50%),
    hsl(60 100% 50%),
    hsl(120 100% 50%),
    hsl(180 100% 50%),
    hsl(240 100% 50%),
    hsl(300 100% 50%),
    hsl(360 100% 50%)
  );
  border-radius: var(--r-pill);
}
.cpick__hue::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid var(--ink);
  box-shadow: var(--clay-sm);
  cursor: pointer;
}
.cpick__hue::-moz-range-thumb {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid var(--ink);
  box-shadow: var(--clay-sm);
  cursor: pointer;
}
.cpick__hue::-moz-range-track {
  height: 44px;
  border-radius: var(--r-pill);
  background: transparent;
}

.cpick__row { display: flex; align-items: center; gap: var(--sp-3); margin-top: var(--sp-3); }
.cpick__preview {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: var(--r-md);
  border: 1px solid var(--line);
  box-shadow: var(--clay-sm);
}
.cpick__hexwrap { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.cpick__hexlbl { font-size: 11.5px; font-weight: 600; color: var(--ink-55); }
.cpick__hex { font-family: var(--font-ui); text-transform: lowercase; }

.cpick__actions { display: flex; gap: var(--sp-3); margin-top: var(--sp-4); }
.cpick__actions .btn { flex: 1; min-height: 44px; }

.fade-enter-active, .fade-leave-active { transition: opacity var(--motion-fast); }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* Paysage court (téléphone tourné) : empiler carré + teinte + hexa + boutons ne tient
   pas dans ~375 px de haut. On passe sur deux colonnes, le carré dimensionné par la
   hauteur disponible et non par la largeur. La carte s'ancre alors en plein écran
   plutôt qu'en feuille du bas. */
@media (orientation: landscape) and (max-height: 500px) {
  .cpick__card {
    max-width: 720px;
    max-height: 100vh;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
    grid-template-areas:
      'head head'
      'area hue'
      'area row'
      'area actions';
    grid-template-rows: auto auto auto 1fr;
    column-gap: var(--sp-4);
    /* Relecture (point mineur, 27/07) : sans effet ICI (la dernière ligne `1fr` absorbe
       déjà tout l'espace restant, donc rien à distribuer) — mais nécessaire pour l'état
       `.cpick--kb-open` juste en dessous, dont les 3 lignes sont toutes en `auto` (pas
       de `1fr`) : sans `align-content: start`, le comportement grid par défaut
       (`normal` ≈ `stretch`) étirerait les lignes pour combler l'espace restant. Ne pas
       retirer sous prétexte qu'elle semble inerte au premier état. */
    align-content: start;
    border-radius: var(--r-lg);
  }
  .cpick__head { grid-area: head; }
  .cpick__area {
    grid-area: area;
    align-self: start;
    /* Relecture (point mineur, 27/07) : la branche `100%` était inerte sur toute la plage
       où cette media query s'applique (`max-height: 500px` du viewport ⟹ `62vh` ≤
       310 px) — mesurée au device (223 px = 62 vh de 359, `100%` non contraignant à ce
       point). Piste : `align-self: start` laisse la hauteur de l'item en sizing
       intrinsèque plutôt qu'étirée sur la ligne de grille, donc `100%` n'a jamais eu de
       base de résolution plus petite que `62vh` pour redevenir la branche gagnante dans
       cette plage. Simplifié à `62vh` seul ; à re-vérifier si la borne `500px` de la
       media query change un jour. */
    max-height: 62vh;
    margin-top: var(--sp-3);
  }
  .cpick__hue { grid-area: hue; margin-top: var(--sp-3); }
  .cpick__row { grid-area: row; }
  .cpick__actions { grid-area: actions; align-self: end; margin-bottom: var(--sp-2); }

  /* Clavier ouvert (focus du champ hexa) : mesure device (27/07) — dans cette grille,
     le carré + la carte remplissent déjà pile la hauteur disponible (aucun
     débordement interne), donc le mécanisme --kb-open existant (scrollIntoView) n'a
     plus rien à faire défiler et hexa/boutons restent à leur place, sous le clavier
     natif (jamais détecté : adjustNothing ne réduit jamais innerHeight). On masque le
     carré et la bande de teinte pendant la saisie : hexa + boutons remontent seuls en
     haut de la carte, largement au-dessus de la zone que couvre un clavier Android.
     Ils réapparaissent au blur du champ. */
  .cpick--kb-open .cpick__card {
    grid-template-areas:
      'head head'
      'row row'
      'actions actions';
    grid-template-columns: 1fr;
    grid-template-rows: auto auto auto;
    /* Relecture (point mineur, 27/07) : le `padding-bottom: 20vh` global (règle non
       scopée, plus haut) réservait de la place de défilement pour `scrollIntoView` dans
       l'ancienne disposition une colonne. Ici la grille réduite (head/row/actions,
       carré+teinte masqués) tient déjà entièrement dans `100vh` — rien à faire défiler —
       donc ce padding n'était plus qu'un espace mort sous les boutons. Ramené au même
       plancher que `.cpick__card` de base (PAS 0 : il faut garder l'empiètement sur
       l'encoche/la zone système en bas d'écran, cf. `--sa-bottom`). */
    padding-bottom: max(var(--sp-4), var(--sa-bottom));
  }
  .cpick--kb-open .cpick__area,
  .cpick--kb-open .cpick__hue {
    display: none;
  }
}
</style>
