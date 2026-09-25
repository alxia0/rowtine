<script setup>
// Cluster « éditeur zone-de-texte » — succède au correctif par bloc —
// habille createCmEditor (CM6, @/components/cm/cm-editor.js) en composant
// v-model:md standard, pour que CorrectionView le consomme sans connaître
// CodeMirror.
//
// Contrat : `value: props.md` au montage SEULEMENT (pas de watch — un
// changement externe de `md` après le montage n'est pas répercuté dans
// l'éditeur ; CorrectionView ne fait que lire draftMd via update:md, jamais
// le réassigner de l'extérieur pendant l'édition). `onChange` remonte
// `getValue()` (pas l'argument brut de l'updateListener CM6, cf. cm-editor.js)
// via `emit('update:md', …)`. `images` (map chemin → data-URL, cf.
// reader-editable.js) est poussée dans l'éditeur via `setImages` au montage.
//
// Flèches monter/descendre : portées depuis un spike jetable antérieur
// (depuis retiré), à l'identique pour la logique CM6 (une seule dispatch,
// offset de curseur relatif conservé).
//
// Bouton « Modifier le texte » (#3b, décision produit ; libellé renommé salve
// UX 3b) : fusionne l'ancienne bascule « Voir le balisage » et le bouton
// « Clavier » séparés en un seul contrôle. Par défaut l'écran
// s'ouvre en mode enrichi + clavier FERMÉ (défauts CM6, cf. cm-editor.js) ;
// « Modifier le texte » ON passe en vue balisage brute ET autorise
// l'ouverture du clavier virtuel via `editor.setKeyboard(on)`. ⚠️ Le
// comportement clavier réel (le clavier
// logiciel s'ouvre/se ferme effectivement) n'est PAS vérifiable en test
// unitaire/waydroid — c'est un GATE DEVICE (Pixel 7).
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/AppIcon.vue'
import { createCmEditor } from '@/components/cm/cm-editor'
import { moveLineUp, moveLineDown } from '@/components/cm/move-line'
import { revealLine as cmRevealLine } from '@/components/cm/reveal-line'
import { measureStickyTopHeight } from '@/utils/sticky-top'
import { SECTION_KINDS, SECTION_FAMILIES, groupedSectionKinds } from '@/utils/section-kinds.js'

const props = defineProps({
  md: { type: String, required: true },
  images: { type: Object, default: () => ({}) },
  // Tailles du patron, transmises a l'editeur pour le bouton « Aide memoire > Tailles »
  // (nombre de colonnes de la table). Suivi a chaud : le champ « Tailles » de l'ecran de
  // correction peut changer apres le montage.
  sizeLabels: { type: Array, default: () => [] },
  // Menu contextuel de catégorisation (cf. cm-editor.js openImageActionsMenu) : `null` =
  // comportement d'origine (clic sur une image = juste positionner le curseur). Fourni par
  // CorrectionView.vue, seul écran qui connaît chartStripRows/workingReader — ce composant ne
  // fait que le transmettre tel quel, sans l'interpréter (même rôle que `images/sizeLabels`).
  imageActions: { type: Object, default: null },
})
const emit = defineEmits(['update:md', 'cursor-line', 'cursor-moved'])

const { t, locale } = useI18n()

// Flèches monter/descendre : SORTIES du bandeau collant (retour terrain — « déplace
// les flèches en sur-impression... on gagne la place ») pour flotter au-dessus de
// l'éditeur, ancrées juste au-dessus de la barre Annuler/Enregistrer plutôt que de
// consommer 88px dans `.rte__bar` — c'est cette largeur qui manquait pour tenir
// « Modifier le texte » + les 6 puces sur une seule ligne (retour terrain répété,
// mesuré : 313px utiles à 360px d'écran contre 396px pour 9 contrôles à 44px).
// `.correct__actions` n'est PAS un enfant de ce composant (sibling dans
// CorrectionView.vue) : mesurée directement via ResizeObserver plutôt que par prop,
// même patron que `measureStickyTopHeight` (sticky-top.js) qui interroge aussi le
// DOM au-delà de son propre composant — sa hauteur varie (police d'accessibilité,
// zone de sécurité bas d'écran), un décalage figé en dur la faisait déjà dériver
// ailleurs dans l'écran (cf. son propre historique).
//
// (retour terrain, Nexus 7, second tour) : les flèches chevauchaient parfois
// le bouton Enregistrer. Cause racine TROUVÉE par reproduction Playwright (pas
// supposée) : `ResizeObserver.contentRect` mesure la boîte de
// CONTENU de `.correct__actions` (48px, seulement ses boutons), PAS sa boîte de
// BORDURE (73px, padding + bordure inclus) — l'écart (25px, exactement
// padding-top+padding-bottom+border-top) manquait au calc `bottom` du template,
// posant les flèches 25px trop bas, chevauchant systématiquement le bandeau dès
// qu'on défile en bas de page (REPRODUIT sans aucun focus ni clavier virtuel —
// simple `scrollTo` en bas de page, donc rien à voir avec le clavier, seulement le
// scénario le plus courant pour y arriver). Les pistes clavier/z-index envisagées
// sont donc écartées : `visualViewport.resize` n'aurait de toute façon
// rien changé ici (le clavier ne redimensionne jamais la fenêtre sur ce device,
// windowSoftInputMode="adjustNothing" — cf. tête de keyboard-avoidance.js, mesure
// device déjà faite le 29/07) ; z-index (30 contre l'empilement par défaut de
// `.correct__actions`) fonctionne comme prévu, les flèches peignent bien PAR-DESSUS
// le bandeau quand leurs rectangles se recoupent — c'est justement pour ça que le
// chevauchement se VOIT (le bouton Enregistrer disparaît sous elles) plutôt que
// l'inverse.
// `borderBoxSize` (API ResizeObserver moderne, cf. MDN) donne la bonne mesure ;
// repli sur `getBoundingClientRect().height` (même grandeur) si absente.
function borderBoxHeight(entry) {
  const box = entry.borderBoxSize?.[0]
  return box ? box.blockSize : entry.target.getBoundingClientRect().height
}
const actionsHeight = ref(0)
let actionsObserver = null

const editorHost = ref(null)
// Cible du appendChild(toolbar) de createCmEditor (cf. opts.toolbarHost, cm-editor.js) :
// la barre de requalification est montée DANS `.rte__bar`, le même conteneur collant
// que les flèches + « Modifier le texte », pour n'avoir plus qu'UN seul bandeau collant
// (fusion des deux bandeaux séparés).
const toolbarHost = ref(null)
// #3b — un seul bouton : par défaut mode enrichi + clavier fermé (défauts CM6).
// « Modifier le texte » ON → vue balisage brute + clavier autorisé ; OFF → enrichi + clavier fermé.
const codeMode = ref(false)
const codeLabel = computed(() =>
  codeMode.value ? t('correction.toolbar.enrichedView') : t('correction.toolbar.editCode'),
)
const codeIcon = computed(() => (codeMode.value ? 'eye' : 'edit'))

let editor = null // { getValue, setValue, toggleMarkup, setMarkupHidden, setImages, setKeyboard, view, toolbar }

// Libellés de TOUTE la barre de requalification (cf. FR_TOOLBAR_LABELS dans
// cm-editor.js), traduits via useI18n() — cm-editor.js est un module pur, hors
// i18n, donc les libellés y arrivent en argument (opts.labels). Clés listées
// explicitement (pas de boucle sur Object.keys) : une clé oubliée ici tombe
// silencieusement sur le repli FR de cm-editor.js plutôt que de planter.
const TOOLBAR_LABEL_KEYS = [
  'step', 'note', 'text', 'counter', 'counterRep', 'counterCadence',
  'section', 'reference', 'chart', 'yarn', 'needles', 'gauge', 'materials',
  'tips', 'abbreviations', 'measurements', 'techniques', 'ariaToolbar', 'ariaCounter',
  'ariaSection', 'ariaReference', 'referenceChip', 'ariaEditor', 'editCounterTitle',
]

// Libellés du mini-dialogue de saisie numérique (openNumberPrompt, cf.
// cm-editor.js) — mêmes clés que labels.prompt. `cancel` réutilise la clé
// common.cancel existante plutôt que d'en dupliquer une
// sous correction.prompt.
const PROMPT_LABEL_KEYS = ['cadenceEvery', 'cadenceTimes', 'repeatTimes']

function editorLabels() {
  const kindLabels = {
    kinds: Object.fromEntries(SECTION_KINDS.map((k) => [k.key, t(`reader.kind.${k.key}`)])),
    families: Object.fromEntries(SECTION_FAMILIES.map((f) => [f, t(`reader.family.${f}`)])),
  }
  return {
    ...Object.fromEntries(TOOLBAR_LABEL_KEYS.map((key) => [key, t(`correction.toolbar.${key}`)])),
    // Menu Section : diagramme/echantillon exclus, doublons de la
    // barre (bouton Diagramme du menu Aide mémoire, balise Échantillon des
    // 7 libellés de référence).
    sections: groupedSectionKinds(kindLabels, locale.value, { exclude: ['diagramme', 'echantillon'] }),
    prompt: {
      cancel: t('common.cancel'),
      ...Object.fromEntries(PROMPT_LABEL_KEYS.map((key) => [key, t(`correction.prompt.${key}`)])),
    },
  }
}

onMounted(() => {
  editor = createCmEditor(editorHost.value, {
    value: props.md,
    onChange: () => emit('update:md', editor.getValue()),
    onSelectionLine: (line) => emit('cursor-line', line),
    onCursorMoved: (line) => emit('cursor-moved', line),
    labels: editorLabels(),
    locale: locale.value,
    sizeLabels: props.sizeLabels,
    imageActions: props.imageActions,
    // Les refs de template sont peuplées avant onMounted : toolbarHost.value est déjà
    // le nœud `.rte__toolbar-host` ici. cf. commentaire de la déclaration de la ref.
    toolbarHost: toolbarHost.value,
  })
  editor.setImages(props.images)

  const actionsEl = document.querySelector('.correct__actions')
  if (actionsEl) {
    // Valeur immédiate (avant même le 1er callback ResizeObserver, qui ne tourne
    // qu'après le prochain passage de mise en page) : élimine aussi la fenêtre,
    // même brève, où `actionsHeight` vaudrait encore sa valeur initiale (0).
    actionsHeight.value = actionsEl.getBoundingClientRect().height
    if ('ResizeObserver' in window) {
      actionsObserver = new ResizeObserver((entries) => {
        actionsHeight.value = borderBoxHeight(entries[0])
      })
      actionsObserver.observe(actionsEl, { box: 'border-box' })
    }
  }
})

// Seul watch legitime de ce composant : il ne porte que sur sizeLabels, pas sur
// props.md (contrat « value: props.md au montage seulement », cf. en-tete). Le champ
// « Tailles » de l'ecran de correction est editable a chaud, apres le montage de
// l'editeur.
watch(
  () => props.sizeLabels,
  (next) => editor?.setSizeLabels(next),
  { deep: true }
)

onBeforeUnmount(() => {
  editor?.view?.destroy()
  editor = null
  actionsObserver?.disconnect()
  actionsObserver = null
})

// ⚠️ Séquencement fragile à la relecture : cette fonction pose
// `codeMode.value = true` PUIS appelle `setKeyboard(true)` (cm-editor.js), qui fait
// `blur()` puis `focus()` sur le contentDOM CM6 — un `focusin` RÉEL repart donc de façon
// SYNCHRONE, ici, avant que Vue ait patché le DOM avec la classe `rte__bar--compact`
// (les mutations de refs réactives ne patchent le DOM qu'au prochain tick, via la file de
// microtâches). On pourrait donc croire que `onFocusIn` (keyboard-avoidance.js), qui lit
// la hauteur du bandeau via `measureStickyTopHeight()`, mesurerait la barre ENCORE en 2
// lignes. Il n'en est rien : `onFocusIn` diffère sa mesure d'un `requestAnimationFrame`,
// qui s'exécute après la file de microtâches (donc après le patch DOM de Vue) — au moment
// où `measureStickyTopHeight()` tourne réellement, `rte__bar--compact` est déjà posée et
// la barre déjà compacte. Rien à changer ici : c'est un ordre d'exécution qui « marche »
// par la combinaison microtâche (Vue) / macrotâche-frame (rAF), pas par construction
// évidente à la lecture — d'où ce commentaire, et le test C (scrollMarginTop) qui le
// vérifie par la chaîne complète plutôt qu'en relisant une valeur CSS déclarée.
function onToggleCode() {
  if (!editor) return
  codeMode.value = !codeMode.value
  editor.setMarkupHidden(!codeMode.value) // code ON = markup visible = hidden false
  editor.setKeyboard(codeMode.value)
}

// moveLineUp/moveLineDown : extraites dans cm/move-line.js pour être
// testables sans monter le composant Vue (cf. tests/unit/move-line.spec.js,
// qui prouve notamment le déplacement d'une ligne image — comportement réel
// que le mock unitaire de ce composant, reader-text-editor.spec.js, ne peut
// pas exercer faute de `view` CM6 complet).
function onMoveUp() {
  if (editor) moveLineUp(editor.view)
}
function onMoveDown() {
  if (editor) moveLineDown(editor.view)
}

// Cible d'ouverture : l'écran hôte demande de poser le
// curseur sur une ligne précise après le montage. Exposé plutôt qu'appelé par
// une prop : c'est un geste ponctuel, pas un état — une prop devrait être
// remise à zéro après usage, ce que personne ne penserait à faire.
//
// (retour terrain du 2026-08-23) : la ligne visée
// atterrissait en haut de l'écran plutôt que centrée dans la zone RÉELLEMENT
// visible — cf. le commentaire de tête de `reveal-line.js` pour le diagnostic
// complet (lu dans le code source de CodeMirror lui-même) et le calcul retenu
// (`EditorView.scrollMargins`, où la hauteur de ligne s'annule entièrement).
// `occlusion.top`/`occlusion.bottom` sont deux FONCTIONS, pas deux nombres
// déjà lus : CodeMirror les appelle lui-même, plus tard, durant SA PROPRE
// passe de mesure — passer des nombres figés ICI reviendrait à mesurer trop
// tôt (mesuré en Playwright réel : au montage, ni `measureStickyTopHeight()`
// ni l'oracle interne de hauteur de ligne de CM6 ne sont encore stabilisés,
// cf. reveal-line.js). Réutilisent deux mécanismes déjà en place plutôt qu'un
// troisième inventé : `measureStickyTopHeight()` (src/utils/sticky-top.js,
// déjà partagé avec keyboard-avoidance.js pour le même besoin côté haut
// d'écran) et `actionsHeight` (ref mesurée en continu par ResizeObserver
// depuis plus haut — hauteur de BORDURE de `.correct__actions`).
//
// ⚠️ Relecture : le facet posé par `cmRevealLine`
// (`EditorView.scrollMargins`, `StateEffect.appendConfig`) reste actif pour
// TOUTE la vie de l'éditeur, pas seulement pour ce scroll d'ouverture — CM6
// l'appelle donc à nouveau à CHAQUE frappe (toute frappe pose
// `scrollIntoView: true` en interne). Sans précaution, `measureStickyTopHeight()`
// — un parcours de TOUT LE DOM (`document.querySelectorAll('*')` +
// `getComputedStyle` par nœud, `src/utils/sticky-top.js`) — repartirait donc à
// chaque caractère tapé : exactement le coût que ce fichier évite déjà
// ailleurs pour `recheckCaretMargin` (garde `!update.docChanged`, cf.
// cm-editor.js) sur un appareil (Nexus 7) déjà connu pour ses lenteurs. On
// mémoïse donc son résultat : le PREMIER appel — déclenché par la propre
// passe de mesure de CodeMirror, une frame après ce `dispatch` (cf.
// reveal-line.js pour le pourquoi de ce délai) — mesure et GÈLE la valeur
// pour le reste de la session ; les frappes suivantes ne retouchent plus le
// DOM. Compromis assumé : si `.rte__bar` change de hauteur PLUS TARD dans la
// session (bascule « Modifier le texte », police d'accessibilité) après ce
// premier appel, les défilements suivants (frappe, flèches monter/descendre)
// utiliseront la hauteur GELÉE, pas la nouvelle — un écart mineur sur un
// défilement de CONFORT (garder le curseur visible), jamais sur le geste
// D'OUVERTURE qui a motivé ce correctif (déjà réglé au moment du gel, avant
// qu'aucune bascule n'ait pu avoir lieu). `bottom` reste appelé en direct à
// chaque fois : `actionsHeight.value` n'est qu'une lecture de ref (déjà tenue
// à jour par ResizeObserver), sans le coût d'un parcours DOM.
function revealLine(lineNumber) {
  if (!editor) return false
  let cachedTop = null
  const getTop = () => {
    if (cachedTop === null) cachedTop = measureStickyTopHeight()
    return cachedTop
  }
  return cmRevealLine(editor.view, lineNumber, {
    top: getTop,
    bottom: () => actionsHeight.value,
  })
}
// Ligne CM6 (state.doc.line) ciblée par `lineNumber` (1-based), ou `null` si l'éditeur
// n'est pas monté ou si `lineNumber` sort du document — garde COMMUNE à `replaceLine` et
// `insertImageLine` (toutes deux des transactions ponctuelles sur une ligne précise) : un
// futur ajustement de ce qui compte comme un numéro de ligne valide ne doit se corriger
// qu'à UN seul endroit.
function lineAt(lineNumber) {
  if (!editor) return null
  const { state } = editor.view
  if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > state.doc.lines) return null
  return state.doc.line(lineNumber)
}

// Remplace le CONTENU d'une ligne entière (1-based), par une transaction CM6 — le seul
// chemin d'écriture correct depuis l'extérieur. Le contrat du composant (`value: props.md`
// au montage SEULEMENT, cf. en-tête) fait qu'écrire `draftMd` côté parent ne toucherait PAS
// le document de l'éditeur : les deux divergeraient en silence jusqu'au prochain montage.
// Ici, c'est le document qui change, donc `onChange` émet `update:md` et le parent reste la
// destination, jamais la source. Appelé par le renommage de diagramme (CorrectionView).
// `false` si l'éditeur n'est pas monté ou si le numéro de ligne sort du document.
function replaceLine(lineNumber, text) {
  const line = lineAt(lineNumber)
  if (!line) return false
  editor.view.dispatch({ changes: { from: line.from, to: line.to, insert: String(text ?? '') } })
  return true
}

// Insère une NOUVELLE ligne image juste après `lineNumber` (1-based) — l'ancrage (quel
// rang/étape porte l'image) est résolu en AMONT par l'appelant (imageAnchorLine,
// step-line.js) : ce composant ne fait qu'écrire la transaction CM6 et rafraîchir la map
// d'images pour l'aperçu immédiat (`editor.setImages`, jusqu'ici posée une seule fois au
// montage, cf. onMounted plus haut — aucune image n'était ajoutée APRÈS coup jusqu'à ce
// geste, retour terrain 27/08/2026, insertion depuis la galerie). `false` si l'éditeur
// n'est pas monté ou si `lineNumber` sort du document — même contrat que `replaceLine`.
function insertImageLine(lineNumber, mdPath, dataUrl) {
  const line = lineAt(lineNumber)
  if (!line) return false
  editor.view.dispatch({ changes: { from: line.to, to: line.to, insert: `\n  ![](${mdPath})` } })
  // `props.images` est déclarée `Object` (défaut `{}`, cf. props ci-dessus) même si
  // CorrectionView.vue lui passe toujours un vrai Map en pratique (buildImageMap) : `new
  // Map(...)` seul planterait (`TypeError: not iterable`) sur la forme objet — celle du
  // contrat déclaré ET des autres tests de ce composant (`images: {}`).
  const merged = props.images instanceof Map ? new Map(props.images) : new Map(Object.entries(props.images || {}))
  merged.set(mdPath, dataUrl)
  editor.setImages(merged)
  return true
}

defineExpose({ revealLine, replaceLine, insertImageLine })
</script>

<template>
  <div class="rte">
    <!-- Un seul bandeau collant (`.rte__bar`) pour la barre de requalification
         (montée dedans par createCmEditor via opts.toolbarHost, cf. <script>) ET
         « Modifier le texte » : fusion des deux bandeaux séparés qui laissaient une
         fente de texte défiler entre eux. Les flèches monter/
         descendre n'y vivent plus (cf. `.rte__line-movers` plus bas) : c'est ce qui
         libère la place pour tenir les 6 puces + « Modifier le texte » sur une seule
         ligne (retour terrain). `rte__bar--compact` : réduit la barre de balisage à 1 ligne
         défilante en mode texte, seul moment où le clavier virtuel est ouvert et où
         la place manque vraiment. « Modifier le texte » EN FIN de bandeau :
         reprend la place laissée libre par la pastille de type de ligne, retirée pour
         Note (redondante avec le libellé déjà visible sous l'icône de sa puce, même
         défaut que Texte avant elle) — seule Aide-mémoire l'affiche encore, cf.
         updateToolbarActive (cm-editor.js). -->
    <div class="rte__bar" :class="{ 'rte__bar--compact': codeMode }">
      <div ref="toolbarHost" class="rte__toolbar-host"></div>
      <div class="rte__controls">
        <button type="button" class="rte__toggle btn" :aria-label="codeLabel" @click="onToggleCode">
          <AppIcon :name="codeIcon" />
        </button>
      </div>
    </div>
    <!-- Indice PERMANENT (pas un onboarding — réapparaît à
         chaque ouverture en mode lecture, `codeMode` repart à `false` à chaque montage,
         cf. sa déclaration plus haut) signalant que le clavier virtuel ne s'ouvrira pas
         tant que « Modifier le texte » n'est pas activé. Ne dépend pas de l'aide repliée
         (CorrectionHelp.vue) : visible sans action de l'utilisatrice. Toujours monté (pas
         de v-if) : un `codeMode` qui bascule ne doit pas faire disparaître ce bloc et
         décaler `.rte__host` juste sous le doigt qui vient d'appuyer sur « Modifier le
         texte » — seul le TEXTE change d'état, la hauteur reste stable. -->
    <p class="rte__hint">
      {{ codeMode ? t('correction.keyboardOpenHint') : t('correction.keyboardClosedHint') }}
    </p>
    <div ref="editorHost" class="rte__host"></div>
    <!-- Flèches monter/descendre : EN SURIMPRESSION au-dessus de l'éditeur (retour
         terrain), pas dans le bandeau collant. Ancrées juste au-dessus de la barre
         Annuler/Enregistrer (`.correct__actions`, mesurée par ResizeObserver, cf.
         <script>) — jamais recouvertes par elle, toujours atteignables sans défiler. -->
    <div class="rte__line-movers" :style="{ bottom: `calc(${actionsHeight}px + var(--sp-2))` }">
      <button
        type="button"
        class="rte__arrow rte__arrow--up btn"
        :aria-label="t('correction.moveCursorUp')"
        @click="onMoveUp"
      >
        <AppIcon name="chevronUp" />
      </button>
      <button
        type="button"
        class="rte__arrow rte__arrow--down btn"
        :aria-label="t('correction.moveCursorDown')"
        @click="onMoveDown"
      >
        <AppIcon name="chevronDown" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.rte {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

/* --- Bandeau collant unique de l'éditeur --- */
.rte__bar {
  /* Fusion des deux bandeaux collants (flèches + « Modifier le texte » d'un côté,
     barre de requalification de l'autre) : ils avaient chacun
     leur propre `top` en calc(), censés s'accorder mais mesurés en désaccord de 8px
     (le `gap` du conteneur `.rte`, resté de l'espace de flux réel) — une tranche de
     texte du patron défilait, hachée, dans cette fente. Un seul conteneur collant,
     donc un seul `top`, élimine structurellement tout accord de calc() à maintenir.
     Le `top` reprend exactement la boîte d'AppHeader (padding-top max(--sp-4,
     encoche) + bouton 44px + padding-bottom --sp-4, cf. `.hdr` dans AppHeader.vue) :
     c'est désormais le SEUL `top` sticky DE L'ÉDITEUR, là où il y en avait deux à
     faire s'accorder. L'écran, lui, en compte toujours un second : ce même `.hdr`
     est collant et calé à zéro, ici comme sur tous les écrans — c'est précisément
     pourquoi le `top` ci-dessous reprend sa boîte. z-index entre
     AppHeader (40) et le contenu de l'éditeur : l'ordre de pile suit l'ordre
     d'empilement visuel (header, puis ce bandeau). */
  position: sticky;
  top: calc(max(var(--sp-4), var(--sa-top)) + 44px + var(--sp-4));
  z-index: 35;
  background: var(--bg);
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--sp-1);
  padding-block: 6px;
  /* Pleine largeur de l'écran (retour terrain) : `.correct` pose
     `max(--sp-4, --sa-*)` de padding horizontal (CorrectionView.vue) — ce bandeau
     s'en évade (marge négative qui annule EXACTEMENT le `--sp-4`, jamais la zone de
     sécurité) puis ne se repadde qu'à hauteur de cette même zone de sécurité, pas du
     `--sp-4` retiré. Sans ce gain de 2×16px, « Modifier le texte » + les 6 puces de
     `.cm-retag-toolbar` (332px mesurés) ne tenaient pas sur une seule ligne à 360px
     d'écran (313px utiles avant ce correctif) — 345px après, marge confortable. */
  margin-inline: calc(-1 * var(--sp-4));
  /* (retour terrain du 2026-08-23) : la barre à fleur du bord
     gauche (paragraphe ci-dessus) gênait visuellement — une marge était souhaitée, côté
     gauche seulement (le droit reste tel quel, zone de sécurité seule). Remesuré en
     Playwright réel (360px ET 393px, position réelle du dernier contrôle — « Modifier
     le texte » — contre le bord droit de `.rte__bar`) avant de figer une valeur : le
     `var(--sp-4)` (16px) plein, pourtant celui qui avait justement été retiré ci-dessus
     pour gagner de la place, tient désormais SANS déborder aux deux largeurs (4px de
     marge résiduelle à 360px, 37px à 393px) — les 6 puces + « Modifier le texte » ont
     gagné de la place depuis la mesure du paragraphe ci-dessus (pastille de type de
     ligne retirée pour Note, Section/Aide-mémoire passés en puce), donc les 13px
     de marge résiduelle alors mesurés sont dépassés aujourd'hui. Pas de retrait vers
     `--sp-2` : `--sp-4` (cohérent avec le padding standard de `.correct`) passe déjà la
     mesure réelle. `max(--sp-4, --sa-left)`, pas une somme des deux : sur un écran à
     encoche latérale (`--sa-left` > 16px), `.correct` lui-même ne pousse son padding
     qu'à `max(--sp-4, --sa-*)` (paragraphe ci-dessus) — sommer ferait déborder cette
     barre 16px plus loin que le reste du contenu de l'écran, alors que `max()` la
     réaligne exactement dessus (le cas `--sa-left` = 0, seul mesurable en émulateur,
     est inchangé par ce choix : `max(16, 0)` = `16` dans les deux formes). */
  padding-inline: max(var(--sp-4), var(--sa-left)) var(--sa-right);
  flex-wrap: nowrap;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.rte__controls {
  display: flex;
  align-items: center;
  flex: none;
}

.rte__toolbar-host {
  display: flex;
  align-items: center;
  min-width: 0;
}

/* Carré 44×44 (icône seule + aria-label) partagé par les flèches monter/descendre
   (.rte__arrow) et « Modifier le texte » (.rte__toggle) — déclaration commune,
   un seul endroit à maintenir.
   Retour terrain : « Modifier le texte » était le seul contrôle du bandeau à porter
   un libellé CÔTE À CÔTE de son icône (~157px, mesuré) — l'unique raison pour
   laquelle `.rte__controls` (44+44+157 ≈ 260px) ne pouvait pas rejoindre les 6
   puces de `.cm-retag-toolbar` sur la même ligne défilante sans déborder bien
   davantage. « Modifier le texte »/« Vue enrichie » (les 2 états du libellé, cf.
   codeLabel) sont des PHRASES, pas des mots courts comme les puces
   Étape/Note/Texte : les empiler icône/libellé à 9px sous l'icône (comme ces
   puces) les faisait retomber à la ligne DANS le carré 44px, cassant sa hauteur.
   Repli sur le MÊME patron que les flèches (icône seule + `aria-label`, carré
   44×44 identique) plutôt qu'un empilement qui ne tient pas : la découvrabilité
   tactile (raison d'être du libellé visible sur les puces, cf. leur commentaire)
   reste couverte différemment ici — `.rte__hint` juste en dessous NOMME déjà ce
   bouton en toutes lettres (« Active « Modifier le texte » pour taper »), un texte
   TOUJOURS visible, contrairement au `title` HTML qu'il remplaçait à l'origine. */
.rte__arrow,
.rte__toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  padding: 8px;
}

/* Flèches monter/descendre : EN SURIMPRESSION au-dessus de l'éditeur (retour
   terrain — « déplace les flèches en sur-impression... on gagne la place »), plus
   dans le bandeau collant. `bottom` posé en style INLINE (template) : mesuré par
   ResizeObserver sur `.correct__actions`, jamais figé en dur ici — sa hauteur varie
   (police d'accessibilité, zone de sécurité bas d'écran), cf. commentaire du
   <script>. `position: fixed` (pas `sticky`) : doit rester ancrée au VIEWPORT,
   au-dessus de l'éditeur qui défile sous elle, pas au flux de `.rte`. */
.rte__line-movers {
  position: fixed;
  right: max(var(--sp-4), var(--sa-right));
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.rte__line-movers .rte__arrow {
  border-radius: var(--r-pill);
  background: var(--surface);
  box-shadow: var(--clay-sm);
}

.rte__host {
  border-radius: var(--r-sm);
}

/* Indice discret « clavier fermé, mode lecture ».
   Même traitement que les autres textes d'appoint du projet (ex. .ppf__hint,
   PatternPriceFields.vue) : petite taille, --ink-55 — visible sans dominer
   l'écran, jamais un onboarding qu'on ferme (pas de bouton pour l'écarter). */
.rte__hint {
  margin: 0;
  font-size: 13px;
  color: var(--ink-55);
}
</style>

<!--
  Feedback device — correctif de style (fix B) : `lineTypePlugin` et
  `wireToolbar`/`updateToolbarActive` (cm-editor.js) posent bien la barre
  `.cm-retag-toolbar` et les classes `.cm-line.md-<type>` / `.is-active` dans
  le DOM, mais AUCUNE règle ne les stylait — ces nœuds sont `appendChild`-injectés
  par createCmEditor (pas des nœuds de template Vue), donc un <style scoped>
  ne les touche jamais (l'attribut data-v-* n'est posé que sur les nœuds émis
  par LE template de CE composant). D'où ce second bloc, volontairement NON
  scoped : seul moyen d'atteindre ces nœuds sans devoir répéter :deep(...) sur
  chaque règle (risque d'oubli = règle silencieusement no-op). Les noms de
  classe (cm-*, md-*) sont propres à cet éditeur → fuite globale négligeable.

  7 couleurs de catégorie (adaptées du banc PC, tools/mdedit/styles.css, au
  palais chaud « Chaleur & Artisanat » de l'app, cf. src/styles/tokens.css) :
  gardées DISTINCTES par teinte, mais désaturées/réchauffées pour ne pas jurer
  avec le fond crème (--bg) ni la marque terracotta (--brand). Même couleur
  utilisée pour : (a) la bordure+teinte de la ligne (`.cm-line.md-*`), (b) le
  contour au repos de l'affordance de la barre, (c) son remplissage `.is-active`
  — pour que « la catégorie a pris » se lise d'un coup d'œil (barre ↔ ligne).
-->
<style>
.rte {
  /* Variables de catégorie, scopées via le sélecteur .rte (pas :root) pour ne
     pas polluer le thème global — lues par les règles ci-dessous. */
  --mdc-rang: var(--ink);
  --mdc-note: #8a5a00; /* ambre chaud, même famille que --mustard, assombri pour l'AA */
  --mdc-section: var(--sage-deep); /* réutilise le token existant (vert sage) */
  --mdc-compteur: #7a4f9e; /* prune sourd — distinct, réchauffé depuis le violet du banc */
  --mdc-image: #2f6690; /* bleu ardoise — distinct, compatible avec la palette chaude */
  --mdc-reference: #8a7a6e; /* gris chaud (au lieu du gris froid du banc) */
  --mdc-texte: transparent; /* catégorie par défaut : aucun accent, sert de contraste aux autres */
}

/* Palette sombre : les 4 teintes ci-dessus ont été assombries spécifiquement pour
   l'AA sur fond CRÈME (--bg clair) — gardées telles quelles en sombre, leur
   luminosité serait insuffisante sur --bg quasi noir (ex. --mdc-image #2f6690 sur
   --bg sombre ≈ 3:1, sous le seuil AA texte 4,5:1). Éclaircies ici en préservant la
   même famille de teinte (cf. commentaires ci-dessus) ; contraste recalculé
   (WCAG) ≥ 7:1 sur --bg sombre pour les 4 — valeurs PROVISOIRES, à confirmer à la
   revue visuelle. --mdc-rang (var(--ink)) et --mdc-section
   (var(--sage-deep)) suivent déjà le thème via leurs tokens, inchangés ici. */
:root[data-theme='dark'] .rte,
html[data-theme='dark'] .rte {
  --mdc-note: #d1a24d;
  --mdc-compteur: #b98fe0;
  --mdc-image: #6fa8cf;
  --mdc-reference: #b3a496;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .rte {
    --mdc-note: #d1a24d;
    --mdc-compteur: #b98fe0;
    --mdc-image: #6fa8cf;
    --mdc-reference: #b3a496;
  }
}

/* --- (2) Couleur par ligne : accent bordure gauche + teinte de fond faible ---
   `.md-rang` (étape, type PAR DÉFAUT — la majorité des lignes d'un patron) N'A PAS
   d'accent bordure : contrairement à note/section/compteur/image/référence, elle ne
   porte AUCUNE teinte de fond, donc son accent restait le seul trait plein posé sur
   la quasi-totalité des lignes de l'éditeur — la case à cocher qui précède chaque
   étape (RowCheckWidget) la distingue déjà sans lui. Retour terrain (revue UX) : avec
   le cadre de l'éditeur juste à côté (0 espace, cf. .cm-content plus bas) et l'accent
   de la ligne SUIVANTE/PRÉCÉDENTE d'une autre catégorie, la colonne de gauche empilait
   jusqu'à 3 traits verticaux distincts (cadre, étape, section) et devenait illisible.
   Retirer CET accent (le plus fréquent, le moins informatif) libère aussi la colonne
   pour le surlignage de ligne active (.cm-active-block plus bas), qui n'a alors plus
   à rivaliser avec lui sur la majorité des lignes. */
.rte .cm-line.md-rang {
  border-left: 3px solid transparent;
  background: transparent;
}
.rte .cm-line.md-note {
  border-left: 3px solid var(--mdc-note);
  background: rgba(138, 90, 0, 0.07);
}
.rte .cm-line.md-section {
  border-left: 3px solid var(--mdc-section);
  background: rgba(95, 115, 88, 0.08);
}
.rte .cm-line.md-compteur {
  border-left: 3px solid var(--mdc-compteur);
  background: rgba(122, 79, 158, 0.08);
}
.rte .cm-line.md-image {
  border-left: 3px solid var(--mdc-image);
  background: rgba(47, 102, 144, 0.07);
}
/* Affordance de la ligne image sélectionnée au tap (cf. cm-editor.js
   selectImageLine) — un outline (pas une 2e bordure latérale) pour rester
   lisible/distinct de l'accent de catégorie déjà posé ci-dessus. */
.rte .cm-line.cm-image-line-selected {
  outline: 2px solid var(--mdc-image);
  outline-offset: -2px;
  background: rgba(47, 102, 144, 0.16);
}
/* Teinte commune aux trois lignes de la famille « aide-mémoire » (référence,
   sous-titre de technique, repli de tableau) — factorisée, chacune n'ajoute plus que
   sa propre déclaration ci-dessous. */
.rte .cm-line.md-reference,
.rte .cm-line.md-sous-titre,
.rte .cm-line.md-tableau {
  border-left: 3px solid var(--mdc-reference);
  background: rgba(138, 122, 110, 0.08);
}
/* Sous-titre de technique (`### Titre`) : même teinte que `.md-reference` — un
   `###` ne vit que dans un bloc Techniques (`## Techniques {techniques}`), c'est la même
   famille d'aide-mémoire. `font-weight` distingue visuellement le titre de technique du
   corps `.md-texte` qui l'entoure, une fois le `### ` masqué par addLineMaskDecorations. */
.rte .cm-line.md-sous-titre {
  font-weight: 700;
}
/* Ligne de tableau NON rendue en widget (repli) : rangées de largeurs
   différentes, séparatrice absente, ligne isolée… Le balisage reste alors affiché tel
   quel — jamais de perte silencieuse — mais la ligne s'annonce comme faisant partie
   d'un tableau : même teinte que `.md-reference` (un tableau ne vit que dans un bloc
   d'aide-mémoire, Abréviations ou Tailles) et chiffres alignés. */
.rte .cm-line.md-tableau {
  font-variant-numeric: tabular-nums;
}
.rte .cm-line.md-texte {
  border-left: 3px solid transparent;
  background: transparent;
}

/* Le tableau rendu à la place du bloc source (TableWidget, cm-editor.js). Aucune
   couleur en dur : `--mdc-reference` porte déjà ses deux valeurs de thème (cf. les
   blocs sombres ci-dessus) et `--line`/`--surface`/`--ink` sont des tokens
   thème-aware (src/styles/tokens.css) — le tableau suit donc les deux thèmes sans
   règle sombre supplémentaire.
   `display: block; overflow-x: auto` : un tableau des tailles à beaucoup de colonnes
   défile DANS son cadre au lieu d'élargir l'éditeur sur une largeur de téléphone. */
.rte .cm-md-table {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  margin: 4px 0 4px 6px;
  border-left: 3px solid var(--mdc-reference);
  font-variant-numeric: tabular-nums;
}
.rte .cm-md-table th,
.rte .cm-md-table td {
  border: 1px solid var(--line);
  padding: 4px 8px;
  text-align: left;
  color: var(--ink);
  /* Pas de `white-space: nowrap` : la 2e colonne du tableau des ABRÉVIATIONS est une
     définition en toutes lettres (`| dim. | diminuer une maille |`), qui doit revenir
     à la ligne dans sa cellule plutôt que d'imposer un défilement horizontal. Les
     chiffres du tableau des tailles restent alignés par `tabular-nums` ci-dessus.
     En revanche il FAUT annuler la coupure de mot que CodeMirror pose sur tout le
     contenu (`.cm-lineWrapping { overflow-wrap: anywhere; word-break: break-word }`,
     thème de base de @codemirror/view) : héritée telle quelle, elle laisse le
     navigateur rétrécir la colonne des abréviations jusqu'à couper `dim.` en
     « di / m. » — constaté en capture avant ce correctif. Les mots restent entiers,
     la cellule revient à la ligne entre les mots. */
  overflow-wrap: normal;
  word-break: normal;
  white-space: normal;
}
.rte .cm-md-table th {
  background: var(--surface);
  font-weight: 700;
}
/* Rangée où se trouve le curseur (classe posée par markCursorRow, cm-editor.js). Même
   traitement que `.cm-line.cm-active-block` ci-dessous — teinte de marque + filet à
   gauche — parce que c'est la même information : « c'est ici que je suis, et c'est ça
   que les flèches vont déplacer ». Sans elle le curseur est invisible dans un tableau,
   la ligne source étant masquée par le widget.
   Sélecteur en `> *` : porte sur les cellules, seules à peindre un fond (un `<tr>` ne
   peint rien sous `border-collapse: collapse`), et l'emporte sur le fond de `th`. */
.rte .cm-md-table tr.is-cursor-row > * {
  background: color-mix(in srgb, var(--brand) 12%, transparent);
}
.rte .cm-md-table tr.is-cursor-row > *:first-child {
  box-shadow: inset 2px 0 0 var(--brand-deep);
}
:root[data-theme='dark'] .rte .cm-md-table tr.is-cursor-row > *,
html[data-theme='dark'] .rte .cm-md-table tr.is-cursor-row > * {
  background: color-mix(in srgb, var(--brand) 22%, transparent);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .rte .cm-md-table tr.is-cursor-row > * {
    background: color-mix(in srgb, var(--brand) 22%, transparent);
  }
}
/* Les décorations de ligne CM6 posent la classe sur `.cm-line` sans retirer son
   padding par défaut : on ajoute un peu de retrait gauche pour que le texte ne
   colle pas à la bordure d'accent. */
.rte .cm-line[class*='md-'] {
  padding-left: 6px;
}

/* #3a — caret visible. Pas de drawSelection() dans cet éditeur (décision de
   design) : le caret est le caret NATIF du contentEditable → couleur = caret-color
   (PAS .cm-cursor, qui n'existe pas ici). Défaut sombre = invisible sur fond
   sombre ; on force une couleur thème-aware. Spécificité montée (.cm-editor)
   pour l'emporter sur le thème de base CM6 injecté dans <head>. */
.rte .cm-editor .cm-content {
  caret-color: var(--brand-deep);
}
:root[data-theme='dark'] .rte .cm-editor .cm-content,
html[data-theme='dark'] .rte .cm-editor .cm-content {
  caret-color: var(--mustard, #e8ad4c);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .rte .cm-editor .cm-content {
    caret-color: var(--mustard, #e8ad4c);
  }
}

/* #3a — surbrillance du bloc (ligne) où se trouve le curseur. Se superpose aux
   fonds rgba par catégorie (md-*) sans les masquer : léger fond + accent.
   Retour terrain (revue UX) : à 12%/22%, ce fond restait trop proche en intensité
   des teintes rgba de catégorie (7-8% d'alpha, cf. règles md-* plus haut) — sur une
   ligne Note/Section/Compteur/Image/Référence, les deux se superposaient sans lecture
   nette de « c'est ICI que je suis ». Relevé à 20%/32% et trait d'accent élargi à 3px
   (même largeur que l'accent de catégorie, pour rivaliser à poids égal plutôt qu'en
   trait plus fin) : reste net même superposé à la teinte la plus soutenue (Section,
   8%). Profite aussi du retrait de l'accent `.md-rang` (ci-dessus) : sur une étape (la
   majorité des lignes), ce surlignage n'a plus de trait de catégorie à égaler sur la
   même colonne. */
.rte .cm-line.cm-active-block {
  background: color-mix(in srgb, var(--brand) 20%, transparent);
  box-shadow: inset 3px 0 0 var(--brand-deep);
}
:root[data-theme='dark'] .rte .cm-line.cm-active-block,
html[data-theme='dark'] .rte .cm-line.cm-active-block {
  background: color-mix(in srgb, var(--brand) 32%, transparent);
}

/* Audit UI #13 : contenu de l'éditeur trop petit/serré (cm-editor.js ne pose aucun
   fontSize/lineHeight → hérite d'un défaut ~14px). On grossit le texte et on aère
   l'interligne pour la lecture prolongée d'un patron ; le padding-block ajoute de
   l'air par-dessus l'interligne sans dépendre de lui (marge visible même à
   interligne serré), et s'additionne sans conflit au padding-left ci-dessus. */
.rte .cm-content {
  /* Sans cette règle, `.cm-content` hérite du monospace par défaut de CodeMirror
     (thème de base @codemirror/view) : la tricoteuse corrigeait donc son patron
     dans une chasse fixe de terminal, alors que ReaderView affiche le MÊME texte
     en --font-ui — ce qu'elle corrige ne ressemblait pas à ce qu'elle lira.
     --font-ui est la seule police de lecture du projet (--font-display est
     réservée aux titres, cf. tokens.css). */
  font-family: var(--font-ui);
  font-size: 16px;
  line-height: 1.75;
  /* Retour terrain (revue UX) : sans cet espace, l'accent bordure d'une ligne (3px,
     ci-dessus) touche DIRECTEMENT le cadre de `.cm-editor` (1px, plus bas) — mesuré à
     0px d'écart. Le cadre et l'accent de catégorie lisaient alors comme un seul bloc
     de traits verticaux plutôt que deux informations distinctes (« ceci est la zone de
     texte » vs « cette ligne est une Section »). 5px suffit à les séparer visuellement
     sans décaler le texte de façon perceptible. */
  padding-left: 5px;
}
.rte .cm-line {
  padding-block: 3px;
}

/* --- (4) Barre de requalification --- */
.rte .cm-retag-toolbar {
  /* Plus de `position: sticky` propre à cette barre : elle est désormais montée DANS
     `.rte__bar` (opts.toolbarHost, cf. cm-editor.js et <script> plus haut), le seul
     bandeau collant de l'écran de correction — fusion des deux bandeaux séparés qui
     laissaient une fente de texte défiler entre eux. `.rte__bar`
     porte déjà `top`/`z-index`/`background` pour tout son contenu ; les répéter ici
     serait sans effet (position statique) et risquerait de survivre à un futur
     changement du `top` du wrapper sans qu'on s'en aperçoive. Bordure/ombre/rayon et
     marge inférieure retirés avec le même raisonnement : c'étaient les habillages
     d'une carte AUTONOME posée sous une autre barre ; dans `.rte__bar`, c'est un
     simple sous-bloc d'un flex column, son fond vient du conteneur.
     `--sp-1` (pas `--sp-2`) : retour terrain — à 360px d'écran,
     les 8px de padding de chaque côté (16px au total) étaient exactement ce qui
     manquait pour tenir « Modifier le texte » + les 6 puces sur une seule ligne
     (mesuré : 3px de trop avec --sp-2, tient avec 4-5px de marge avec --sp-1). */
  padding: var(--sp-1);
  /* Retour device : la barre doit tenir sur 2 lignes SANS tronquer les libellés des menus.
     La grille à colonnes égales donnait 6 cases identiques → les menus (Compteur/Section/
     Aide-mémoire) étaient coupés. On revient donc à un flex qui passe à la ligne, avec des
     boutons-icônes COMPACTS (44px) et des menus dimensionnés à leur LIBELLÉ complet
     (largeur fixe par menu, ci-dessous) — au lieu de leur option la plus large qui les
     rendait trop larges. Résultat mesuré (Playwright 360 + 412px) : 2 lignes, rien de coupé. */
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-1);
}

/* Mode texte (`.rte__bar--compact`, posée par
   ReaderTextEditor.vue quand codeMode est vrai) : la barre passe de 2 lignes à 1
   seule, défilante horizontalement. Justification du PÉRIMÈTRE (texte seulement,
   pas vue enrichie) : le clavier virtuel n'est ouvert QUE dans ce mode — c'est le
   seul moment où la place manque vraiment ; en vue enrichie on classe des lignes,
   la barre reste l'outil principal et reste entière. Spécificité : 3 classes ici
   (.rte .rte__bar--compact .cm-retag-toolbar) contre 2 pour la règle de base
   ci-dessus (.rte .cm-retag-toolbar) — cette règle l'emporte quel que soit l'ordre
   source, `flex-wrap` et `overflow-x` n'ont donc pas besoin d'être placés après
   quoi que ce soit (l'ex-règle `.cm-retag-break`, sensible à l'ordre source, a été
   retirée — revue du 2026-08-22). */
.rte .rte__bar--compact .cm-retag-toolbar {
  flex-wrap: nowrap;
  overflow-x: auto;
}

/* Indice de défilement FONCTIONNEL, pas décoratif : un défilement horizontal
   sans indice est pire qu'une barre masquée — masquer cachait la barre derrière un
   bouton bien visible (« Vue enrichie »), un défilement muet la cache derrière rien.
   Il doit n'apparaître QUE s'il reste réellement du contenu à droite.
   Deux techniques essayées et REJETÉES avant la solution retenue plus bas, chacune
   vérifiée par mesure réelle (Chromium via Playwright, pas seulement lue dans une
   spec) :
   1. `background` à deux couches (`background-attachment: local` / `scroll`, motif
      « scroll shadows » classique) directement sur `.cm-retag-toolbar` — mesurée
      invisible : le `background` d'un élément peint TOUJOURS derrière ses enfants en
      flux normal, or ici les enfants (boutons/select) sont OPAQUES et couvrent
      quasiment toute la largeur (`gap` de quelques px pour seul interstice) —
      capture Playwright à l'appui (scratchpad, bg-scroll0.png) : le dernier contrôle
      partiellement visible est coupé NET, aucun dégradé visible, contrairement à la
      même capture avec `mask-image` (mask-scroll0.png) où le texte du contrôle
      s'estompe bien. Un `mask` (contrairement à un `background`) s'applique à la
      sortie COMPOSITÉE de tout l'élément (enfants compris), donc reste visible
      par-dessus des boutons opaques — c'est la vraie raison de préférer
      `mask-image` à un `background` ici, pas seulement « connaître la couleur de
      fond exacte ».
   2. `mask-attachment: local` / `scroll` (même motif, en variante `mask`) — mesurée
      NON FONCTIONNELLE dans le Chromium testé (151.0.7922.34, le moteur de la
      WebView Android ciblée) : `getComputedStyle(...).maskAttachment` renvoie
      `undefined` (propriété non reconnue) et le rendu obtenu avec
      `mask-composite: intersect` est franchement cassé (capture
      maskattach-scroll0.png : la barre entière disparaît, un seul libellé reste
      lisible au hasard). Pas un simple défaut esthétique, une non-implémentation.
   Retenue : `mask-image` conditionné par `animation-timeline: scroll()` + `@property`
   (bloc `@supports` ci-dessous). */
.rte .rte__bar--compact .cm-retag-toolbar {
  mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent);
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent);
}

/* @supports : sans garde, sur une WebView qui NE reconnaît PAS
   `animation-timeline: scroll()`, cette seule déclaration serait abandonnée alors
   que `animation` resterait valide et jouerait DANS LE TEMPS (1s) contre la timeline
   document — le masque deviendrait opaque une seconde après l'ouverture du mode
   texte, sans plus aucun indice de défilement. La garde isole toute la surcharge
   animée derrière la fonctionnalité exacte dont elle dépend ; en son absence, la
   règle de base ci-dessus (dégradé statique permanent) reste seule active — jamais
   « pas de masque du tout ». */
@supports (animation-timeline: scroll(self inline)) {
  /* `initial-value` reste à 0% (fondu peint) et NON à 100% comme la valeur déclarée
     ci-dessous : elle ne sert que de filet si la déclaration devenait invalide, cas qui
     ne se produit pas (la règle déclare toujours `--fade-a`). Lui garder le sens prudent
     — un fondu de trop plutôt qu'un fondu manquant alors que deux contrôles sont hors
     écran — ne coûte rien et couvre le seul scénario où elle compterait. */
  @property --fade-a {
    syntax: '<percentage>';
    inherits: false;
    initial-value: 0%;
  }
  /* `from` EXPLICITE, obligatoire : sans lui, l'image-clé de départ implicite reprend la
     valeur DÉCLARÉE de `--fade-a` sur l'élément — devenue 100% juste en dessous — et
     l'animation ne ferait plus rien du tout (100% → 100%), donc plus aucun indice de
     défilement même quand la barre déborde vraiment. */
  @keyframes rte-toolbar-defade {
    from {
      --fade-a: 0%;
    }
    to {
      --fade-a: 100%;
    }
  }
  .rte .rte__bar--compact .cm-retag-toolbar {
    /* Valeur DÉCLARÉE = 100%, c'est-à-dire AUCUN fondu — l'inverse de ce qu'on lit
       naïvement. Elle ne gouverne que le cas où l'animation ne s'applique PAS : une
       timeline `scroll(self inline)` est INACTIVE quand l'élément n'a rien à défiler dans
       cet axe, et `--fade-a` retombe alors sur cette valeur déclarée. Avec 0% (l'état
       d'avant), un écran assez large pour que les 6 contrôles tiennent peignait quand
       même le fondu : un indice qui promet du contenu à droite là où il n'y en a pas —
       exactement le faux indice que cette tâche existe pour supprimer, déplacé d'un cas
       à l'autre. Mesuré au banc Playwright (balayage 360 → 1000 px par pas de 20 px,
       mode texte réel) : la barre cesse de déborder à 640 px de viewport (clientWidth
       608 = scrollWidth 608 ; à 620 px, 588 < 591, elle déborde encore), et au-dessus
       l'ancien code laissait `--fade-a` à 0% avec un `mask-image` calculé finissant sur
       `rgba(0, 0, 0, 0)`.
       Pourquoi PAS un seuil de largeur (`@media`) : la condition réelle est le
       DÉBORDEMENT, pas une largeur. 640 px n'est pas la charnière 599.98px déjà connue
       du fichier, ce serait donc un seuil neuf et approximatif (il dépend des métriques
       de police et du rembourrage du conteneur, tous deux susceptibles de bouger), qui
       obligerait en plus à déplacer le masque de base dans une media query. Ici le
       moteur teste lui-même la seule condition qui compte, à toute largeur.
       Mesure de la version retenue, scrollLeft remis à 0 à chaque largeur : à 360, 393,
       500, 600 et 620 px (barre débordante) le fondu est bien peint au début et au milieu
       de la course puis s'efface au bout ; à 640, 700, 800 et 1000 px (barre non
       débordante) `--fade-a` vaut 100% et le masque calculé finit sur `rgb(0, 0, 0)` —
       plus aucun fondu. */
    --fade-a: 100%;
    mask-image: linear-gradient(to right, #000 calc(100% - 24px), rgb(0 0 0 / var(--fade-a)));
    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 24px), rgb(0 0 0 / var(--fade-a)));
    animation: rte-toolbar-defade 1s linear both;
    animation-timeline: scroll(self inline);
    animation-range: 85% 100%;
  }
}

/* --- (5) Boutons/menus Bento+Clay, cible tactile ≥ 44px --- */
/* Compteur est passé de <select> à une puce 44×44 (dernier
   <select> de cette barre, cf. cm-editor.js) : plus aucune règle ci-dessous n'a besoin
   de cibler `select` dans `.cm-retag-toolbar`, les 6 contrôles sont désormais tous des
   `button`. Les règles `select`/`select.cm-retag-counter` (padding-right, largeur fixe
   108px) qui vivaient ici sont retirées — CSS mort, aucun sélecteur ne matchait plus. */
.rte .cm-retag-toolbar button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* Hauteur = cible tactile ≥ 44 px (inchangée). C'est la LARGEUR qui commande le
     nombre de lignes → padding horizontal + police réduits (retour device : la barre
     tenait sur 3 lignes). Les 3 boutons (Étape/Note/Texte) portaient un libellé en
     icône seule (aria-label/title) — un ajout leur donne un libellé
     texte VISIBLE (empilé sous l'icône, cf. .cm-retag-btn-label ci-dessous) : le
     `title` HTML ne s'affiche jamais au tactile, donc l'icône seule n'était
     découvrable qu'en cliquant ou via l'aide repliée, contrairement aux puces à
     popover voisines qui gardent leur libellé en permanence. */
  min-height: 44px;
  padding: var(--sp-1) var(--sp-2);
  border: 1.5px solid var(--line);
  border-radius: var(--r-md);
  background: var(--surface);
  font-family: var(--font-ui);
  font-size: 14px;
  font-weight: 600;
  box-shadow: var(--clay-sm);
  transition: background var(--motion-fast), box-shadow var(--motion-fast), color var(--motion-fast);
  /* Ancre le repère `::after` de `.is-active` (soulignement) — sans ça il se
     positionnerait par rapport à `.cm-retag-toolbar`, pas au bouton. */
  position: relative;
}
.rte .cm-retag-toolbar button:active {
  box-shadow: var(--clay-press);
}
/* Les contrôles ne rétrécissent PAS (flex-shrink: 0) : chacun garde sa largeur et la barre
   passe à la ligne proprement (2 lignes). */
.rte .cm-retag-toolbar button {
  flex: 0 0 auto;
}
/* La largeur 44px des puces à popover (Section/Aide-mémoire/Compteur, cf.
   retagMenuBtn/cm-editor.js) vient de la règle générale `button.cm-retag-btn` plus bas
   (padding: 0; width: 44px), commune avec Étape/Note/Texte — rien à ajouter ici pour
   elles ; aucune largeur fixe par contrôle n'est plus nécessaire depuis que le dernier
   <select> (Compteur, 108px) a disparu. */

/* Libellé texte visible des boutons Étape/Note/Texte
   (span.cm-retag-btn-label, cf. retagBtn dans cm-editor.js), EMPILÉ sous l'icône
   plutôt qu'à côté : un libellé côte à côte ajouterait ~30-35px de LARGEUR par
   bouton (police + lettrage), soit ~60-70px sur la ligne qui en porte deux (Étape
   + Note) — le budget mesuré à 360px par cm-editor-toolbar-order.spec.js
   (44+44+150 / 108+100+44, gap 4px compris, ~320px utiles) ne l'absorbe pas sans
   repasser à 3 lignes. Empilé, le bouton reste un CARRÉ 44×44px INCHANGÉ (mesuré
   Playwright à 360px) : la règle `.cm-retag-toolbar button.cm-retag-btn`
   plus bas (`padding: 0; width: 44px`, spécificité 0,3,1 — élément + 3 classes)
   l'emporte sur toute déclaration posée ICI (spécificité 0,3,0 — 3 classes) pour
   padding/largeur, et `min-height: 44px` (règle générale bouton ci-dessus)
   fixe la hauteur ; l'icône (20px) + le libellé (~10px à 9px de police depuis la
   revue, cf. règle `.cm-retag-btn-label` plus bas, 1px de gap) totalisent
   ~31px de contenu, sous les 44px disponibles — rien ne déborde,
   AUCUN compromis de hauteur. Seul `flex-direction`/`gap`/`line-height` changent
   ici l'axe d'empilement icône/libellé (propriétés non couvertes par la règle
   44px, donc bien appliquées) : ne PAS y ajouter `padding`/`padding-block`/`width`,
   ce serait une déclaration morte face à la spécificité supérieure de la règle
   44px plus bas (relecture : un premier essai posait `padding-block: 4px`
   ici sans aucun effet observable, corrigé). */
.rte .cm-retag-toolbar .cm-retag-btn {
  flex-direction: column;
  gap: 1px;
  line-height: 1.15;
}
/* font-size 9px (abaissé de 10px, revue du 2026-08-22) : mesuré
   Playwright réel à 360px, les puces Section/Aide-mémoire/Compteur (retagMenuBtn) ne
   contenaient PAS toujours leur libellé dans leur carré 44px à 10px — ES « Referencia »
   débordait de 1,5px, et EN « Reference »/DE « Abschnitt » tenaient à 0px de marge
   PILE (aucune tolérance au moindre écart de rendu de police). Testé avant de
   choisir : un raccourci i18n par langue (même patron que labels.referenceChip pour
   « Mémoire » en FR) aurait fallu le refaire pour EN/DE en plus d'ES (déjà à 0px de
   marge, donc tout aussi fragiles) — un ajustement CSS unique couvre les 4 langues à
   la fois sans dupliquer de traduction supplémentaire. Remesuré à 9px : marge
   minimale -1,00px (ES Referencia), toutes les autres combinaisons langue×puce entre
   -1 et -9,5px — confortable partout, plus aucun cas à 0px de marge. Lisibilité
   vérifiée par capture (poids 600 conservé) : les 4 langues restent nettes à cette
   taille. cf. tests/e2e/correction-editor-visual.spec.js pour la mesure de
   containment étendue à Section/Aide-mémoire (elle ne portait auparavant que sur
   Compteur). */
.rte .cm-retag-toolbar .cm-retag-btn-label {
  font-size: 9px;
  font-weight: 600;
}

/* `.cm-retag-break` (coupure de ligne forcée après le 3e contrôle) RETIRÉE (revue
   du 2026-08-22) : elle datait d'une époque où Compteur était encore
   un <select> large (108px) qui ne tenait pas à côté des 5 autres contrôles sous
   600px. Section/Aide-mémoire/Compteur ont depuis migré en puces
   44×44px identiques aux autres — les 6 contrôles (6×44 + 5 gaps ≈ 284px) tiennent
   désormais sur UNE SEULE ligne, y compris à 360/393px (mesuré Playwright réel,
   patron simple et patron avec indicateur d'aide-mémoire actif : aucun débordement,
   aucun chevauchement). Plus rien ne justifiait de forcer une coupure devenue
   inutile.
*/

/* P4 — boutons Étape/Note/Texte : carrés 44px (compacts), icône centrée, avec
   désormais un libellé texte visible empilé sous l'icône (cf.
   règle `.cm-retag-toolbar .cm-retag-btn` plus haut, flex-direction: column) SANS
   toucher au carré 44×44 fixé ici : `padding: 0`/`width: 44px` restent la source
   de vérité de ces deux propriétés (spécificité 0,3,1, l'emporte sur la règle plus
   haut qui n'y touche plus) — ne pas les redéclarer plus haut. */
.rte .cm-retag-toolbar button.cm-retag-btn {
  padding: 0;
  width: 44px;
}
.rte .cm-retag-toolbar button.cm-retag-btn svg {
  display: block;
}

/* Couleur propre à chaque balisage AU REPOS (texte + bordure). `:not(.is-active)`
   pour ne jamais entrer en conflit avec le texte blanc de l'état actif. */
.rte .cm-retag-toolbar button[data-retag='rang']:not(.is-active) {
  color: var(--mdc-rang);
  border-color: var(--mdc-rang);
}
.rte .cm-retag-toolbar .cm-retag-counter:not(.is-active) {
  color: var(--mdc-compteur);
  border-color: var(--mdc-compteur);
}
.rte .cm-retag-toolbar button[data-retag='note']:not(.is-active) {
  color: var(--mdc-note);
  border-color: var(--mdc-note);
}
.rte .cm-retag-toolbar .cm-retag-section:not(.is-active) {
  color: var(--mdc-section);
  border-color: var(--mdc-section);
}
.rte .cm-retag-toolbar button[data-retag='texte']:not(.is-active) {
  color: var(--ink-55);
  border-color: var(--ink-25);
}
.rte .cm-retag-toolbar .cm-retag-ref:not(.is-active) {
  color: var(--mdc-reference);
  border-color: var(--mdc-reference);
}

/* --- (3) État actif façon Word : remplissage plein de la couleur de la
   catégorie, texte contrasté — confirme visuellement que le balisage a pris sur
   la ligne du curseur. var(--on-solid) plutôt que #fff : les fonds --mdc-*
   s'éclaircissent en sombre (cf. bloc ci-dessus), un texte blanc y deviendrait
   illisible ; --on-solid reste blanc en clair et bascule vers un texte sombre
   en sombre. (Pas var(--on-accent) : depuis le 08/09 il devient sombre dans la
   bande chaude claire, alors que ces fonds mdc ne suivent pas la teinte.) --- */
.rte .cm-retag-toolbar .is-active {
  color: var(--on-solid);
  font-weight: 700;
  /* Relief + soulignement : signal de FORME (pas seulement de teinte), pour
     que l'état actif reste repérable même sur `texte` ci-dessous, qui n'a pas
     de couleur de catégorie à plein remplissage. PAS de `transform`
     (translateY envisagé, écarté) : les tests de mise en page mesurent
     `getBoundingClientRect().y` pour vérifier que les 6 contrôles restent sur
     une seule ligne (cf. correction-editor-visual.spec.js, fonction `rows`) —
     un décalage vertical, même de 1px, casse cette mesure ET produirait un
     vrai crantage visuel du bouton actif dans la barre. `box-shadow` seul
     reste dans les 4px de padding de `.cm-retag-toolbar` (--sp-1) sans
     jamais se faire rogner par l'`overflow-x: auto` du mode compact (cf.
     règle plus haut). Le trait est un `::after` interne à la case 44×44
     (jamais hors boîte), donc aucun risque de rognage non plus. */
  box-shadow: var(--e-1);
}
.rte .cm-retag-toolbar .is-active::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 3px;
  height: 2.5px;
  border-radius: 2px;
  background: currentColor;
}
.rte .cm-retag-toolbar button[data-retag='rang'].is-active {
  background: var(--mdc-rang);
  border-color: var(--mdc-rang);
}
.rte .cm-retag-toolbar .cm-retag-counter.is-active {
  background: var(--mdc-compteur);
  border-color: var(--mdc-compteur);
}
.rte .cm-retag-toolbar button[data-retag='note'].is-active {
  background: var(--mdc-note);
  border-color: var(--mdc-note);
}
.rte .cm-retag-toolbar .cm-retag-section.is-active {
  background: var(--mdc-section);
  border-color: var(--mdc-section);
}
/* `texte` n'a pas de teinte de catégorie (--mdc-texte: transparent, cf. bloc
   plus haut). Deux essais plus timides ont été jugés encore trop discrets sur
   le terrain (Pixel 7) : `--ink-55` translucide d'abord (quasi invisible),
   puis `--surface-lin` (retour Julien : « le fond de Texte, c'est le moins
   visible de tous » — le delta de luminosité avec `--surface` était trop
   faible pour se voir à côté des remplissages pleins et saturés des autres
   catégories). Ici, plein contraste : `--ink` opaque en fond, comme `rang`
   (--mdc-rang: var(--ink)) juste au-dessus — les deux catégories SANS teinte
   de marque partagent le même traitement « négatif », sans que ce soit gênant
   puisqu'un seul contrôle est actif à la fois (une ligne a un seul type).
   `color` n'a plus besoin d'être redéclaré : la règle commune `.is-active`
   (var(--on-solid)) refonctionne, car `--ink` redevient une vraie couleur de
   fond pleine — exactement le cas qu'elle couvre déjà pour `rang`. */
.rte .cm-retag-toolbar button[data-retag='texte'].is-active {
  background: var(--ink);
  border-color: var(--ink);
}
.rte .cm-retag-toolbar .cm-retag-ref.is-active {
  background: var(--mdc-reference);
  border-color: var(--mdc-reference);
}

/* Indicateur « à côté » de la ligne courante (type d'aide-mémoire, kind de section) —
   habillé en petite puce (même famille visuelle que `.corr-chip`, CorrectionView.vue,
   et le chip du Compteur juste ci-dessous) plutôt qu'en texte italique nu : un simple
   changement de casse/style ne suffisait pas à le rendre VISIBLE au premier coup d'œil
   (retour terrain : « le type de la section est invisible sauf si je clique »). */
.rte .cm-retag-ref-type {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 4px 10px;
  border-radius: var(--r-pill);
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink-70);
  font-size: 13px;
  font-weight: 600;
}
.rte .cm-retag-ref-type:empty {
  display: none;
}

/* Puce compteur + case à cocher visuelle (widgets CM6, cf. cm-editor.js) —
   n'avaient pas non plus de style porté depuis le banc.
   `line-height`/`padding` (après revue) : mesurée à 27px de haut
   (héritait le line-height 1.75 de `.cm-content`, réglé pour la lecture du corps de
   texte, jamais pensé pour une puce). Un texte inline dans une phrase reste hors du
   plancher WCAG 44px (2.5.5/2.5.8, exception explicite « target in a sentence or
   block of text ») — forcer 44px produirait une puce absurdement haute au milieu
   d'une ligne de patron. `line-height: 1.3` décorrélé du corps + padding relevé :
   confort tactile amélioré (~32px) sans casser la lecture de la ligne. */
.rte .cm-counter-chip {
  display: inline-block;
  line-height: 1.3;
  padding: 0.35em 0.55em;
  margin-right: 0.3em;
  cursor: pointer;
  border-radius: var(--r-pill);
  background: rgba(122, 79, 158, 0.14);
  color: var(--mdc-compteur);
  font-weight: 600;
  font-size: 0.9em;
  border: 1px solid rgba(122, 79, 158, 0.35);
}
/* Puce de kind de section (widget CM6, cf. SectionKindWidget/cm-editor.js) — même
   patron visuel que `.cm-counter-chip` juste au-dessus (même famille de puce
   cliquable insérée dans le texte). Bordure/fond en `--mdc-section` (accent de la
   ligne et bouton Section de la barre) MAIS texte en `--sage-deep-strong`, pas
   `--mdc-section` : après revue — mesuré 4.01:1 sur le fond
   composité à 14% d'alpha, sous les 4.5:1 requis pour du texte 13,6px. Même token
   que `.corr-chip--on` (CorrectionView.vue) pour un défaut identique sur un dégradé
   sage voisin — remesuré 5.30:1 avec ce token. */
.rte .cm-section-kind-chip {
  display: inline-block;
  line-height: 1.3;
  padding: 0.35em 0.55em;
  margin-left: 0.4em;
  cursor: pointer;
  border-radius: var(--r-pill);
  background: rgba(95, 115, 88, 0.14);
  color: var(--sage-deep-strong);
  font-weight: 600;
  font-size: 0.85em;
  border: 1px solid rgba(95, 115, 88, 0.35);
}
.rte .cm-row-check {
  display: inline-block;
  width: 0.9em;
  height: 0.9em;
  margin-right: 0.35em;
  border: 1.5px solid var(--mdc-rang);
  border-radius: 2px;
  vertical-align: middle;
}
.rte .cm-image-placeholder {
  color: var(--mdc-image);
  font-style: italic;
}
.rte .cm-image-thumb {
  display: inline-block;
  max-width: 100%;
  height: 120px;
  object-fit: contain;
  border: 1px solid rgba(47, 102, 144, 0.35);
  border-radius: var(--r-sm);
  vertical-align: middle;
}

/* Cadre de l'éditeur CM6 lui-même (pas de style porté non plus). */
.rte .cm-editor {
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--tile);
}
.rte .cm-editor.cm-focused {
  outline: 2px solid var(--brand-deep);
  outline-offset: 0;
}

/* Popover de menu générique (fondations — cf. openMenuPopover,
   cm-editor.js) : le CSS a été DÉPLACÉ dans cm-editor.js (ensureMenuPopoverStyles,
   revue du 2026-08-21/22) — il vivait auparavant ICI, dans un
   composant Vue que tools/mdedit n'importe jamais (ce banc monte l'éditeur via
   createCmEditor directement, sans le reste de l'app), donc ce popover s'y ouvrait
   sans aucun style et surtout sans `.cm-menu-popover-scrim { position: fixed; inset:
   0 }` : le clic hors popover n'y fermait rien. Même remède qu'`.cm-numprompt`
   (déjà injecté depuis cm-editor.js via ensureNumPromptStyles) : un module JS partagé
   par l'app ET par tools/mdedit bénéficie aux deux à la fois, une règle Vue scopée à
   ce composant ne peut bénéficier qu'à l'app. */
</style>
