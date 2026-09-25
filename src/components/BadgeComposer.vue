<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useProjectsStore } from '@/stores/projects'
import { useCropperStore } from '@/stores/cropper'
import { renderBadge, computeBadgeGeometry, createBadgeCanvas, statValue, buildRawStatLines, yarnLabel, countGroups } from '@/utils/badge-render'
import { useEffectiveTheme } from '@/theme/useEffectiveTheme'
import { useSettingsStore } from '@/stores/settings'
import { resizeDataUrl } from '@/utils/image-resize'
import { DEMO_PHOTOS } from '@/utils/badge-demo'
import { lockBodyScroll, unlockBodyScroll } from '@/utils/body-scroll-lock'
import { trapTabFocus, useDialogFocusReturn } from '@/composables/useFocusTrap'
import AppIcon from '@/components/AppIcon.vue'
import { LANGUAGES } from '@/constants/languages'
import ColorPickerDialog from '@/components/ColorPickerDialog.vue'
import BadgePhotoPicker from '@/components/BadgePhotoPicker.vue'
import { COLOR_PALETTE } from '@/constants/swatch'
import { resolveCover } from '@/utils/project-cover'
import { shareImageDataUrl } from '@/utils/share-badge'
import { debounce } from '@/utils/debounce'
import { clamp } from '@/utils/badge-calendar'
import { isProjectVegan } from '@/utils/yarn-usage'

// Configuration + génération du badge d'un projet. Monté localement (pas un store singleton
// comme useCropperStore) : contrairement au recadreur, générique, ce composant a besoin du
// projet entier (stats déjà agrégées par l'onglet Stats parent, photos, technique) et n'a
// qu'un seul point d'entrée dans l'app — spec 2026-09-16, §3.
const props = defineProps({
  project: { type: Object, required: true },
  stats: { type: Object, required: true },
  yarnUsage: { type: Array, default: () => [] },
})
const emit = defineEmits(['saved', 'close'])

const { t, locale } = useI18n()
const projectsStore = useProjectsStore()
const cropper = useCropperStore()
const settings = useSettingsStore()
const effectiveTheme = useEffectiveTheme()

const TEMPLATE_KEYS = ['vertical', 'horizontal', 'minimal', 'double']
const TEMPLATE_ICON = { vertical: 'badgeVertical', horizontal: 'badgeHorizontal', minimal: 'badgeMinimal', double: 'badgeDouble' }
const STAT_KEYS = ['totalTime', 'startedOn', 'yarns', 'progress', 'bestStreak', 'sessionsCount']

// Défaut du gabarit ET de la photo (étape Photo) : la photo de couverture du projet si elle
// existe (résolue une seule fois, à l'ouverture — cf. resolveCover). Avec couverture : gabarit
// Vertical, couverture déjà en place. Sans couverture : Texte seul (pas de photoSlot), le seul
// gabarit qui a un sens sans image disponible.
const initialCover = resolveCover(props.project)
const templateKey = ref(initialCover ? 'vertical' : 'minimal')
// Couleur RÉELLE du badge (refonte 16/09, remplace l'ancienne teinte seule — cf.
// commentaire d'en-tête de badge-render.js) : chaîne `hsl(h s% l%)` complète, appliquée
// telle quelle au dégradé. Défaut sur l'accent courant de l'app (même format que le repli de
// ColorPickerDialog ailleurs dans l'app : s=70/l=50 par défaut).
const badgeColor = ref(`hsl(${settings.effectiveAccentHue(effectiveTheme.value)} 70% 50%)`)
const colorPickerOpen = ref(false)
function pickColor(hsl) {
  badgeColor.value = hsl
  // PAS de settings.rememberBadgeColor() ici : l'historique ne retient que les couleurs
  // RÉELLEMENT utilisées pour un badge généré (appelé dans generate() ci-dessous), pas
  // chaque pastille survolée en cours d'essai.
}
function onPickCustomColor(hslStr) {
  pickColor(hslStr)
}
// Avancement (Task « badge pourcentage », 20/09) : disponible seulement pour un projet NON
// terminé (son statut suffit à exprimer l'avancement, cf. l'intent) ET quand `rowsProgress` est
// calculable (un patron est lié ET son lecteur — patternToReader, src/utils/reader.js —
// contient au moins une étape cochable, cf. computeReaderRowsProgress dans project-stats.js) —
// même garde que `yarns` ci-dessous, entièrement absente de la liste plutôt que présente mais
// décochée.
const progressAvailable = props.project.status !== 'done' && !!props.stats?.rowsProgress

// `yarns` (laines liées) commence décochée si aucune laine n'est liée au projet — un badge
// qui afficherait une ligne vide par défaut n'apporte rien (même logique que l'ancien
// `ballsUsed`, retour Julien, test réel Pixel). Les autres statistiques restent toujours
// cochées par défaut, quelle que soit leur valeur (sauf `progress`, cf. `progressAvailable`
// ci-dessus : absente de STAT_KEYS filtré plutôt que décochée quand non calculable).
const selectedStats = ref(STAT_KEYS.filter((k) => (k !== 'yarns' || props.yarnUsage.length > 0) && (k !== 'progress' || progressAvailable)))
const includeTechnique = ref(!!props.project.technique)
// La technique n'est PLUS jamais une ligne de stats, pour aucun des 4 gabarits (chantier
// « badge corrections typo/zoom » 19/09, Task 4 : `renderBadge`, badge-render.js, filtre
// désormais `'technique'` de `statKeys` pour TOUS les gabarits — Task 3 — et la dessine à
// part, en pastille sur la rangée du titre, pilotée par `includeTechnique`). Vertical/
// Horizontal avaient déjà ce comportement depuis la Task 2 (chantier « badge cartouche
// condensé » 18/09c) ; minimal/double prépendaient encore `'technique'` à `selectedStats`
// jusqu'à ce chantier — `selectedStats` (jamais `'technique'`) est désormais la liste de
// stats transmise à `renderBadge` pour les 4 gabarits, sans indirection supplémentaire. La
// pastille Infos « Technique » garde son comportement de case à cocher (elle pilote
// `includeTechnique`, transmis tel quel aux DEUX appels à `renderBadge` de ce fichier — cf.
// leurs commentaires) : `renderBadge` ne dessine la pastille que si la case est cochée ET la
// technique renseignée.
const photoDataUrl = ref(initialCover || null) // déjà recadrée au ratio choisi (slot 1)
const photoDataUrl2 = ref(null) // gabarit 'double' uniquement, slot 2
// Ratio RÉELLEMENT utilisé pour chaque photo (refonte « pop-up photo », 17/09) : choisi au
// moment du recadrage (BadgePhotoPicker), libre et indépendant du gabarit du badge — plus un
// mode partagé par onglet. Défaut carré tant qu'aucune photo n'a été recadrée par
// l'utilisatrice (couverture auto-remplie ci-dessus, jamais recadrée explicitement).
const photoAspect = ref(1)
const photoAspect2 = ref(1)
const activeSlot = ref(1) // slot ciblé (1 ou 2) par le prochain choix de photo
const previewFixSlot = ref(null) // 1 | 2 | null — slot survolé par le bouton « Modifier » de la prévisu
const badgeText = ref('') // ligne libre optionnelle (étape Infos), emojis compris
const sharing = ref(false)
const photoPickerOpen = ref(false)
const resultUrl = ref(null)
// Copie de travail des photos du projet : chaque génération REMPLACE l'entrée précédente de
// CETTE session (index mémorisé dans `generatedPhotoIndex`) au lieu d'en empiler une nouvelle
// — l'utilisatrice doit pouvoir modifier le badge après une première génération sans multiplier
// les doublons dans la galerie (retour direct, 16/09). Copie locale plutôt que relire
// `props.project.photos` à chaque appel : ce prop n'est pas garanti à jour entre deux
// générations dans la même ouverture de la feuille (le parent ne le rafraîchit pas toujours).
const workingPhotos = ref([...(props.project.photos || [])])
const generatedPhotoIndex = ref(null)
// Langue du TEXTE du badge : pré-remplie sur la langue active de l'app, modifiable pour
// CETTE génération seulement — ne persiste jamais dans settings.locale (spec 2026-09-16b, §4).
const badgeLocale = ref(locale.value)

// Valeurs RÉELLES du projet affichées sur les pastilles de l'onglet Infos — mêmes données que
// celles utilisées par la prévisu canevas (`updatePreview` plus bas : stats RÉELLES depuis le
// 17/09, la démo ne sert plus qu'au(x) emplacement(s) photo vide(s), cf. `demoPhotoForTemplate`).
// Recalculées à chaque changement de langue du badge (`badgeLocale`), pas de l'app (`locale`) :
// le texte du badge, comme celui des pastilles, suit la langue choisie DANS l'assistant, cf.
// commentaire ci-dessus sur `badgeLocale`.
// Pastilles génériques de l'onglet Infos : `yarns` en est exclue (pastille dédiée plus bas,
// sa valeur est une liste), `startedOn` disparaît pour un projet SANS aucune date — sinon
// une pastille vide, invisible mais cliquable (cf. `startedOnParts`, badge-render.js, qui ne
// produit alors aucune ligne non plus) — et `progress` disparaît selon `progressAvailable`
// (cf. son commentaire, ci-dessus). Calculé une fois plutôt qu'à chaque rendu du template.
const genericPillKeys = computed(() =>
  STAT_KEYS.filter(
    (k) => k !== 'yarns'
      && (k !== 'startedOn' || !!(props.project.startedAt || props.project.finishedAt))
      && (k !== 'progress' || progressAvailable),
  ),
)
const statValueTexts = computed(() => {
  const out = {}
  for (const key of genericPillKeys.value) out[key] = statValue(key, props.stats, t, badgeLocale.value, props.project)
  return out
})
function statAriaLabel(key) {
  return `${t(`project.stats.${key}`)} : ${statValueTexts.value[key]}`
}
const techniqueValueText = computed(() => statValue('technique', props.stats, t, badgeLocale.value, props.project))
const techniqueAriaLabel = computed(() => `${t('project.stats.technique')} : ${techniqueValueText.value}`)
// Pastille dédiée 'yarns' (Task 6) : même patron que la Technique ci-dessus (aria-label
// « Libellé : valeur »), traitée à part de la boucle générique `statValueTexts` car sa
// valeur est une liste (une entrée par laine), pas une chaîne unique comme les autres clés.
// `yarnLabel` (badge-render.js) : même construction que la ligne dessinée sur le badge,
// jamais dupliquée localement.
const yarnsSummaryText = computed(() => props.yarnUsage.map((u) => yarnLabel(u.yarn)).join(', '))
const yarnsAriaLabel = computed(() => `${t('project.stats.yarns')} : ${yarnsSummaryText.value}`)

// Carte calendaire du projet (revue 17/09) : optionnelle, visible seulement si le projet a
// des données de grille (`stats.grid.columns` non vide — un projet sans aucune session n'en
// a pas). `props.stats` porte déjà `grid` depuis `ProjectDetailView.vue` (aggregateProjectStats),
// aucune nouvelle prop nécessaire. Cochée par défaut dès que ces données existent (retour
// Julien, test réel Pixel) : `hasCalendarData.value` lu une seule fois à la construction, même
// principe que `initialCover`/`photoDataUrl` plus haut dans ce fichier.
const hasCalendarData = computed(() => !!props.stats?.grid?.columns?.length)
const includeCalendar = ref(hasCalendarData.value)

// Icône vegan (Task 5) : `isProjectVegan` attend le tableau de laines DU STORE (non
// filtrées, elle filtre elle-même par appartenance) — ici on lui repasse les `yarn` déjà
// filtrées par `projectYarnUsage` côté parent, ce qui reste correct (elle re-filtre sur un
// sous-ensemble déjà rattaché, résultat identique) puisque `projectYarnUsage` exclut déjà
// les `balls <= 0` (Task 1).
const isVegan = computed(() => isProjectVegan(props.project.id, props.yarnUsage.map((u) => u.yarn)))

// Assistant par étapes (spec 2026-09-16b, §4 ; onglet Photo supprimé le 17/09 — modifier une
// photo se fait désormais directement depuis la prévisu, cf. onFixClick). Plus d'étape
// conditionnelle : `steps` est une constante, `STEP_KEYS` lui-même suffit.
const STEP_KEYS = ['format', 'color', 'infos']
const steps = STEP_KEYS
const stepIndex = ref(0)
const currentStep = computed(() => steps[stepIndex.value])
function goToStep(i) {
  stepIndex.value = i
}

// Tiroir bas coulissant (piste 5 validée 18/09) : REPLIÉ par défaut à l'ouverture, pour que
// la prévisu plein écran soit ce que l'utilisatrice voit d'abord — bascule vers l'état DÉPLIÉ
// au tap sur la poignée OU au glisser (retour Julien, 18/09 soir : le tap seul ne suffisait
// pas). Le tiroir grandit avec son contenu (`height: auto`), plafonné par `max-height` — les
// deux seuils ci-dessous sont le plancher/plafond RÉELS en CSS (`.bdg__drawer`/
// `.bdg__drawer--expanded`, doublet vh/dvh), dupliqués ici UNIQUEMENT pour borner le geste de
// glissement (qui doit suivre le doigt en direct, sans attendre un rendu Vue) — à garder
// synchronisés si ces seuils CSS changent.
const drawerExpanded = ref(false)
function drawerMinHeight() {
  return Math.max(160, window.innerHeight * 0.22)
}
function drawerMaxHeight() {
  return Math.max(420, window.innerHeight * 0.68)
}
// Repositionne la prévisu après un changement de hauteur du tiroir (bascule tap OU fin de
// glisser) : mesure immédiate (imprécise pendant les 220ms de transition CSS — `clientHeight`
// reste sur l'ancienne valeur tant que le layout n'a pas rattrapé l'animation) PUIS mesure
// différée une fois la transition terminée — le badge peut donc rester légèrement mal recadré
// PENDANT l'animation, jamais après. `.bdg__preview-frame` porte désormais sa propre
// transition (`transition: width/height 220ms ease`, cf. CSS) : ce recadrage différé s'anime
// donc en douceur au lieu de sauter d'un coup (retour Julien, 18/09 soir).
function settleDrawerResize() {
  measurePreviewBox()
  previewRenderTick.value++
  setTimeout(() => {
    measurePreviewBox()
    previewRenderTick.value++
  }, 240)
}
function toggleDrawer() {
  drawerExpanded.value = !drawerExpanded.value
  settleDrawerResize()
}

// Glisser la poignée : suit le doigt en direct (`dragHeight`, appliqué en `:style` inline sur
// `.bdg__drawer`, transition CSS désactivée pendant le geste) puis se cale sur l'état le plus
// proche au relâché. N'entre en jeu QUE si un vrai déplacement a eu lieu (`dragMoved`) — un
// simple tap (aucun mouvement) laisse le `@click` natif du bouton gérer la bascule comme avant
// (les navigateurs ne synthétisent pas de `click` après un pointeur qui a réellement bougé,
// donc aucun double-bascule entre les deux chemins).
const dragStartY = ref(null)
const dragHeight = ref(null)
let dragStartHeight = 0
let dragMoved = false
function onDrawerHandlePointerDown(e) {
  dragStartY.value = e.clientY
  dragStartHeight = drawerExpanded.value ? drawerMaxHeight() : drawerMinHeight()
  dragHeight.value = dragStartHeight
  dragMoved = false
  window.addEventListener('pointermove', onDrawerHandlePointerMove)
  window.addEventListener('pointerup', onDrawerHandlePointerUp)
  window.addEventListener('pointercancel', onDrawerHandlePointerUp)
}
function onDrawerHandlePointerMove(e) {
  if (dragStartY.value == null) return
  const deltaY = dragStartY.value - e.clientY
  if (Math.abs(deltaY) > 6) dragMoved = true
  dragHeight.value = Math.min(drawerMaxHeight(), Math.max(drawerMinHeight(), dragStartHeight + deltaY))
}
function onDrawerHandlePointerUp() {
  if (dragStartY.value == null) return
  window.removeEventListener('pointermove', onDrawerHandlePointerMove)
  window.removeEventListener('pointerup', onDrawerHandlePointerUp)
  window.removeEventListener('pointercancel', onDrawerHandlePointerUp)
  if (dragMoved) {
    const mid = (drawerMinHeight() + drawerMaxHeight()) / 2
    drawerExpanded.value = dragHeight.value > mid
    settleDrawerResize()
  }
  dragStartY.value = null
  dragHeight.value = null
}

// Tâche 15 (chantier « badge corrections typo/zoom », 19/09) : le CORPS du tiroir
// (`.bdg__drawer-body`, sous la poignée — onglets Format/Couleur/Infos et leur contenu) doit
// lui aussi se refermer sur un glisser vers le bas, règle standard des feuilles coulissantes
// (« bottom sheets ») : SEULEMENT si son contenu est déjà tout en haut (`scrollTop === 0` au
// moment où le doigt se pose) ET que le mouvement est bien vers le BAS. Dans tous les autres
// cas (contenu déjà défilé, ou mouvement vers le haut), le défilement natif du corps
// (`overflow-y: auto`) doit rester exactement comme avant. État candidat SÉPARÉ de celui de
// la poignée (`dragStartY`/`dragHeight` ci-dessus) : tant que le geste n'est pas confirmé
// comme un glisser-fermeture, on ne touche à rien qui pourrait interférer avec un tap normal
// sur un bouton/onglet à l'intérieur du corps.
const drawerBodyEl = ref(null)
let bodyDragCandidateY = null
function onDrawerBodyPointerDown(e) {
  // Correctif revue finale (chantier « badge corrections typo/zoom » 19/09) : un champ de
  // saisie (le texte libre de l'onglet Infos, `<input data-test="badge-text">`) peut se
  // trouver tout en haut de son scroll et recevoir un glisser franc vers le bas — sans ce
  // garde, ce geste serait pris pour un candidat fermeture-tiroir (cf. commentaire ci-dessus)
  // et pourrait refermer le tiroir en pleine saisie. Le geste natif du champ (sélection de
  // texte, positionnement du curseur) doit rester intact : on ne pose alors AUCUN écouteur
  // candidat.
  if (e.target.closest('input, textarea, [contenteditable]')) return
  bodyDragCandidateY = e.clientY
  window.addEventListener('pointermove', onDrawerBodyPointerMoveCandidate)
  window.addEventListener('pointerup', onDrawerBodyPointerUpCandidate)
  window.addEventListener('pointercancel', onDrawerBodyPointerUpCandidate)
}
function onDrawerBodyPointerMoveCandidate(e) {
  if (bodyDragCandidateY == null) return
  const deltaDown = e.clientY - bodyDragCandidateY // positif = doigt vers le bas
  const atTop = !drawerBodyEl.value || drawerBodyEl.value.scrollTop <= 0
  if (deltaDown > 6 && atTop) {
    // Bascule vers le geste de redimensionnement DÉJÀ existant de la poignée, à partir de
    // MAINTENANT (pas depuis le pointerdown initial du corps, pour ne pas faire sauter le
    // tiroir) : `onDrawerHandlePointerDown` relit `e.clientY` et l'état `drawerExpanded`
    // courant, sans dépendance à un pointerdown antérieur.
    onDrawerBodyPointerUpCandidate()
    onDrawerHandlePointerDown(e)
    return
  }
  // Tiroir REPLIÉ + glisser vers le HAUT (Task « tiroir, deux finitions », 20/09) : le corps
  // n'a plus de défilement natif en position repliée (cf. `.bdg__drawer-body--locked`), un
  // glisser vers le haut doit donc ouvrir le tiroir plutôt que de rester sans effet — même pont
  // vers le mécanisme de la poignée que ci-dessus, sens inverse.
  if (deltaDown < -6 && !drawerExpanded.value) {
    onDrawerBodyPointerUpCandidate()
    onDrawerHandlePointerDown(e)
    return
  }
  // Sinon (tiroir déplié : défilement natif normal ; ou petit mouvement sous les deux seuils) :
  // ne rien faire.
}
function onDrawerBodyPointerUpCandidate() {
  bodyDragCandidateY = null
  window.removeEventListener('pointermove', onDrawerBodyPointerMoveCandidate)
  window.removeEventListener('pointerup', onDrawerBodyPointerUpCandidate)
  window.removeEventListener('pointercancel', onDrawerBodyPointerUpCandidate)
}

// Ratio à transmettre à computeBadgeGeometry/renderBadge : un nombre pour un slot unique, un
// couple [r1, r2] pour le gabarit Deux images (ratios indépendants par emplacement).
const photoRatioParam = computed(() =>
  templateKey.value === 'double' ? [photoAspect.value, photoAspect2.value] : photoAspect.value,
)
// Même calcul que `renderBadge` (badge-render.js) pour le nombre de lignes affichées : les 4
// gabarits dimensionnent maintenant leur CANEVAS à partir de ce nombre (cf.
// computeBadgeGeometry) — sans lui ici, `currentTemplate.canvas.h` retomberait sur le défaut
// (0 ligne) et ne correspondrait plus à la hauteur RÉELLE du canevas dessiné par `renderBadge`.
// `currentTemplate` demeure utile pour calculer la géométrie des slots photo. `customText` en
// est exclu ICI pour les 4 gabarits (chantier « badge corrections typo/zoom » 19/09, Task 4 —
// avant ce chantier, seuls Vertical/Horizontal l'excluaient, Task 6 du chantier « badge
// cartouche condensé » 18/09c) exactement comme `renderBadge` l'exclut de son propre
// `buildRawStatLines` pour les 4 gabarits depuis la Task 5/Task 3 (badge-render.js) — le texte
// libre a sa PROPRE réserve de hauteur (`freeTextLineCount` plus bas), jamais mélangée aux
// stats. C'est l'APPELANT qui choisit de ne pas transmettre `customText` ici, jamais une
// branche interne à `buildRawStatLines` (invariant documenté dans badge-render.js, à ne pas
// rompre).
// `+ 1` (Task B, chantier « badge motif d'avancement » 20/09) : `buildRawStatLines` NON
// structuré (appelé ici) compose `progress` en une seule chaîne jointe « Label · Valeur » — il
// ne sait rien de la rangée FIXE que son motif réserve en plus côté dessin réel
// (`stackedRowCount`, badge-render.js, structured). Sans ce correctif, `currentTemplate`
// sous-évaluait `canvas.h` d'exactement `STACK_ROW_H` chaque fois que `progress` est
// sélectionné avec un motif dessinable — recréant, pour ce cas précis, le même écart
// mesure/dessin que ce fichier documente déjà pour `startedOn` (ligne ~372). Condition
// IDENTIQUE à celle qui décide si le motif existe réellement côté dessin (`statLines`, cas
// `'progress'`, badge-render.js) : `progressAvailable` porte déjà exactement cette même garde
// (projet non terminé + `rowsProgress` calculable), réutilisée ici plutôt que redérivée.
const statLineCount = computed(() =>
  buildRawStatLines(selectedStats.value, {
    stats: props.stats, t, locale: badgeLocale.value,
    project: props.project, yarnUsage: props.yarnUsage, unitSystem: settings.unitSystem,
  }).length + (selectedStats.value.includes('progress') && progressAvailable ? 1 : 0),
)
// Nombre de GROUPES logiques (Task 13, chantier « badge corrections typo/zoom » 19/09) —
// NE peut plus être `statLineCount.value` (Task 9 le réutilisait, cf. commentaire de
// `currentTemplate` avant ce correctif) : depuis le regroupement « Commencé le »/« Terminé le »
// (une seule donnée logique), le nombre de PAIRES structurées peut dépasser le nombre de
// GROUPES. Recalculé séparément via `buildRawStatLines(..., { structured: true })` — même
// exclusion de `customText` que `statLineCount` ci-dessus — puis compté par `countGroups`
// (badge-render.js, même mécanisme que `renderBadge` pour ne jamais diverger).
const pairCount = computed(() =>
  countGroups(
    buildRawStatLines(selectedStats.value, {
      stats: props.stats, t, locale: badgeLocale.value,
      project: props.project, yarnUsage: props.yarnUsage, structured: true,
      unitSystem: settings.unitSystem,
    }),
  ),
)
// Nombre de lignes du bloc "texte libre" pleine largeur À RÉSERVER À PART (Task 6, 7e argument
// de `computeBadgeGeometry` depuis le retrait de `layoutStyle`, cf. Task 5/badge-render.js) —
// pour les 4 gabarits depuis ce chantier (19/09), sinon 0. Approximation délibérément
// grossière, MÊME philosophie que `titleLineCount` fixé à `1` dans l'appel plus bas (aucun
// contexte 2D ici pour reproduire le retour à la ligne réel de `wrapText`) :
// `buildRawStatLines([], { customText })` (badge-render.js) produit TOUJOURS exactement UNE
// entrée brute si `customText` est non vide — le wrap en plusieurs lignes visuelles n'a lieu
// que plus tard, dans `renderBadge`, avec un vrai `ctx`. Donc 0 ou 1, jamais plus, quelle que
// soit la longueur réelle du texte : un texte proche du maximum autorisé (80 caractères, cf.
// `maxlength` du champ Infos) peut réellement occuper 2 lignes sur un Vertical étroit —
// sous-réservation assumée, pas corrigée ici (même famille que l'approximation
// `titleLineCount`, hors scope de cette tâche).
const freeTextLineCount = computed(() =>
  badgeText.value && badgeText.value.trim() ? 1 : 0,
)
// Géométrie CALCULÉE (photoSlot(s) + statsArea), dépendante du/des ratio(s) choisi(s) — cf.
// computeBadgeGeometry (badge-render.js). Remplace l'ancien accès direct à
// BADGE_TEMPLATES[key], qui ne portait plus que canvas/orientation (la géométrie fine).
// `requiredTextWidth` (6e argument) posé à 0 ; `layoutStyle` a disparu de la signature
// (chantier « badge corrections typo/zoom » 19/09, Task 3) — `freeTextLineCount` est donc le
// 7e argument. `pairCount` (Task 9, même chantier) est le 8e — depuis la Task 13, c'est
// `pairCount.value` (nombre de GROUPES, cf. son commentaire ci-dessus), plus
// `statLineCount.value` : les deux ne coïncident plus dès que `startedOn` (projet terminé)
// est sélectionné, ses deux phrases comptant pour 2 dans `statLineCount` mais 1 seul groupe.
// `weeksCount` (Task « marge date/calendrier », 20/09) est le 9e et dernier : `props.stats?.grid?.columns?.length || 0`,
// la même source que lit `hasCalendarData` (ligne ~147, qui n'en retient qu'un booléen — un
// booléen ne peut pas fournir un compte de semaines). Reparsée ici volontairement, pas la
// valeur de `hasCalendarData` elle-même : les deux dérivent de la même donnée sans que l'une
// réutilise l'autre.
const currentTemplate = computed(() => computeBadgeGeometry(
  templateKey.value, photoRatioParam.value, statLineCount.value, 1,
  hasCalendarData.value && includeCalendar.value, 0, freeTextLineCount.value,
  pairCount.value, props.stats?.grid?.columns?.length || 0,
))
const hasPhotoSlot = computed(() => !!currentTemplate.value.photoSlot || !!currentTemplate.value.photoSlots)

const previewCanvas = ref(null)
const previewLayer = ref(null)
const previewBoxSize = ref({ w: 0, h: 0 })
const previewRenderTick = ref(0)

function measurePreviewBox() {
  const box = previewLayer.value
  if (box) previewBoxSize.value = { w: box.clientWidth, h: box.clientHeight }
}
// `ResizeObserver` sur le calque lui-même, plutôt qu'un simple écouteur `resize` de la
// fenêtre : ce calque change de taille pour des raisons qu'un `resize` ne signale jamais,
// au premier rang desquelles le recalcul de `dvh` quand la barre d'adresse mobile
// apparaît/disparaît. Un `ResizeObserver` réagit à la taille RÉELLE du calque quelle qu'en
// soit la cause, sans dépendre de la liste des événements qui la modifient.
let previewResizeObserver = null

const drawerEl = ref(null)
const drawerHeight = ref(0)
function measureDrawerHeight() {
  if (drawerEl.value) drawerHeight.value = drawerEl.value.clientHeight
}
// Sondé en direct sur le Pixel (CDP, cf. mémoire diagnostic-webview-live-cdp) après le
// correctif ci-dessus, TOUJOURS letterboxé (18/09 soir) : le vrai bug n'était pas la
// péremption de la mesure mais son RÉFÉRENT. `.bdg__preview-layer` réservait un `bottom` fixe
// calé sur le PLAFOND replié/déplié du tiroir (`.bdg__drawer--expanded`, doublet vh/dvh), pas
// sur sa hauteur RÉELLE — or `.bdg__drawer` est `height: auto` (grandit avec son contenu,
// cf. son propre commentaire) : un onglet court (Format) laisse le tiroir bien plus bas que
// son plafond déplié, et la prévisu se recadrait quand même contre ce plafond, avec tout
// l'écart en bande vide entre le badge et le vrai bord du tiroir. Mesuré en direct :
// `.bdg__drawer` déplié à 224px de haut sur un plafond de 621px — la prévisu réservait les
// 621px en entier. Le plafond CSS reste en repli (avant la première mesure, ou si
// `ResizeObserver` est absent, cf. garde plus bas) ; une fois `drawerHeight` connu,
// `previewLayerStyle` l'écrase avec la valeur RÉELLE.
let drawerResizeObserver = null
const previewLayerStyle = computed(() => {
  if (!drawerHeight.value) return {}
  const style = { bottom: `${drawerHeight.value}px` }
  // Glisser la poignée pose déjà `transition: none` sur `.bdg__drawer` pour suivre le doigt
  // sans latence (cf. plus bas) — même traitement ici, sinon la transition de 220ms de
  // `.bdg__preview-layer` ferait traîner le recadrage derrière le tiroir pendant le geste.
  if (dragHeight.value != null) style.transition = 'none'
  return style
})

// Le tiroir bas se pose PAR-DESSUS `.bdg__preview-layer` (plein viewport) — le badge doit
// donc se recadrer pour rester visible AU-DESSUS de la zone que le tiroir occupe, sinon les
// stats qu'on règle dans l'onglet Infos disparaissent sous le tiroir déplié (revue finale de
// branche, 18/09 : contradiction du plan lui-même entre « plein viewport » et « ne jamais
// masquer la prévisu » — la maquette validée faisait déjà remonter sa légende à l'ouverture du
// tiroir, intention perdue en traduisant « pas de calque de légende séparé nécessaire » en
// « rien à faire remonter »). La classe `.bdg__preview-layer--drawer-expanded` (posée quand
// `drawerExpanded` est vrai, cf. template) reprend EXACTEMENT les mêmes valeurs que
// `.bdg__drawer`/`.bdg__drawer--expanded` en CSS (160px/22dvh replié, 320px/48dvh déplié) :
// les deux DOIVENT rester synchronisés si ces seuils changent un jour. Posé en classe CSS
// statique plutôt qu'en `:style` inline dynamique (revue finale de branche, 18/09) : un
// `bottom` inline calculé en JS avec une unité `dvh` non supportée (WebView Android
// < Chromium 108) est invalide dans son ENTIER et retombe à `auto`, remasquant le badge — le
// doublet vh/dvh (même motif que `.bdg__drawer` ci-dessous) n'est exprimable qu'en CSS statique.

// Taille EXACTE (en px) du cadre autour du canevas, calculée en JS plutôt qu'en CSS pur — même
// principe que `canvasBoxStyle`/`fitWithinBox` (PhotoLightbox.vue) et que l'ancienne loupe
// plein écran retirée en Task 2 (`fsImgStyle`/`fsCanvasStyle`), pour exactement le même problème
// de contain-fit. Abandon délibéré de la piste CSS pure des rounds 1/2 (18/09) : un
// `max-height` en pourcentage sur un enfant, dans un conteneur flex dont la propre hauteur
// dépend du contenu (shrink-to-fit), ne se résout pas de façon fiable quand c'est la HAUTEUR qui
// contraint le rendu (mesuré en Playwright, round 2 : le canevas débordait de 50 à 128 px selon
// le viewport) — un badge affiché sur un écran plus large que haut (rotation, tablette, gabarit
// Horizontal) entre dans ce cas. `previewRenderTick` : dépendance explicite du computed
// ci-dessous, `canvas.width`/`canvas.height` (attributs DOM posés par `renderBadge`) ne sont pas
// réactifs par eux-mêmes.
const previewFrameStyle = computed(() => {
  previewRenderTick.value
  const canvas = previewCanvas.value
  const box = previewBoxSize.value
  if (!canvas || !canvas.width || !canvas.height || !box.w || !box.h) return {}
  const canvasRatio = canvas.width / canvas.height
  const boxRatio = box.w / box.h
  let w, h
  if (canvasRatio > boxRatio) {
    w = box.w
    h = w / canvasRatio
  } else {
    h = box.h
    w = h * canvasRatio
  }
  const style = { width: `${w}px`, height: `${h}px` }
  // Glisser la poignée OU la prévisu pose déjà `transition: none` sur `.bdg__drawer` et sur
  // `.bdg__preview-layer` (cf. `previewLayerStyle`) pour suivre le doigt sans latence — ce
  // cadre en avait été oublié (Tâche 10, chantier « badge corrections typo/zoom » 19/09) :
  // sondé en direct sur le Pixel 7 (CDP, mémoire diagnostic-webview-live-cdp), `dragHeight`
  // et `drawerHeight` restent synchronisés à moins de 15ms/1px l'un de l'autre à chaque
  // `pointermove` — la fuite n'est PAS là. Le vrai retard est purement visuel : `.bdg__preview-
  // frame` garde sa transition CSS `width/height 220ms ease` (posée pour le confort du
  // recadrage APRÈS un tap sur la poignée, cf. commentaire de cette règle) active PENDANT le
  // geste aussi, alors que sa taille change à chaque `pointermove` — chaque nouveau
  // `pointermove` relance un lissage de 220ms vers une cible qui a déjà bougé, si bien que le
  // cadre affiché traîne derrière le tiroir (mesuré : ~50ms de retard au tout début du geste,
  // avant que le lissage ne rattrape en accéléré) au lieu de suivre le doigt en direct — ce qui
  // se perçoit comme un « saut » plutôt qu'un suivi progressif. Désactivée ici pendant le
  // geste, exactement comme les deux autres calques ; laissée intacte pour le recadrage
  // qui suit le relâché (`settleDrawerResize`) et pour la bascule au tap sur la poignée
  // (`toggleDrawer`), qui doivent continuer à s'animer.
  if (dragHeight.value != null) style.transition = 'none'
  return style
})

function demoPhotoForTemplate(offset = 0) {
  return DEMO_PHOTOS[(TEMPLATE_KEYS.indexOf(templateKey.value) + offset) % DEMO_PHOTOS.length]
}
async function updatePreview() {
  const canvas = previewCanvas.value
  if (!canvas) return
  try {
    const tpl = currentTemplate.value
    let photoImg = null
    let photoImg2 = null
    if (tpl.photoSlots) {
      const src1 = photoDataUrl.value || demoPhotoForTemplate()
      const src2 = photoDataUrl2.value || demoPhotoForTemplate(1)
      // Les deux décodages sont indépendants : en parallèle plutôt qu'en série, pour ne
      // pas doubler la latence de ce cycle de prévisu (déjà amorti à 200ms, cf. plus bas).
      ;[photoImg, photoImg2] = await Promise.all([
        src1 ? loadImage(src1) : Promise.resolve(null),
        src2 ? loadImage(src2) : Promise.resolve(null),
      ])
    } else if (tpl.photoSlot) {
      const src = photoDataUrl.value || demoPhotoForTemplate()
      photoImg = src ? await loadImage(src) : null
    }
    renderBadge(canvas, {
      templateKey: templateKey.value,
      color: badgeColor.value,
      photoRatio: photoRatioParam.value,
      statKeys: selectedStats.value,
      stats: props.stats,
      yarnUsage: props.yarnUsage,
      vegan: isVegan.value,
      photoImg,
      photoImg2,
      project: props.project,
      t,
      generatedAt: new Date(),
      locale: badgeLocale.value,
      customText: badgeText.value,
      includeCalendar: hasCalendarData.value && includeCalendar.value,
      unitSystem: settings.unitSystem,
      // Pastille Technique des 4 gabarits (revue finale de branche, 19/09, étendue à
      // minimal/double par le chantier « badge corrections typo/zoom », Task 4) : la case à
      // cocher « Technique » de l'onglet Infos la pilote — `renderBadge` filtre lui-même
      // `'technique'` de `statKeys` (Task 3, badge-render.js) et ne dessine la pastille que si
      // `includeTechnique` est vrai ET la technique renseignée. Transmis aux DEUX appels à
      // `renderBadge` de ce fichier (prévisu ET génération), sans quoi l'image partagée ne
      // dirait pas la même chose que la prévisu.
      includeTechnique: includeTechnique.value,
    })
    await nextTick()
    measurePreviewBox()
    previewRenderTick.value++
  } catch {
    // Prévisu best-effort : une image corrompue (loadImage() rejetée) ne doit jamais faire
    // planter le composeur ni laisser une rejection non gérée — juste sauter ce cycle de
    // rendu, la prévisu reste inchangée jusqu'au prochain déclencheur du watch.
  }
}
// Un redessin COMPLET du canevas (dégradé + photo + calendrier + texte, `renderBadge`) coûte
// ~100-150ms sur un badge chargé (mesuré en direct sur Pixel 7, canevas large type Horizontal)
// — sans amortissement, taper vite dans le texte libre empile un redessin par frappe et bloque
// le fil principal plusieurs secondes d'affilée (remonté par Julien, 18/09 : « toute l'app
// semblait figée »). Le premier rendu (`onMounted` plus bas) reste immédiat, non amorti — seul
// CE watcher, déclenché à chaque frappe/réglage, passe par un amortissement de 200ms.
const PREVIEW_DEBOUNCE_MS = 200
const scheduleUpdatePreview = debounce(updatePreview, PREVIEW_DEBOUNCE_MS)
watch(
  [templateKey, badgeColor, selectedStats, photoDataUrl, photoDataUrl2, photoAspect, photoAspect2, badgeLocale, includeTechnique, badgeText, includeCalendar],
  scheduleUpdatePreview,
  { deep: true },
)

function toggleStat(key) {
  const i = selectedStats.value.indexOf(key)
  if (i === -1) selectedStats.value.push(key)
  else selectedStats.value.splice(i, 1)
}

// Résultat de BadgePhotoPicker (pop-up unique choix + ratio + recadrage, remplace l'onglet
// Photo depuis le 17/09) : applique la photo DÉJÀ recadrée au slot ciblé (`activeSlot`,
// posé par `onFixClick` au clic sur la prévisu) et mémorise le ratio choisi pour la
// géométrie (cf. `photoRatioParam` ci-dessus).
function onPhotoPickerConfirm({ dataUrl, ratio }) {
  if (activeSlot.value === 2) {
    photoDataUrl2.value = dataUrl
    photoAspect2.value = ratio
  } else {
    photoDataUrl.value = dataUrl
    photoAspect.value = ratio
  }
  photoPickerOpen.value = false
}

// Bouton « Modifier » au clic sur une photo de la prévisu (pattern ReaderFixOverlay,
// généralisé ici en plus simple : positionné sur le SLOT cliqué plutôt que sur une carte
// entière). `onPreviewClick` traduit les coordonnées écran en coordonnées internes du canvas
// (sa résolution réelle, cf. renderBadge, diffère de sa taille affichée) pour savoir quel
// slot a été touché ; `previewFixStyle` repositionne le bouton en pourcentage du canvas, donc
// juste quelle que soit l'échelle d'affichage.
// Posé par `onPreviewPointerUpOrCancel` juste avant de refermer le tiroir sur un tap (cf.
// plus bas) : le clic natif qui suit immédiatement le relâché sur un simple tap (les
// navigateurs ne synthétisent PAS de `click` après un pointeur qui a réellement bougé, cf.
// `dragMoved`) ne doit pas AUSSI ouvrir « Modifier » sur la photo.
let suppressNextPreviewClick = false
function onPreviewClick(e) {
  if (suppressNextPreviewClick) {
    suppressNextPreviewClick = false
    return
  }
  const canvas = previewCanvas.value
  if (!canvas || !hasPhotoSlot.value) return
  const rect = canvas.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const x = (e.clientX - rect.left) * (canvas.width / rect.width)
  const y = (e.clientY - rect.top) * (canvas.height / rect.height)
  const tpl = currentTemplate.value
  const slots = tpl.photoSlots || (tpl.photoSlot ? [tpl.photoSlot] : [])
  const idx = slots.findIndex((s) => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h)
  previewFixSlot.value = idx === -1 ? null : idx + 1
}
const previewFixStyle = computed(() => {
  if (!previewFixSlot.value) return null
  const tpl = currentTemplate.value
  const slot = tpl.photoSlots ? tpl.photoSlots[previewFixSlot.value - 1] : tpl.photoSlot
  const canvas = previewCanvas.value
  // Dénominateur : les dimensions RÉELLES du <canvas> du DOM (déjà posées par `renderBadge`
  // dans `updatePreview()`), jamais `tpl.canvas` — cette prédiction ne peut plus être fiable
  // dès qu'un titre ou une ligne de stat retourne effectivement à la ligne (Task 2), le
  // composant n'ayant aucun moyen de prévoir le nombre de lignes WRAPPÉES sans un contexte 2D
  // réel (que `wrapText`/`renderBadge`, dans badge-render.js, sont seuls à posséder). Le
  // numérateur (position/taille du SLOT lui-même) reste celui de `tpl`, avec le même genre
  // d'approximation assumée pour DEUX gabarits : pour Deux images, il dépend aussi de
  // `requiredTextWidth` depuis l'élargissement du canevas pour éviter les retours à la ligne
  // évitables (Task 10, 17/09) — le canevas s'élargit, donc `anchorW` et les deux slots avec —
  // `currentTemplate`, appelé ici SANS cet argument (posé à 0, cf. son commentaire plus haut),
  // peut diverger visiblement avec un titre/une stat assez longs. Pour Horizontal, ce n'est
  // PLUS vrai non plus depuis le 20/09 (retour Julien, la photo suit désormais la hauteur du
  // cartouche plutôt qu'une ancre fixe à 600, cf. `computeBadgeGeometry`) : son slot ne dépend
  // plus SEULEMENT du ratio de photo choisi, il grandit aussi avec la hauteur du cartouche
  // (`statLineCount`/`freeTextLineCount`/le calendrier), que `currentTemplate` transmet bien —
  // mais ni le nombre RÉEL de lignes WRAPPÉES (titre figé à 1 ligne ici, cf. son commentaire
  // plus haut) ni `requiredTextWidth` (toujours 0 ici) n'y participent, alors que tous deux
  // allongent le cartouche RÉEL — SANS calendrier, le slot prédit ici est donc TOUJOURS un peu
  // plus PETIT que le slot réellement dessiné, jamais plus grand (le wrap ne fait qu'ALLONGER
  // le cartouche, jamais le raccourcir) : la photo réelle est donc TOUJOURS au moins aussi
  // haute que celle prédite (même origine dans les deux cas, `x`/`y` valent `MARGIN`), le slot
  // prédit reste INCLUS dans le vrai.
  //
  // AVEC calendrier actif, ce n'est PLUS vrai (repéré en revue, 21/09) : `requiredTextWidth = 0` ici
  // maintient `colW` au plancher (`MIN_LANDSCAPE_TEXT_W`, 420) tant que seule la largeur de
  // photo l'exige, donc le calendrier prédit reste en mode EMPILÉ (`stack`, +330px de hauteur,
  // cf. `calendarLayout`/`CALENDAR_STACK_HEIGHT`) — alors que le texte RÉEL (titre/stats/texte
  // libre, une trentaine de caractères de texte libre suffisent à porter `requiredTextWidth`
  // vers ~830px) fait souvent grandir `colW` jusqu'au mode CÔTE À CÔTE (`side`, cartouche
  // réellement plus COURT, sans cette réserve empilée). Le slot prédit ici peut alors être
  // NETTEMENT plus GRAND que le slot réel, pas seulement plus petit (mesuré : 16:9 + 6 stats +
  // calendrier + texte libre → prédit 2386×1342, réel 1664×936) — un appui sur la partie
  // GAUCHE du cartouche dans la prévisu ouvre alors à tort le sélecteur de photo, la zone
  // prédite débordant sur ce qui est, en vrai, déjà le cartouche de texte. Prévisu SEULEMENT :
  // l'export (`renderBadge` réel) reste correct, lui, dans tous les cas.
  //
  // Repli assumé, même famille que Deux images ci-dessus — à corriger dans un lot séparé en
  // faisant remonter la géométrie RÉELLE depuis `renderBadge` (qui ne renvoie aujourd'hui que
  // la dataURL) plutôt qu'en la re-prédisant ici.
  if (!slot || !canvas || !canvas.width || !canvas.height) return null
  return {
    left: `${((slot.x + slot.w / 2) / canvas.width) * 100}%`,
    top: `${((slot.y + slot.h / 2) / canvas.height) * 100}%`,
  }
})
function onFixClick() {
  activeSlot.value = previewFixSlot.value
  previewFixSlot.value = null
  photoPickerOpen.value = true
}

// Vraie feuille modale (cf. .bdg dans le style plus bas) : verrou de défilement du fond,
// piège au Tab, restitution du focus et Échap. Le composant est monté/démonté par le `v-if`
// du parent : montage et démontage sont donc appariés par construction, pas besoin du drapeau
// `verrouPose` des dialogues permanents (PhotoCropper, ChartFullscreen) qui, eux, vivent tout
// le temps et n'ouvrent qu'un état. Même raison pour `useDialogFocusReturn()` SANS argument :
// sa forme sans ref utilise onMounted/onUnmounted, exactement ce cycle de vie.
useDialogFocusReturn()
// La garde `cropper.open` est AUSSI indispensable que l'écouteur lui-même (même rôle que le
// `zoom.open &&` de ChartFullscreen) : le recadreur s'ouvre PAR-DESSUS BadgePhotoPicker,
// elle-même par-dessus cette feuille, et ne gère pas Échap lui-même (PhotoCropper ne pose que
// `trapTabFocus`, qui laisse filer les autres touches). Sans elle, Échap pendant un recadrage
// remontait jusqu'ici, le parent démontait le composeur pendant que `cropper.crop()`
// attendait encore, et toute la configuration en cours (gabarit, teinte, stats) partait sans
// un mot, recadreur orphelin à l'écran.
// `defaultPrevented` : Échap déjà consommé par une pop-up enfant (BadgePhotoPicker,
// ColorPickerDialog, écouteurs `document` atteints avant ce `window`) : il ne ferme qu'elle.
function onKey(e) {
  if (cropper.open) return
  if (e.key !== 'Escape' || e.defaultPrevented) return
  emit('close')
}
onMounted(() => {
  lockBodyScroll()
  window.addEventListener('keydown', onKey)
  updatePreview()
  // Mesure initiale avant le premier rendu : `updatePreview()` mesurera aussi lui-même
  // désormais (cf. plus haut), mais `previewLayer` est déjà monté ici et une mesure de plus
  // ne fait pas de mal si le premier `updatePreview()` tarde (chargement d'image asynchrone).
  nextTick(measurePreviewBox)
  nextTick(measureDrawerHeight)
  // Absent de jsdom (jamais polyfillé, cf. tests/unit/setup.js) : mêmes garde et
  // patron que ChartStage.vue (`canvasRO`) pour cette même API.
  if (typeof ResizeObserver !== 'undefined' && previewLayer.value) {
    previewResizeObserver = new ResizeObserver(measurePreviewBox)
    previewResizeObserver.observe(previewLayer.value)
  }
  if (typeof ResizeObserver !== 'undefined' && drawerEl.value) {
    drawerResizeObserver = new ResizeObserver(measureDrawerHeight)
    drawerResizeObserver.observe(drawerEl.value)
  }
})
onBeforeUnmount(() => {
  unlockBodyScroll()
  window.removeEventListener('keydown', onKey)
  previewResizeObserver?.disconnect()
  drawerResizeObserver?.disconnect()
  scheduleUpdatePreview.cancel()
  // Filet de sécurité si un glisser de la poignée est en cours au démontage (ex. Échap pendant
  // un geste) : ces listeners sont normalement retirés en paire dans `onDrawerHandlePointerUp`,
  // `removeEventListener` sur un listener déjà absent ne fait rien.
  window.removeEventListener('pointermove', onDrawerHandlePointerMove)
  window.removeEventListener('pointerup', onDrawerHandlePointerUp)
  window.removeEventListener('pointercancel', onDrawerHandlePointerUp)
  // Même filet pour les gestes posés sur la PRÉVISU (glisser-tiroir étendu + pincer-zoomer,
  // `onPreviewPointerDown` plus bas) : ces trois écouteurs globaux ne sont retirés par
  // `onPreviewPointerUpOrCancel` que lorsque le DERNIER doigt se relève. Un démontage pendant
  // le geste (Échap, bouton Fermer touché d'un second doigt, navigation) les laissait donc sur
  // `window`, refermés sur les refs d'un composant mort et réinstallés à chaque réouverture du
  // composeur. Oubli de la Task 5, invisible à sa revue isolée : le filet existant juste
  // au-dessus datait de la poignée seule et n'a pas été étendu avec le geste (revue finale de
  // branche, 19/09).
  window.removeEventListener('pointermove', onPreviewPointerMove)
  window.removeEventListener('pointerup', onPreviewPointerUpOrCancel)
  window.removeEventListener('pointercancel', onPreviewPointerUpOrCancel)
  // Même filet pour le geste CANDIDAT posé sur le CORPS du tiroir (Tâche 15,
  // `onDrawerBodyPointerDown` plus haut) : tant que le seuil de bascule n'est pas franchi, ces
  // écouteurs restent sur `window` et doivent être retirés si le composant est démonté pendant
  // le geste (ex. Échap).
  window.removeEventListener('pointermove', onDrawerBodyPointerMoveCandidate)
  window.removeEventListener('pointerup', onDrawerBodyPointerUpCandidate)
  window.removeEventListener('pointercancel', onDrawerBodyPointerUpCandidate)
})

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = dataUrl
  })
}

async function generate() {
  const tpl = currentTemplate.value
  let photoImg = null
  let photoImg2 = null
  if (tpl.photoSlots) {
    // Même parallélisation qu'`updatePreview()` ci-dessus : les deux décodages sont
    // indépendants.
    ;[photoImg, photoImg2] = await Promise.all([
      photoDataUrl.value ? loadImage(photoDataUrl.value) : Promise.resolve(null),
      photoDataUrl2.value ? loadImage(photoDataUrl2.value) : Promise.resolve(null),
    ])
  } else if (tpl.photoSlot && photoDataUrl.value) {
    photoImg = await loadImage(photoDataUrl.value)
  }
  const canvas = createBadgeCanvas()
  const url = renderBadge(canvas, {
    templateKey: templateKey.value,
    color: badgeColor.value,
    photoRatio: photoRatioParam.value,
    statKeys: selectedStats.value,
    stats: props.stats,
    yarnUsage: props.yarnUsage,
    vegan: isVegan.value,
    photoImg,
    photoImg2,
    project: props.project,
    t,
    generatedAt: new Date(),
    locale: badgeLocale.value,
    customText: badgeText.value,
    includeCalendar: hasCalendarData.value && includeCalendar.value,
    unitSystem: settings.unitSystem,
    includeTechnique: includeTechnique.value, // cf. le commentaire de l'appel d'`updatePreview` plus haut
  })
  // Plafond d'image OBLIGATOIRE avant d'entrer dans `project.photos[]` : `renderBadge`
  // sort un JPEG 1080×1620 en qualité 0,9, très au-dessus du plafond (1280 px / q 0,8) que
  // `resizeDataUrl` impose à TOUTE autre porte d'entrée de photo (addPhoto → photo.js, kit
  // .zip, synchro patron.md). Mêmes valeurs par défaut que ces appels, pour ne pas créer
  // une deuxième règle. `resultUrl` montre la version RÉELLEMENT enregistrée.
  const saved = await resizeDataUrl(url)
  // Remplace l'entrée de CETTE session si elle existe déjà, sinon l'ajoute — cf.
  // commentaire de `generatedPhotoIndex` plus haut.
  if (generatedPhotoIndex.value != null) {
    workingPhotos.value[generatedPhotoIndex.value] = saved
  } else {
    generatedPhotoIndex.value = workingPhotos.value.length
    workingPhotos.value.push(saved)
  }
  resultUrl.value = saved
  await projectsStore.update(props.project.id, { photos: [...workingPhotos.value] })
  // Historique de couleurs : seulement ici, sur une génération RÉELLEMENT aboutie (pas à
  // chaque clic de pastille, cf. pickColor ci-dessus).
  await settings.rememberBadgeColor(badgeColor.value)
  emit('saved')
  return saved
}

// Pincer pour zoomer sur la prévisu, IN PLACE (Task 5, chantier « badge corrections
// typo/zoom », intent 2026-09-19 « retour zoom plein écran badge ») : la loupe plein écran
// séparée retirée à la refonte du 18/09 n'est PAS réintroduite (déjà jugée redondante par
// Julien, la prévisu occupant tout l'écran) — le zoom reste un `transform: scale()` posé sur
// `.bdg__preview-frame`, jamais un nouveau calque `position: fixed` (contrainte non
// négociable de l'intent : un seul niveau de `position: fixed` pour toute la feuille `.bdg`,
// celui du composant lui-même, cf. tout en haut de ce `<style>`).
//
// Exigence ajoutée par Julien en cours de conversation : glisser vers le haut sur la prévisu
// elle-même doit ouvrir le tiroir, EXACTEMENT comme un glissement sur sa poignée
// (`onDrawerHandlePointerDown`/`Move`/`Up` ci-dessus) — un doigt sur la prévisu se comporte
// donc comme un doigt sur la poignée tant qu'un second doigt n'est pas posé. Dès qu'un second
// doigt arrive, le glisser-tiroir est annulé PROPREMENT (`cancelDrawerDrag`, comme un
// `pointercancel`) : sans cela, les écouteurs globaux `onDrawerHandlePointerMove`/`Up` (posés
// sur `window`, filtrés par AUCUN `pointerId`) continueraient de lire la position du PREMIER
// doigt pendant que le second pince, faussant `dragHeight`.
const activePreviewPointers = new Map()

function onPreviewPointerDown(e) {
  // Tâche 11 : le `@click` natif qui consomme `suppressNextPreviewClick` est posé sur le
  // `<canvas>`, plus petit que ce calque dès que le badge est letterboxé (cf. commentaire de
  // `previewFrameStyle`, cas courant) — un tap fermant le tiroir dans la marge autour du
  // canevas ne déclenche donc AUCUN `click` pour consommer le drapeau. Sans cette remise à
  // zéro au nouveau geste, ce drapeau resterait posé et avalerait à tort le PROCHAIN tap
  // (légitime, sur la photo cette fois).
  suppressNextPreviewClick = false
  activePreviewPointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (activePreviewPointers.size === 1) {
    // Zoomé : un seul doigt déplace l'image (panoramique) au lieu du glisser-tiroir — le
    // glisser-tiroir à un doigt reste inchangé tant que l'image n'est pas zoomée (Task 7).
    if (zoomScale.value > 1) {
      startPan(e)
    } else {
      onDrawerHandlePointerDown(e)
    }
  } else if (activePreviewPointers.size === 2) {
    cancelDrawerDrag()
    cancelPan()
    startPinch()
  }
  window.addEventListener('pointermove', onPreviewPointerMove)
  window.addEventListener('pointerup', onPreviewPointerUpOrCancel)
  window.addEventListener('pointercancel', onPreviewPointerUpOrCancel)
}

function onPreviewPointerMove(e) {
  if (!activePreviewPointers.has(e.pointerId)) return
  activePreviewPointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (activePreviewPointers.size >= 2) {
    updatePinch()
  } else if (panActive) {
    updatePan(e)
  }
}

function onPreviewPointerUpOrCancel(e) {
  activePreviewPointers.delete(e.pointerId)
  if (activePreviewPointers.size < 2 && pinchActive) endPinch()
  // Un pincement dont on relâche un des deux doigts (il n'en reste qu'un, toujours posé)
  // n'émet aucun nouveau `pointerdown` pour ce doigt restant — sans ce branchement, il
  // resterait sans effet jusqu'à un relâché complet. Seule façon d'atteindre `size === 1` par
  // un événement de relâché : on venait forcément de 2 doigts, donc c'est bien une transition
  // pincement → panoramique, jamais un doigt de glisser-tiroir classique qui se relâcherait
  // (celui-là tombe à 0). `!panActive` : garde-fou, `cancelPan()` l'a déjà mis à faux avant
  // `startPinch()`, mais évite de relancer `startPan` si jamais déjà actif.
  if (activePreviewPointers.size === 1 && zoomScale.value > 1 && !panActive) {
    const [remaining] = activePreviewPointers.values()
    startPan({ clientX: remaining.x, clientY: remaining.y })
  }
  // Contrairement au pincement (qui retombe à un seul doigt tant qu'il en reste un), le
  // panoramique n'implique qu'un seul pointeur : rien à faire tant qu'il reste posé, seul le
  // DERNIER doigt relevé y met fin.
  if (activePreviewPointers.size === 0) {
    const wasPanning = panActive
    if (wasPanning) endPan()
    // Tâche 11 (chantier « badge corrections typo/zoom », retour Julien) : tiroir DÉPLIÉ, tap
    // sans glisser sur la prévisu (`dragMoved` faux, cf. `onDrawerHandlePointerDown` plus
    // haut — un doigt sur la prévisu non zoomée pilote le même geste que sur la poignée) → le
    // referme au lieu de le laisser filer vers sa hauteur maximale. Hors zoom uniquement
    // (`zoomScale.value === 1` — un tap pendant un pincement/panoramique actif, `wasPanning`,
    // ne doit rien changer au tiroir, hors périmètre de cette tâche) : ce garde-fou est
    // redondant avec `wasPanning` en pratique (`onPreviewPointerDown` ne route vers `startPan`
    // que si `zoomScale.value > 1`), gardé explicite par prudence si cette condition évoluait.
    // `suppressNextPreviewClick` avale le `@click` natif du canevas qui suit immédiatement ce
    // relâché (sinon `onPreviewClick` ouvrirait « Modifier » en plus de refermer le tiroir).
    if (!dragMoved && !wasPanning && zoomScale.value === 1 && drawerExpanded.value) {
      suppressNextPreviewClick = true
      drawerExpanded.value = false
      settleDrawerResize()
    }
    window.removeEventListener('pointermove', onPreviewPointerMove)
    window.removeEventListener('pointerup', onPreviewPointerUpOrCancel)
    window.removeEventListener('pointercancel', onPreviewPointerUpOrCancel)
  }
}

// Interrompt le glisser-tiroir DÉCLENCHÉ PAR LE PREMIER DOIGT sans le valider (comme un
// pointercancel) — nécessaire avant de démarrer un pincer, sinon les écouteurs globaux de
// `onDrawerHandlePointerMove`/`onDrawerHandlePointerUp` (posés par pointerId indifférent)
// continueraient de lire la position du PREMIER doigt pendant que le second pince.
function cancelDrawerDrag() {
  window.removeEventListener('pointermove', onDrawerHandlePointerMove)
  window.removeEventListener('pointerup', onDrawerHandlePointerUp)
  window.removeEventListener('pointercancel', onDrawerHandlePointerUp)
  dragStartY.value = null
  dragHeight.value = null
}

const zoomScale = ref(1)
const zoomOriginX = ref(50)
const zoomOriginY = ref(50)
let pinchActive = false
let pinchStartDist = 0
let pinchStartScale = 1

// Déplacer (pan) l'image une fois zoomée (Task 7, même chantier) : un glisser à un seul
// doigt quand `zoomScale > 1` (aiguillé par `onPreviewPointerDown` ci-dessus) déplace l'image
// au lieu de piloter le tiroir. `panX`/`panY` sont en pixels, additionnés à la transformation
// `scale()` déjà posée par le pincer-zoomer (cf. `previewZoomStyle` plus bas).
const panX = ref(0)
const panY = ref(0)
let panActive = false
let panStartClientX = 0
let panStartClientY = 0
let panStartX = 0
let panStartY = 0

function pointerDistance(pts) {
  const [a, b] = pts
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// `previewCanvas.value.getBoundingClientRect()`, PAS `previewLayer.value` (défaut corrigé en
// revue, 19/09) : le pourcentage calculé ici est appliqué comme `transformOrigin` sur
// `.bdg__preview-frame`, qui occupe exactement le même espace visuel que le `<canvas>` — pas
// celui du calque plein écran `.bdg__preview-layer`, dont le cadre est centré et PLUS PETIT
// dès que le badge est letterboxé (cf. commentaire de `previewFrameStyle`, cas courant). Un
// référentiel « calque » ancrerait le zoom à un endroit différent de celui où l'utilisatrice
// pince réellement. Même patron déjà en place dans ce fichier pour `onPreviewClick`, qui lit
// lui aussi `previewCanvas.value.getBoundingClientRect()` pour la même raison.
function startPinch() {
  const pts = [...activePreviewPointers.values()]
  pinchActive = true
  pinchStartDist = pointerDistance(pts) || 1
  pinchStartScale = zoomScale.value
  const frame = previewCanvas.value
  if (frame) {
    const rect = frame.getBoundingClientRect()
    const midX = (pts[0].x + pts[1].x) / 2
    const midY = (pts[0].y + pts[1].y) / 2
    zoomOriginX.value = clamp(((midX - rect.left) / rect.width) * 100, 0, 100)
    zoomOriginY.value = clamp(((midY - rect.top) / rect.height) * 100, 0, 100)
  }
}

function updatePinch() {
  const pts = [...activePreviewPointers.values()]
  const dist = pointerDistance(pts)
  zoomScale.value = clamp(pinchStartScale * (dist / pinchStartDist), 1, 3)
}

function endPinch() {
  pinchActive = false
  if (zoomScale.value < 1.05) {
    zoomScale.value = 1
    panX.value = 0
    panY.value = 0
  }
}

// Débattement maximal du panoramique en X/Y, à partir de la taille NON zoomée du cadre
// (`previewFrameStyle`, des chaînes `"123px"`) et de l'échelle courante. Approximation qui
// suppose un zoom centré, alors que `zoomOriginX`/`zoomOriginY` ancre le zoom au point du
// pincement (le débattement réel n'est donc pas parfaitement symétrique autour d'un point de
// pincement excentré) — suffisante pour empêcher l'image de sortir complètement du cadre dans
// le cas courant, pas un système de contraintes pixel-parfait.
function panBounds() {
  const w = parseFloat(previewFrameStyle.value.width) || 0
  const h = parseFloat(previewFrameStyle.value.height) || 0
  const overflow = Math.max(0, zoomScale.value - 1)
  return { x: (w * overflow) / 2, y: (h * overflow) / 2 }
}

function startPan(e) {
  panActive = true
  panStartClientX = e.clientX
  panStartClientY = e.clientY
  panStartX = panX.value
  panStartY = panY.value
}
function updatePan(e) {
  const bounds = panBounds()
  panX.value = clamp(panStartX + (e.clientX - panStartClientX), -bounds.x, bounds.x)
  panY.value = clamp(panStartY + (e.clientY - panStartClientY), -bounds.y, bounds.y)
}
function endPan() {
  panActive = false
}
function cancelPan() {
  panActive = false
}

const previewZoomStyle = computed(() => ({
  transform: zoomScale.value === 1 ? '' : `translate(${panX.value}px, ${panY.value}px) scale(${zoomScale.value})`,
  transformOrigin: `${zoomOriginX.value}% ${zoomOriginY.value}%`,
}))

// Un zoom qui persisterait après un changement de gabarit n'aurait plus de sens visuel (cadre
// et contenu entièrement redessinés).
watch(templateKey, () => {
  zoomScale.value = 1
  panX.value = 0
  panY.value = 0
})

// Un pincement qui RÉDUIT le zoom sans repasser par 1 (ex. 2.5 -> 1.5) peut laisser un pan
// fait à plus fort zoom hors des nouvelles bornes, plus resserrées — reclampé à chaque
// changement d'échelle plutôt que seulement au relâché.
watch(zoomScale, () => {
  const bounds = panBounds()
  panX.value = clamp(panX.value, -bounds.x, bounds.x)
  panY.value = clamp(panY.value, -bounds.y, bounds.y)
})

// Bouton Partager persistant (bas de chaque onglet) : confirmation → génération (TOUJOURS —
// l'utilisatrice a pu modifier un réglage depuis la dernière génération, cf. `generate()`,
// qui remplace l'entrée précédente au lieu d'empiler) → partage OS.
async function confirmShare() {
  sharing.value = true
  try {
    const url = await generate()
    if (url) await shareImageDataUrl(url, { title: props.project.name, filename: `badge-${props.project.id}.jpg` })
  } finally {
    sharing.value = false
  }
}
</script>

<template>
  <div class="bdg" role="dialog" aria-modal="true" :aria-label="t('project.stats.badge.title')" @keydown="trapTabFocus">
    <div
      class="bdg__preview-layer"
      ref="previewLayer"
      data-test="badge-preview-layer"
      :class="{ 'bdg__preview-layer--drawer-expanded': drawerExpanded }"
      :style="previewLayerStyle"
      @pointerdown="onPreviewPointerDown"
    >
      <div class="bdg__preview-frame" :style="[previewFrameStyle, previewZoomStyle]">
        <canvas
          ref="previewCanvas"
          class="bdg__preview"
          width="160"
          height="240"
          aria-hidden="true"
          @click="onPreviewClick"
        ></canvas>
        <button
          v-if="previewFixSlot"
          type="button"
          class="bdg__preview-fix"
          data-test="badge-preview-fix"
          :style="previewFixStyle"
          @click="onFixClick"
        >
          {{ t('project.stats.badge.editPhoto') }}
        </button>
      </div>
    </div>
    <button
      type="button"
      class="bdg__close-btn"
      data-test="badge-close"
      :aria-label="t('project.stats.badge.close')"
      @click="emit('close')"
    >
      <AppIcon name="close" :size="20" />
    </button>
    <button
      type="button"
      class="bdg__share-btn"
      data-test="badge-share"
      :disabled="sharing"
      @click="confirmShare"
    >
      {{ t('project.stats.badge.share') }}
    </button>

    <p v-if="resultUrl" class="bdg__saved-banner" data-test="badge-saved-banner">
      {{ t('project.stats.badge.saved') }}
    </p>

    <div
      class="bdg__drawer"
      ref="drawerEl"
      :class="{ 'bdg__drawer--expanded': drawerExpanded }"
      :style="dragHeight != null ? { height: `${dragHeight}px`, maxHeight: `${dragHeight}px`, transition: 'none' } : {}"
      data-test="badge-drawer"
    >
      <button
        type="button"
        class="bdg__drawer-handle"
        data-test="badge-drawer-handle"
        :aria-expanded="drawerExpanded"
        @click="toggleDrawer"
        @pointerdown="onDrawerHandlePointerDown"
      >
        <span class="bdg__drawer-grip" aria-hidden="true"></span>
        <span class="bdg__drawer-handle-label">
          {{ drawerExpanded ? t('project.stats.badge.drawerCollapse') : t('project.stats.badge.drawerExpand') }}
        </span>
      </button>
      <div
        class="bdg__drawer-body"
        :class="{ 'bdg__drawer-body--locked': !drawerExpanded }"
        ref="drawerBodyEl"
        data-test="badge-drawer-body"
        @pointerdown="onDrawerBodyPointerDown"
      >
        <div class="bdg__segmented" role="tablist">
          <button
            v-for="(key, i) in steps"
            :key="key"
            type="button"
            role="tab"
            class="bdg__segment"
            :class="{ 'bdg__segment--on': stepIndex === i }"
            :data-test="`badge-tab-${key}`"
            :aria-selected="stepIndex === i"
            @click="goToStep(i)"
          >
            {{ t(`project.stats.badge.step.${key}`) }}
          </button>
        </div>

        <section v-if="currentStep === 'format'" class="bdg__field" role="group" :aria-label="t('project.stats.badge.step.format')">
          <div class="bdg__templates">
            <button
              v-for="key in TEMPLATE_KEYS"
              :key="key"
              type="button"
              class="bdg__tpl"
              :class="{ 'bdg__tpl--on': templateKey === key }"
              @click="templateKey = key"
            >
              <AppIcon :name="TEMPLATE_ICON[key]" :size="28" />
              <span>{{ t(`project.stats.badge.template${key.charAt(0).toUpperCase()}${key.slice(1)}`) }}</span>
            </button>
          </div>
        </section>

        <section v-if="currentStep === 'color'" class="bdg__field" role="group" :aria-label="t('project.stats.badge.step.color')">
          <template v-if="settings.badgeColorHistory.length">
            <p class="bdg__subhead">{{ t('project.stats.badge.recentColors') }}</p>
            <div class="bdg__hues" data-test="badge-recent-hues">
              <button
                v-for="c in settings.badgeColorHistory"
                :key="c"
                type="button"
                class="bdg__hue"
                :class="{ 'bdg__hue--on': badgeColor === c }"
                :style="{ background: c }"
                :aria-label="t('project.stats.badge.recentColor')"
                :aria-pressed="badgeColor === c"
                @click="pickColor(c)"
              ></button>
            </div>
          </template>
          <div class="bdg__palette">
            <button
              v-for="c in COLOR_PALETTE"
              :key="c.key"
              type="button"
              class="bdg__palette-sw"
              :class="{ 'bdg__palette-sw--on': badgeColor === c.hsl }"
              :style="{ background: c.hsl }"
              :aria-label="c.key"
              :aria-pressed="badgeColor === c.hsl"
              @click="pickColor(c.hsl)"
            ></button>
            <button
              type="button"
              class="bdg__palette-custom"
              data-test="badge-color-custom"
              :aria-label="t('yarn.colorPickerTitle')"
              @click="colorPickerOpen = true"
            >
              <AppIcon name="plus" :size="18" />
            </button>
          </div>
        </section>

        <section v-if="currentStep === 'infos'" class="bdg__field" role="group" :aria-label="t('project.stats.badge.step.infos')">
          <p class="bdg__subhead">{{ t('project.stats.badge.statsToInclude') }}</p>
          <div class="bdg__pills">
            <button
              v-for="key in genericPillKeys"
              :key="key"
              type="button"
              class="bdg__pill"
              :data-test="`badge-stat-${key}`"
              :class="{ 'bdg__pill--on': selectedStats.includes(key) }"
              :aria-pressed="selectedStats.includes(key)"
              :aria-label="statAriaLabel(key)"
              @click="toggleStat(key)"
            >{{ statValueTexts[key] }}</button>
            <button
              v-if="project.technique"
              type="button"
              class="bdg__pill"
              data-test="badge-technique"
              :class="{ 'bdg__pill--on': includeTechnique }"
              :aria-pressed="includeTechnique"
              :aria-label="techniqueAriaLabel"
              @click="includeTechnique = !includeTechnique"
            >{{ techniqueValueText }}</button>
            <button
              v-if="hasCalendarData"
              type="button"
              class="bdg__pill"
              data-test="badge-calendar"
              :class="{ 'bdg__pill--on': includeCalendar }"
              :aria-pressed="includeCalendar"
              @click="includeCalendar = !includeCalendar"
            >{{ t('project.stats.badge.calendar') }}</button>
            <button
              v-if="yarnUsage.length"
              type="button"
              class="bdg__pill"
              data-test="badge-yarns"
              :class="{ 'bdg__pill--on': selectedStats.includes('yarns') }"
              :aria-pressed="selectedStats.includes('yarns')"
              :aria-label="yarnsAriaLabel"
              @click="toggleStat('yarns')"
            >{{ yarnsSummaryText }}</button>
          </div>
          <p class="bdg__subhead">{{ t('project.stats.badge.language') }}</p>
          <div class="bdg__languages">
            <button
              v-for="l in LANGUAGES"
              :key="l.code"
              type="button"
              class="bdg__lang"
              :class="{ 'bdg__lang--on': badgeLocale === l.code }"
              :aria-pressed="badgeLocale === l.code"
              @click="badgeLocale = l.code"
            >{{ l.label }}</button>
          </div>
          <p class="bdg__subhead">{{ t('project.stats.badge.textLabel') }}</p>
          <input
            v-model="badgeText"
            type="text"
            class="bdg__text-input"
            data-test="badge-text"
            maxlength="80"
            @keydown.enter.prevent="$event.target.blur()"
          />
        </section>
      </div>
    </div>

    <BadgePhotoPicker
      :open="photoPickerOpen"
      :photos="project.photos || []"
      @confirm="onPhotoPickerConfirm"
      @close="photoPickerOpen = false"
    />
    <!-- Enfant DIRECT de `.bdg`, jamais du tiroir, bien que son bouton d'ouverture vive dans
         l'onglet Couleur : `ColorPickerDialog` est `position: fixed; z-index: 85` SANS
         `<Teleport>`. Placé dans le tiroir (`position: absolute; z-index: 1`), son z-index se
         résolvait DANS le contexte d'empilement local du tiroir, donc SOUS les boutons flottants
         Fermer/Partager et la bannière « enregistré » (z-index: 2, enfants directs de `.bdg`),
         qui restaient cliquables par-dessus lui. Partager pendant un choix de couleur
         régénérait et enregistrait le badge, action destructrice par-dessus le sélecteur
         (revue finale de branche, 18/09). Ici, il partage le contexte d'empilement de ces
         boutons et passe devant eux. -->
    <ColorPickerDialog :open="colorPickerOpen" :color="badgeColor" @pick="onPickCustomColor" @close="colorPickerOpen = false" />
  </div>
</template>

<style scoped>
/* Vraie feuille plein écran, pas un bloc dans le flux : téléporté dans <body>, ce composant
   atterrissait APRÈS #app (min-height: 100dvh) et restait donc hors de vue pour une vraie
   utilisatrice — seul le défilement automatique du clic Playwright le masquait en test.
   z-index 1050 : échelle documentée dans App.vue (PhotoLightbox 1000 < composeur 1050 <
   PhotoCropper / ChartFullscreen / PhotoSourceSheet 1100 < dialogues système 1200). SOUS le
   recadreur, à dessein : choisir une photo ouvre le recadreur PAR-DESSUS cette feuille.
   Un seul niveau de `position: fixed` pour toute la feuille — un second `Teleport`/`fixed`
   imbriqué (tenté le 17/09 pour une loupe plein écran séparée, retirée depuis) composait mal
   sous WebView Android : le tiroir et les boutons flottants restent `position: absolute` À
   L'INTÉRIEUR de `.bdg`. */
.bdg {
  position: fixed;
  inset: 0;
  z-index: 1050;
  /* `var(--page)`, pas `var(--bg)` : `.bdg__preview-layer` (seul fond visible en pratique, cf.
     ci-dessous) porte `background: var(--page)`, et le tiroir (`.bdg__drawer`, `var(--bg)`) a
     des coins hauts arrondis. Avec `.bdg` en `var(--bg)`, ces coins arrondis laissaient voir
     `.bdg` en dessous dans une couleur IDENTIQUE à celle du tiroir lui-même : l'arrondi devenait
     invisible. */
  background: var(--page);
  overflow-y: hidden;
  /* Zones sûres : une surface `inset: 0` en edge-to-edge Android passe SOUS la barre de statut
     et sous la barre de navigation. Ici elles sont portées par CHAQUE enfant flottant
     (`.bdg__close-btn`/`.bdg__share-btn` en haut, `.bdg__drawer-body` en bas et sur les côtés),
     jamais par ce conteneur. Revue finale de branche (18/09) : le `padding` de zone sûre qui
     vivait ici était devenu nuisible, parce que le bloc englobant d'un descendant
     `position: absolute` est la boîte de PADDING de l'ancêtre positionné, pas sa boîte de
     bordure. Chaque enfant flottant se trouvait donc décalé de 16 px au moins, la zone sûre
     était comptée DEUX fois (une ici, une sur l'enfant qui porte déjà la sienne), et
     `.bdg__preview-layer` n'occupait plus tout l'écran, laissant un liseré de couleur visible
     sur trois bords. Même raison pour `display: flex`/`flex-direction`/`gap`, retirés avec :
     plus aucun enfant de `.bdg` n'est en flux normal depuis Task 7 (prévisu, tiroir, boutons et
     bannière sont tous `position: absolute`), un contexte flex ne gouvernait donc plus rien.
     `.bdg` reste `overflow-y: hidden` (plus `auto`) : le segmented control et les 3 anciennes
     sections ont migré dans `.bdg__drawer-body`, qui a désormais SEUL un `overflow-y: auto`
     dédié. Aucun contenu ne peut donc faire défiler les boutons flottants hors de vue, bug
     Pixel réel du 17/09 (onglet Infos sur petit écran), cf. rapport de Task 6. */
  overflow-x: hidden;
}
/* Boutons flottants, ABSOLUS dans `.bdg` (jamais un second `position: fixed` — cf. commentaire
   de tête du bloc `.bdg`) : toujours visibles, quel que soit l'état du tiroir en dessous. */
.bdg__close-btn {
  position: absolute;
  top: max(var(--sp-3), var(--sa-top));
  left: max(var(--sp-3), var(--sa-left));
  z-index: 2;
  width: 44px;
  height: 44px;
  border: none;
  border-radius: var(--r-pill);
  background: rgba(58, 46, 40, 0.32);
  color: #fff;
  display: grid;
  place-items: center;
}
.bdg__share-btn {
  position: absolute;
  top: max(var(--sp-3), var(--sa-top));
  right: max(var(--sp-3), var(--sa-right));
  z-index: 2;
  /* 14px de padding vertical (au lieu de `var(--sp-2)`, 8px) : avec la police de ce bouton, la
     cible tactile passe d'une trentaine de pixels à 44, plancher d'accessibilité (revue finale
     de branche, 18/09). `min-height` garde ce plancher même si la police rendue est plus
     petite que prévu ; c'est une sécurité, le padding fait le gros du travail. */
  min-height: 44px;
  padding: 14px var(--sp-4);
  border: none;
  border-radius: var(--r-pill);
  background: #fff;
  color: var(--brand);
  font-weight: 700;
  box-shadow: var(--e-2);
}
.bdg__share-btn:disabled {
  opacity: 0.6;
}
/* `position: sticky` dans `.bdg__drawer-body` (seul `overflow-y: auto` du tiroir, cf. son
   propre commentaire) : reste collé en haut pendant qu'on fait défiler le contenu de l'onglet
   en dessous (chips de stats, palette, langues…), au lieu de défiler lui-même hors de vue —
   retour Julien, 18/09, après le correctif du blocage à la frappe : impossible de changer
   d'onglet sans remonter tout en haut du tiroir déplié. `background: var(--surface)` couvre
   déjà toute la largeur disponible (aucune largeur explicite sur ce bloc flex, donc pleine
   largeur du contenu de `.bdg__drawer-body`), assez pour masquer le contenu qui défile dessous. */
.bdg__segmented {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  gap: 2px;
  background: var(--surface);
  border-radius: var(--r-pill);
  padding: 2px;
  margin: var(--sp-2) 0 var(--sp-3);
}
/* `min-height: 44px` + centrage flex : cible tactile au plancher d'accessibilité (revue finale
   de branche, 18/09). Le seul `padding: var(--sp-2) 0` sur une police de 0.8125rem donnait une
   trentaine de pixels de haut, sous le minimum. */
.bdg__segment {
  flex: 1;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--sp-2) 0;
  border-radius: var(--r-pill);
  background: none;
  border: none;
  color: var(--ink-55);
  font-weight: 700;
  font-size: 0.8125rem;
}
.bdg__segment--on {
  background: var(--brand);
  color: #fff;
}
/* Calque de prévisu (canevas + bouton « Modifier ») : `.bdg__preview-layer` couvre tout `.bdg`
   SAUF la bande occupée par le tiroir, dont il s'arrête au bord haut (`bottom`, doublet vh/dvh
   ci-dessous, basculé par la classe `.bdg__preview-layer--drawer-expanded` — cf. <script setup>
   et template), et centre `.bdg__preview-frame` par flexbox ; `background: var(--page)` comble
   l'espace résiduel des deux côtés avec le fond de l'app plutôt qu'un vide transparent.
   Historique (18/09) — deux tentatives CSS pures ont échoué, abandonnées :
   Round 1 : `object-fit: contain` sur un `<canvas>` en `width:100%;height:100%` laissait sa
   BOÎTE CSS couvrir tout le calque même quand son contenu peint était letterboxé —
   `getBoundingClientRect()` (utilisé par `onPreviewClick`) ignore `object-fit`.
   Round 2 : un centrage flex + `max-width/max-height: 100%` sur le canevas corrigeait
   `onPreviewClick`, mais PAS `previewFixStyle` (pourcentages CSS purs sur `.bdg__preview-fix`,
   dont le bloc englobant restait le calque plein écran). Correctif round 2 : envelopper le
   canevas dans `.bdg__preview-frame` (position: relative, `max-width/max-height: 100%`) pour
   que ce cadre devienne le bloc englobant — MAIS vérifié empiriquement (Playwright, voir
   rapport de tâche) que ça ne marche QUE si c'est la LARGEUR qui contraint le rendu (ratio
   badge > ratio écran) : quand c'est la HAUTEUR (écran plus large/court que le badge —
   rotation paysage, tablette portrait proche du carré), le `max-height: 100%` du CANEVAS se
   résout contre la hauteur du FRAME, elle-même indéfinie tant que son propre plafond n'est pas
   encore appliqué (dépendance circulaire de résolution de pourcentage CSS, CSS2.1 §10.5) — le
   canevas débordait du cadre de 50 à 128 px selon le viewport mesuré.
   Round 3 (même jour) : abandon de la contrainte « CSS pur, aucun JS » pour ce point précis —
   elle reposait sur une hypothèse CSS invalidée par la mesure, pas sur une exigence du plan.
   `previewFrameStyle` (voir <script setup>) calcule la taille du cadre en PIXELS déterministes
   via un contain-fit explicite (largeur ET hauteur comparées, jamais de dépendance circulaire),
   même principe que `canvasBoxStyle`/`fitWithinBox` (PhotoLightbox.vue) et que l'ancienne loupe
   plein écran retirée en Task 2. `.bdg__preview` (`width/height: 100%`) remplit alors
   exactement ce cadre déterministe ; `.bdg__preview-fix`, ancré en pourcentage de
   `.bdg__preview-frame` (position: relative), redevient correct dans TOUS les cas, largeur
   comme hauteur contrainte. */
.bdg__preview-layer {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--page);
  /* Même durée que `.bdg__drawer` : le badge se recadre en même temps que le tiroir coulisse,
     au lieu de sauter d'un coup à la fin. `bottom` ci-dessous écrase le `bottom: 0` d'`inset: 0`
     par cascade normale (règle plus tardive, même sélecteur) — pas besoin de retirer `inset: 0`,
     qui pose toujours `top`/`left`/`right`. DOUBLET vh/dvh, même motif que `.bdg__drawer`
     ci-dessous, `.menu` (AppHeader.vue) et `html, body, #app` (tokens.css) : repli nécessaire
     pour les WebView Android sans support `dvh` (< Chromium 108), qui invalident la déclaration
     `bottom` dans son ENTIER si elle contient une unité inconnue. */
  bottom: max(160px, 22vh);
  bottom: max(160px, 22dvh);
  transition: bottom 220ms ease;
  /* `touch-action: none` : même nécessité que `.bdg__drawer-handle` (cf. son propre
     commentaire) — le geste de glisser-tiroir ET le pincer-zoomer posés sur ce calque
     (`onPreviewPointerDown`, <script setup>) ne doivent jamais être interceptés par un
     pincer-zoom natif du navigateur ni par un défilement/rebond, sous peine de
     `pointercancel` intempestif sur un vrai appareil tactile (revue de tâche, 19/09). */
  touch-action: none;
}
.bdg__preview-layer--drawer-expanded {
  /* Synchronisé avec `.bdg__drawer--expanded` (18/09, relevé de 320px/48dvh à 420px/68dvh). */
  bottom: max(420px, 68vh);
  bottom: max(420px, 68dvh);
}
.bdg__preview-frame {
  position: relative;
  /* Accompagne le recadrage du badge quand `previewFrameStyle` change de valeur (bascule du
     tiroir, cf. <script setup>) : sans cette transition, le cadre — et donc le badge — sautait
     d'un coup à sa nouvelle taille au lieu de grandir/rétrécir en douceur (retour Julien,
     18/09 soir). Même durée que le tiroir, pour rester perçu comme un seul mouvement. */
  transition: width 220ms ease, height 220ms ease;
}
.bdg__preview {
  display: block;
  width: 100%;
  height: 100%;
  /* Ceinture et bretelles : `previewFrameStyle` donne déjà au cadre des pixels déterministes,
     mais tant que la première mesure n'a pas eu lieu (cadre encore sans taille), ces plafonds
     évitent un débordement bref du canevas hors du calque. Ce n'est PAS un retour à la piste
     CSS pure du round 2 décrite ci-dessus : ils ne dimensionnent rien, ils bornent. */
  max-width: 100%;
  max-height: 100%;
  cursor: pointer;
}
.bdg__preview-fix {
  position: absolute;
  transform: translate(-50%, -50%);
  padding: var(--sp-2) var(--sp-3);
  border-radius: 999px;
  border: none;
  background: var(--ink);
  color: var(--bg);
  font-weight: 600;
  box-shadow: var(--e-2);
}
.bdg__field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.bdg__subhead {
  margin: var(--sp-2) 0 0;
  font-weight: 600;
  color: var(--ink-55);
  font-size: 0.875rem;
}
.bdg__templates {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--sp-2);
}
.bdg__tpl {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-1);
  padding: var(--sp-2);
  border-radius: var(--r-md);
  background: var(--tile);
}
.bdg__tpl--on {
  outline: 2px solid var(--brand);
}
/* Pastilles de teinte : copie locale du motif .accent-swatch de SettingsView.vue (styles
   `scoped`, rien à importer d'une vue). Toute retouche visuelle ici doit rester cohérente
   avec ce nuancier-là, qui reste la référence. */
.bdg__hues {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.bdg__hue {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 2px solid var(--line);
  padding: 0;
  cursor: pointer;
}
.bdg__hue--on {
  border-color: var(--ink);
  box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--ink);
}
.bdg__palette {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: var(--sp-2);
}
.bdg__palette-sw,
.bdg__palette-custom {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 2px solid var(--line);
  padding: 0;
  cursor: pointer;
}
.bdg__palette-sw--on {
  border-color: var(--ink);
  box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--ink);
}
.bdg__palette-custom {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--tile);
  color: var(--ink);
}
.bdg__pills {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.bdg__pill {
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-md);
  background: var(--tile);
  border: 2px solid transparent;
  color: var(--ink);
}
.bdg__pill--on {
  background: var(--ink);
  color: var(--bg);
  border-color: var(--ink);
}
.bdg__saved-banner {
  position: absolute;
  top: max(64px, calc(var(--sa-top) + 56px));
  left: 50%;
  transform: translateX(-50%);
  z-index: 2;
  margin: 0;
  padding: var(--sp-2) var(--sp-4);
  border-radius: var(--r-pill);
  background: var(--ink);
  color: #fff;
  font-weight: 600;
  font-size: 0.8125rem;
  box-shadow: var(--e-2);
}
.bdg__text-input {
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-md);
  border: 1px solid var(--line);
  background: var(--tile);
  color: var(--ink);
  font: inherit;
}
.bdg__languages {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.bdg__lang {
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-md);
  background: var(--tile);
  border: 2px solid transparent;
}
.bdg__lang--on {
  border-color: var(--brand);
}
/* Tiroir bas : `position: absolute` DANS `.bdg` (position: fixed) — jamais un second niveau
   de `fixed` (cf. commentaire de tête du bloc `.bdg`). `left: 0; right: 0` bord à bord à
   dessein : c'est la FEUILLE elle-même (comme `.bdg`), pas son contenu — la zone sûre
   latérale est portée par `.bdg__drawer-body` ci-dessous, pas ici. `height: auto` : le tiroir
   grandit avec son contenu (ex. l'onglet Format, court, n'a pas besoin d'autant de place que
   l'onglet Infos) — retour Julien, 18/09 soir, après le premier relevé de la hauteur dépliée
   fixe : « c'est bien pour un maximum, si le contenu tient sur une hauteur plus petite, il
   faut s'adapter ». `max-height` plafonne ce contenu (au lieu d'une `height` fixe) : PLANCHER
   replié / PLAFOND déplié, proportions reprises de la maquette (220px/1040px replié ≈ 21 %,
   480px/1040px déplié ≈ 46 %) traduites en hauteur de viewport dynamique (`dvh`, stable au
   clavier virtuel/à la barre d'adresse mobile), avec un minimum en px pour que la poignée + le
   segmented control (Task 6) restent toujours entièrement visibles même sur un écran bas.
   DOUBLET vh/dvh, même motif que `.menu` (AppHeader.vue) et `html, body, #app` (tokens.css) :
   la WebView du Huawei (sans GMS, < Chromium 108) ignore `dvh`, et une déclaration qui
   contient une unité inconnue est INVALIDE dans son ENTIER (pas juste l'unité) — sans la 1re
   ligne (`vh`) en repli, le plafond retomberait à `none` et la bascule replié/déplié
   perdrait tout son sens sur cette classe d'appareils. `transition` porte sur `max-height`
   (jamais `height`, qui vaut `auto` et ne s'anime pas) : suffisant pour une animation fluide
   puisque c'est `max-height` qui borne le rendu dans les deux états. Pendant un glisser de la
   poignée (`dragHeight` non nul, cf. <script setup>), un style inline écrase `height` ET
   `max-height` par la même valeur en px suivie en direct, `transition: none` pour coller au
   doigt sans latence — la transition CSS ci-dessous ne reprend qu'au relâché. */
.bdg__drawer {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1;
  background: var(--bg);
  border-radius: var(--r-lg) var(--r-lg) 0 0;
  box-shadow: var(--e-3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: auto;
  max-height: max(160px, 22vh);
  max-height: max(160px, 22dvh);
  transition: max-height 220ms ease;
}
.bdg__drawer--expanded {
  /* Plafond relevé de 320px/48dvh à 420px/68dvh (retour Julien, 18/09) — garde un plancher
     d'environ 30% de la hauteur d'écran pour la prévisu du badge au-dessus, jamais 0 (cf.
     contrainte du plan « ne jamais masquer la prévisu »). DOIT rester synchronisé avec
     `.bdg__preview-layer--drawer-expanded` ci-dessous ET avec `drawerMaxHeight()` dans
     <script setup> (bornes du geste de glissement). */
  max-height: max(420px, 68vh);
  max-height: max(420px, 68dvh);
}
.bdg__drawer-handle {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-1);
  padding: var(--sp-2) 0;
  background: none;
  border: none;
  color: var(--ink-55);
  /* `touch-action: none` : le geste de glissement (pointermove sur `window`, cf. <script
     setup>) ne doit jamais être intercepté par un défilement/rebond natif du navigateur —
     cette poignée n'est de toute façon PAS dans la zone scrollable (`.bdg__drawer-body`,
     sibling). `cursor: grab` : affordance visuelle sur pointeur souris/trackpad. */
  touch-action: none;
  cursor: grab;
}
.bdg__drawer-grip {
  width: 40px;
  height: 5px;
  border-radius: var(--r-pill);
  background: var(--line);
}
.bdg__drawer-handle-label {
  font-size: 0.75rem;
  font-weight: 600;
}
.bdg__drawer-body {
  /* `flex: 1 1 auto` (pas le raccourci `flex: 1`, qui vaut `1 1 0%`) : `.bdg__drawer` étant
     désormais `height: auto` (cf. son propre commentaire), ce conteneur doit prendre la
     taille de SON CONTENU par défaut pour que le tiroir grandisse en conséquence — avec une
     base `0%`, un conteneur parent à hauteur indéfinie retombe déjà sur ce même comportement
     par la spec flexbox (résolution en `content` quand la base est un pourcentage et la taille
     du conteneur indéfinie), mais l'écrire explicitement évite de dépendre de cette subtilité
     sur d'éventuelles WebView anciennes. `flex-shrink: 1` (inclus dans `auto`) laisse toujours
     ce conteneur se réduire à la hauteur disponible restante une fois `.bdg` en hauteur FIXE
     (replié, cf. `.bdg__drawer`) — comportement inchangé dans ce cas. */
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  /* Zone sûre sur les 3 côtés qui touchent un bord d'écran (le haut appartient à la poignée,
     jamais au corps) : seul CE conteneur porte l'inset, `.bdg__drawer` reste bord à bord
     (cf. son propre commentaire ci-dessus) — sans quoi le contenu (poignée déjà correcte,
     mais surtout le segmented control de la Task 6) déborderait sous l'encoche en paysage. */
  padding: 0 max(var(--sp-4), var(--sa-right)) max(var(--sp-4), var(--sa-bottom)) max(var(--sp-4), var(--sa-left));
}
.bdg__drawer-body--locked {
  /* Tiroir replié : plus de défilement natif du corps (Format/Couleur/Infos) — un glisser vers
     le bas ouvrait déjà le redimensionnement via `onDrawerBodyPointerMoveCandidate` (cf. son
     commentaire), mais le défilement natif restait actif en parallèle et entrait en compétition
     avec la transition de hauteur du tiroir (rebond visible sur l'onglet Format, dont le
     contenu tient déjà en entier replié). `touch-action: none` en plus de `overflow: hidden` :
     empêche aussi le pan natif Android WebView, pas seulement le scroll CSS. */
  overflow: hidden;
  touch-action: none;
}
</style>
