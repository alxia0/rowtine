<script setup>
// Écran de correction post-import : héberge l'éditeur zone-de-texte
// (ReaderTextEditor) sur le Rowtine-MD dérivé du reader (readerToEditable) —
// charge → édite le texte → enregistre (editableToReader). L'étiquetage
// par catégorie (menus kind, Section…) vit désormais DANS l'éditeur (barre CM6) ;
// l'ancienne UI <select> par-section est retirée.
//
// TOGGLE DIAGRAMME (capacité livrée + device-validée, cf.
// reader-correction.js — NE PAS la supprimer) : le dialecte Rowtine-MD ne
// représente pas la bascule interactif↔image dans le texte (c'est structurel :
// kind + forme des steps + présence de `chart`), donc elle ne peut PAS passer par
// l'éditeur de texte. Une bande compacte sous l'éditeur, dérivée de `baseReader`
// (jamais du texte en cours d'édition), liste chaque section chart-éligible et
// bascule un « pending op » (promote/demote) tenu par EMPREINTE IMAGE
// (photoFileName(chart.img|imgs[0]) — même clé robuste que reattachCharts,
// @/utils/pattern-md/reader-editable.js) : cette clé survit au renommage/réordre de
// la section par l'édition texte, contrairement à `section.id` (recalculé au
// reparse = slug du NOUVEAU titre, cf. normalizeReaderForSave). À l'enregistrement,
// chaque op en attente est appliquée sur le reader reparsé en retrouvant la
// section par cette même empreinte, PUIS promoteImageToChart/demoteChartToImage
// (transforms purs) l'exécutent réellement.
//
// RÉCONCILIATION D'ÉTAT (mi-projet) : `readerState` (coches/compteurs/grilles) vit
// sur le PROJET (project.readerState), jamais sur le patron (cf. ReaderView.vue).
// On mirror exactement le flux de re-synchro MD (src/backup/patron-md-sync.js,
// `reconcileProgress`) : patron FORKÉ pour un projet (pattern.ownerProjectId) → un
// seul projet concerné ; patron de bibliothèque partagé (pas de fork) → fan-out
// vers TOUS les projets qui le pointent (patternId === pattern.id). Chaque
// reconciliation tourne AVANT l'écrasement du reader (baseReader sert de
// référence), les rapports sont agrégés puis surfacés via le MÊME dialogue que la
// re-synchro (syncReportStore + SyncReportDialog, montée globalement dans
// App.vue) — jamais silencieux, jamais une 2ᵉ UI dupliquée pour dire la même chose.
//
// LIMITE CONNUE (décision 18/07) : contrairement à l'empreinte image
// (ci-dessus, stable au renommage/réordre), l'état de progression transféré par
// reconcileReaderState est clé par `section.id` — recalculé au reparse = slug du
// NOUVEAU titre (cf. tête de fichier). Renommer une section-diagramme le fait donc
// changer, ce qui réinitialise sa progression : le report le compte comme perte,
// surfacé dans CE MÊME dialogue de reconcile (jamais silencieux), identique au
// comportement de la re-synchro. Raffinement « clé d'état plus stable » écarté :
// risque de casser la progression des projets en cours > bénéfice cosmétique.
import { ref, computed, onMounted, nextTick, defineAsyncComponent } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AppHeader from '@/components/AppHeader.vue'
import AppIcon from '@/components/AppIcon.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import CorrectionHelp from '@/components/CorrectionHelp.vue'
import FieldHelp from '@/components/FieldHelp.vue'
import ReaderTextEditor from '@/components/ReaderTextEditor.vue'
import SkeletonScreen from '@/components/SkeletonScreen.vue'
import { openMenuPopover } from '@/components/cm/cm-editor'
import { useSmartBack } from '@/composables/useSmartBack'
import { usePatternsStore } from '@/stores/patterns'
import { useProjectsStore } from '@/stores/projects'
import { useSnackbarStore } from '@/stores/snackbar'
import { useSyncReportStore } from '@/stores/sync-report'
import { db, plain } from '@/db/db'
import { isMergedEntryFlagged } from '@/backup/sync-report-decision'
import { readerToEditable, editableToReader } from '@/utils/pattern-md/reader-editable'
import {
  sectionCanPromote,
  sectionCanDemote,
  sectionImageSrc,
  promoteImageToChart,
  demoteChartToImage,
  demoteChartToGallery,
  appendGalleryImageAsChart,
} from '@/utils/reader-correction'
import { reconcileReaderState } from '@/backup/reconcile-reader-state'
import { aggregateReconcileReports } from '@/backup/patron-md-sync'
import { photoFileName } from '@/backup/naming'
import { pickImage, resizeDataUrl } from '@/utils/photo'
import { useCropperStore } from '@/stores/cropper'
import { W, WARNING_CODES } from '@/utils/pattern-md/warning-codes'
import { isDirty } from '@/utils/correction-dirty'
import { sectionTitleLabel, isSingleSize, slug } from '@/utils/reader'
import { normalizeReaderForSave, resizeReferenceSizeTable } from '@/utils/reader-edit'
import { stepLine, sectionLine, sectionTitleAtLine, imageAnchorLine } from '@/utils/pattern-md/step-line'
// Le PRÉFIXE de titre, jamais une regex `/^##\s+/` recopiée ici : md-line-type.js l'exporte
// précisément pour que la même syntaxe ne soit pas décrite à deux endroits (son commentaire
// de tête le dit — deux formes voisines dérivent au premier ajustement de dialecte, et
// l'éditeur cesse alors de réécrire ce que le parseur lira).
import { H2_PREFIXE_RE } from '@/utils/pattern-md/md-line-type'
import { assetImagePath } from '@/utils/pattern-md/resolve-images'
import { scrollBehavior } from '@/utils/scroll-behavior'
// Chargement différé (déviation assumée) : PdfPagePickerDialog
// embarque PdfViewer → pdfjs-dist (lourd, `new DOMMatrix()` au niveau module — absent de
// jsdom). CorrectionView est importé STATIQUEMENT par plusieurs fichiers de test sans
// rapport avec ce sujet (CorrectionView.spec.js lui-même, CorrectionView-reveal.spec.js,
// reader-remaining-french-display-sites.spec.js) : un import statique y aurait fait
// planter `ReferenceError: DOMMatrix is not defined` dès l'import, même sans patron PDF.
// Chargé seulement si le patron a un PDF (v-if="pattern?.pdf" plus bas, le composant n'est
// même pas instancié sinon) — même pattern que ProjectPdfGallery.vue (PdfViewer) et
// PatternForm.vue (ce même composant).
const PdfPagePickerDialog = defineAsyncComponent(() => import('@/components/PdfPagePickerDialog.vue'))

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const goBack = useSmartBack()
const patternsStore = usePatternsStore()
const projectsStore = useProjectsStore()
const snackbar = useSnackbarStore()
const syncReportStore = useSyncReportStore()
const cropper = useCropperStore()

const pattern = ref(null)
const loading = ref(true) // squelette tant que patternsStore.get() n'a pas résolu (dans le cadre des travaux d'UX de correction)
const baseReader = ref(null) // snapshot durable de l'import : data-URLs + charts d'origine, jamais muté ni réassigné
// État de travail des diagrammes/images (retour terrain 27/08/2026, actions immédiates) :
// clone de `baseReader` posé à l'ouverture, muté DIRECTEMENT par les 4 gestes qui déplacent
// une image entre texte/diagramme/galerie — remplace `pendingOps`/`pendingGalleryPromotions`,
// de simples intentions posées en mémoire jusqu'ici. `baseReader`, lui, reste la photo
// IMMUABLE de l'import (ancre de `reconcileReaderState` et de la garde de sortie).
const workingReader = ref(null)
// Marqueur de nouveauté EXPLICITE (un correctif, revue finale du 27/08/2026) : ids des
// sections ajoutées à `workingReader` par `promoteGalleryImage` DANS CETTE SESSION — le
// SEUL producteur de sections neuves. `reconcileWorkingReaderOnSave` s'appuyait auparavant
// sur `!baseIds.has(id)` pour deviner qu'une section était neuve, une déduction FAUSSE :
// `nextDiagramSection` (reader-correction.js) numérote/dédoublonne les ids en ne regardant
// QUE `workingReader`, donc un id libéré par « Envoyer vers la galerie » (section retirée
// ENTIÈREMENT, cf. demoteChartToGallery) peut être RÉÉMIS pour une section neuve — auquel
// cas ce même id est encore présent dans `baseIds` et la déduction se trompait, classant la
// section neuve comme "pas neuve", perdant l'image PROMUE en la faisant passer par le
// chemin de réconciliation par empreinte (qui ne la retrouve jamais dans le reparse frais,
// puisqu'elle n'a jamais existé dans draftMd). Pas de retrait explicite d'un id une fois
// posé : si la section correspondante disparaît ensuite d'un autre geste (ex. promue PUIS
// renvoyée en galerie), elle disparaît aussi de `workingReader.value.sections` — les deux
// lectures de ce set (reconcileWorkingReaderOnSave, plus bas) ne filtrent QUE les sections
// encore présentes, un id orphelin dans le set n'a donc aucun effet. Remis à zéro après un
// Enregistrer réussi (cf. onSave) par hygiène, bien que la vue navigue ensuite (router.back()).
const newSectionIds = ref(new Set())
const draftMd = ref('') // SEULE source de vérité du texte (catégories/ordre/contenu)
const images = ref({})
const mdInitial = ref('') // snapshot du texte à l'ouverture : sert de référence à la garde « modifs non enregistrées »
const showDiscard = ref(false)
const confirmedLeave = ref(false) // levé juste avant un router.back() volontaire (Enregistrer/Quitter) pour ne pas re-déclencher la garde
const chartsOpen = ref(false) // bande « Diagrammes de ce patron » repliée par défaut
const galleryOpen = ref(false) // bande « Galerie du patron », repliée par défaut, même convention que chartsOpen
const editorRef = ref(null)
const chartStripRef = ref(null) // section .chart-strip (bouton + liste) : cible du scrollIntoView au dépli, cf. toggleCharts
const galleryStripRef = ref(null) // section .gallery-strip : pas de scroll-rattrapage dédié pour l'instant (liste courte, pas de barre d'action recouvrante mesurée à ce jour)
const actionsRef = ref(null) // barre .correct__actions : sa hauteur MESURÉE pilote scrollMarginBottom, cf. toggleCharts

// Tailles du patron, éditables ICI parce que c'est le seul écran où l'utilisatrice voit le
// tableau des tailles se reconstruire. Elles fixent le nombre de colonnes attendu par le
// parseur (`n`, cf. refblocks.js) : sans ce champ, une table cassée à l'import restait
// irréparable (retour d'usage, 19/08/2026). Saisie libre « S, M, L », même convention que
// PatternForm.vue et ProjectEditView.vue.
const sizesText = ref('')
const sizesInitial = ref('') // snapshot à l'ouverture : entre dans la garde « modifs non enregistrées » (cf. dirty(), plus bas) au même titre que le texte de l'éditeur

// Liste dérivée, recalculée à chaque frappe : elle descend jusqu'au bouton
// « Aide mémoire > Tailles » (prop `sizeLabels`) pour qu'il émette le bon nombre de colonnes.
const sizeLabels = computed(() =>
  sizesText.value.split(',').map((s) => s.trim()).filter(Boolean)
)

// Tailles EFFECTIVES : celles du champ s'il est renseigné, sinon celles du reader. C'est
// exactement le repli de `normalizeReaderForSave` (reader-edit.js) et celui du front-matter
// minimal (fragment.js) — il est écrit ici aussi parce que le champ part désormais VIDE sur
// un patron mono-taille (cf. onMounted) : sans ça, le bouton « Aide mémoire > Tailles »
// émettrait la table à ZÉRO colonne (`| mesure |`) sur toute cette classe de patrons, au lieu
// de la seule colonne « valeur » du cas taille unique. Trois consommateurs, un seul repli.
const effectiveSizeLabels = computed(() =>
  sizeLabels.value.length ? sizeLabels.value : [...(baseReader.value?.sizeLabels || [])]
)

// Empreinte d'une section (image de chart, ou 1re image ancrée) : `null` si la
// section ne porte aucune image exploitable (jamais de throw, cf. reader-editable.js).
function sectionFingerprint(section) {
  const src = sectionImageSrc(section)
  return typeof src === 'string' && src ? photoFileName(src, 0) : null
}

onMounted(async () => {
  pattern.value = await patternsStore.get(route.params.id)
  if (!pattern.value) {
    router.replace({ name: 'library' })
    return
  }
  baseReader.value = pattern.value.reader || { sections: [] }
  workingReader.value = JSON.parse(JSON.stringify(baseReader.value))
  draftGallery.value = [...(pattern.value.gallery || [])]
  // Champ VIDE sur un patron mono-taille (correctif revue finale) : la sentinelle
  // « Taille unique » est une CHAÎNE FR GELÉE EN DONNÉE (isSingleSize, reader.js), pas un
  // libellé d'interface — l'afficher dans un champ de saisie invitait à la traduire. Une
  // utilisatrice germanophone qui la remplaçait par « Einheitsgröße » faisait basculer la
  // garde à faux, donc `pattern.sizes = ['Einheitsgröße']` : un sélecteur de taille fantôme
  // à un seul choix dans la bibliothèque, la fiche patron et la fiche projet — exactement la
  // régression que le commit précédent (fee1cccd) venait d'empêcher côté écriture, rentrée
  // par le clavier. Champ vide : le repli de `normalizeReaderForSave` conserve les
  // sizeLabels du reader, `dirty()` reste cohérent (sizesInitial vaut '' lui aussi), et
  // saisir de vraies tailles fonctionne normalement.
  sizesText.value = isSingleSize(baseReader.value.sizeLabels)
    ? ''
    : (baseReader.value.sizeLabels || []).join(', ')
  sizesInitial.value = sizesText.value
  const editable = readerToEditable(baseReader.value)
  draftMd.value = editable.md
  mdInitial.value = editable.md
  images.value = editable.images

  // Bascule le squelette AVANT le `nextTick` de la cible d'ouverture ci-dessous (dans le
  // cadre des travaux d'UX de correction) : `<main>` (et donc `editorRef`) n'est de toute façon gated QUE par
  // `pattern` (jamais par `loading` — cf. template, même convention que ProjectDetailView),
  // mais le poser ICI, avant tout `await`, garantit qu'un futur refactor qui ajouterait
  // `loading` à la condition du `<main>` ne casserait pas silencieusement `revealLine()`
  // (CorrectionView-reveal.spec.js couvre ce chemin en entier).
  loading.value = false

  // Cible d'ouverture : le lecteur désigne un bloc par
  // `?section=<id>&line=<position>`. DEUX paramètres, jamais un seul — la forme
  // `?step=corps#3` ne fonctionne pas, le `#` ouvre un fragment d'URL et la
  // requête s'arrête à `corps`.
  //
  // Repli EN CASCADE et SILENCIEUX : ligne introuvable → tête de la section ;
  // section introuvable → tête du document. Aucun message : c'est un confort
  // d'ouverture, jamais une promesse, et un avertissement ici inquiéterait sans
  // rien apprendre.
  //
  // `nextTick` : l'éditeur ne monte qu'une fois `pattern` chargé (`v-if` du
  // <main>), donc il n'existe pas encore à cet instant.
  //
  // `route.query?.` : un vrai vue-router garantit toujours `query` (au pire
  // `{}`), mais certains mocks de test (CorrectionView.spec.js) fournissent une
  // route sans cette clé — accès défensif, cohérent avec le repli silencieux
  // de cette section entière.
  const target = route.query?.section
  if (target) {
    // `stepLine`/`sectionLine` apparient par TITRE, pas par id (premier
    // correctif, 2026-08-21) : le Markdown ne porte que le titre, jamais l'id,
    // et un id ne dérive du titre que pour les patrons passés par
    // `normalizeReaderForSave` — faux pour les patrons de démonstration, aux
    // ids codés à la main. On retrouve donc la section par son id (celui que
    // l'URL porte réellement) puis on passe son TITRE aux helpers.
    //
    // ⚠️ Titre AMBIGU → aucune cible (deuxième passe, 2026-08-21). Deux
    // sections de même titre sont INDISCERNABLES dans le Markdown : viser le
    // titre retomberait toujours sur la PREMIÈRE occurrence, y compris quand
    // l'id demandé désigne la seconde (`corps` / `corps-1`,
    // normalizeReaderForSave). Un curseur posé dans la MAUVAISE section est
    // pire qu'aucune cible : l'échec silencieux (repli en tête de document)
    // se voit, une section homonyme plausible ne se voit pas — l'utilisatrice
    // pourrait corriger la mauvaise ligne sans le remarquer. Comparaison par
    // slug (pas par chaîne brute) pour rester cohérent avec
    // `findSectionIndex` (step-line.js).
    //
    // Repli sur `target` lui-même si la section n'existe plus dans
    // `baseReader` (patron modifié entre-temps) : `stepLine`/`sectionLine`
    // ne le retrouveront pas non plus, mais on ne lève jamais — même repli
    // silencieux qu'avant.
    const sec = baseReader.value?.sections?.find((s) => s.id === target)
    const sectionTitle = sec?.title ?? target
    const titleSlug = slug(sectionTitle)
    const duplicateTitle =
      (baseReader.value?.sections || []).filter((s) => slug(s.title) === titleSlug).length > 1
    const index = Number(route.query?.line)
    const line = duplicateTitle
      ? 1
      : (Number.isInteger(index) ? stepLine(draftMd.value, sectionTitle, index) : null) ??
        sectionLine(draftMd.value, sectionTitle) ??
        1
    await nextTick()
    editorRef.value?.revealLine(line)
  }
})

// Galerie du patron (pattern.gallery) : brouillon local, ajout/suppression IMMÉDIATS sur
// ce tableau (comme form.photos dans PatternForm.vue) — contrairement aux diagrammes du
// texte, la galerie ne dépend d'AUCUN reparsing du Markdown, donc pas besoin d'un journal
// d'opérations réconcilié après coup : le brouillon EST déjà l'état à écrire. Rien n'est
// persisté avant l'Enregistrer (cf. onSave). Initialisé une fois `pattern` chargé — cf.
// l'ajout ci-dessous dans onMounted.
const draftGallery = ref([])

const galleryRows = computed(() =>
  draftGallery.value.map((g, idx) => ({ idx, src: g.src, page: g.page }))
)

// Promotion galerie→diagramme — IMMÉDIATE (retour terrain 27/08/2026) : ajoute la nouvelle
// section « Diagramme N » à `workingReader` ET retire l'image de `draftGallery`, dans le
// même geste — visible tout de suite dans le panneau Diagrammes, sans Enregistrer.
// Mute `workingReader.value` DIRECTEMENT (premier correctif) :
// plus de reparse ici — chaque geste (celui-ci comme les 3 du panneau Diagrammes)
// tient `workingReader` à jour en continu, donc la numérotation « Diagramme N »
// (nextDiagramSection, reader-correction.js) voit déjà les sections issues des gestes
// précédents. Limite ASSUMÉE, cohérente avec le reste du mécanisme : une section
// tapée à la main dans le texte APRÈS l'ouverture (nouveau `## Diagramme…` saisi au clavier)
// n'apparaît dans `workingReader` qu'à l'Enregistrer (reconciliation), pas avant — même
// compromis que pour les 3 gestes, pas une régression propre à ce geste-ci.
// ⚠️ Conséquence (constaté en revue) : la numérotation « Diagramme N » suit désormais l'ORDRE
// DES CLICS, plus l'ordre de la galerie — avant, une clé d'index croissant (`pendingGalleryPromotions`)
// garantissait l'ordre de la galerie quel que soit l'ordre des clics. Compromis assumé, pas
// une régression : renuméroter par ordre de galerie À L'ENREGISTRER ferait afficher
// « Diagramme 1 » dans le panneau au clic puis le renommer silencieusement après coup —
// contredirait l'invariant central de ce mécanisme (ce qui s'affiche immédiatement EST ce
// qui se sauvegarde).
function promoteGalleryImage(idx, shape) {
  if (!Number.isInteger(idx)) return
  const g = draftGallery.value[idx]
  if (!g) return
  const next = appendGalleryImageAsChart(workingReader.value, g.src, shape)
  // Marque explicitement la section fraîchement ajoutée comme NEUVE (correctif C1) — toujours
  // la DERNIÈRE de `next.sections`, cf. appendGalleryImageAsChart (reader-correction.js).
  const added = next.sections[next.sections.length - 1]
  if (added?.id) newSectionIds.value = new Set(newSectionIds.value).add(added.id)
  workingReader.value = next
  draftGallery.value = draftGallery.value.filter((_, i) => i !== idx)
}

// Sous-popover de type — MÊME mécanisme que openPanelShapeMenu (panneau Diagrammes,
// ci-dessus) : chartShapeMenuItems/shapeFromUiValue/uiValueFromShape réutilisés tels
// quels, aucune structure de type dupliquée pour la galerie. Pas de présélection (3e état
// documenté d'openMenuPopover) : une promotion immédiate n'a pas de « type actuel ».
function openGalleryShapeMenu(row, anchorEl) {
  openMenuPopover(anchorEl, chartShapeMenuItems(), (uiValue) => promoteGalleryImage(row.idx, shapeFromUiValue(uiValue)))
}

// TROIS sources (retour terrain 25/08/2026, sources d'image élargies — même logique que
// PatternForm.vue) : caméra/galerie (inchangé), fichiers (sélecteur système, redimensionné
// via resizeDataUrl puisqu'il ne passe pas par le plugin natif qui réduit déjà côté Android),
// PDF du patron (SEULE source qui recadre — une page de PDF couvre presque toujours plus que
// le seul diagramme visé). Toutes poussent en QUEUE, en fin de tableau.
function pushDraftGalleryImage(dataUrl) {
  draftGallery.value = [...draftGallery.value, { src: dataUrl, page: 0, w: 0, h: 0 }]
}
async function addGalleryImage() {
  const dataUrl = await pickImage()
  if (dataUrl) pushDraftGalleryImage(dataUrl)
}
const galleryFileInputRef = ref(null)
function openGalleryFilePicker() {
  galleryFileInputRef.value?.click()
}
async function onGalleryFilePicked(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) {
    snackbar.show(t('patternExtras.pickError'))
    return
  }
  try {
    const reader = new FileReader()
    const raw = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
    const resized = await resizeDataUrl(raw, 1280, 0.8)
    pushDraftGalleryImage(resized)
  } catch {
    snackbar.show(t('patternExtras.pickError'))
  }
}
const galleryPdfPickerOpen = ref(false)
function openGalleryPdfPicker() {
  galleryPdfPickerOpen.value = true
}
async function onGalleryPdfPagePicked(pageDataUrl) {
  try {
    const cropped = await cropper.crop(pageDataUrl)
    if (cropped) pushDraftGalleryImage(cropped)
  } catch {
    snackbar.show(t('patternExtras.pickError'))
  }
}

// UN bouton, un menu (retour terrain 26/08/2026) : les trois sources occupaient trois boutons
// pleine largeur en bas d'un écran déjà chargé (éditeur + panneau Diagrammes + barre d'action
// collante), alors que deux d'entre elles sont rares. `openMenuPopover` est le mécanisme de
// menu DÉJÀ en place ici (sous-popovers de type, panneau et galerie) — pas un second.
//
// AUCUN `selectedValue` passé : c'est le 3e état documenté de openMenuPopover (« ce popover
// ne porte pas de notion de sélection »), le bon pour un menu d'ACTIONS — sinon une coche
// viendrait s'afficher devant des entrées qui ne représentent aucun état.
//
// L'entrée PDF n'est construite que si le patron en porte un, exactement comme le `v-if` du
// bouton qu'elle remplace : une entrée grisée ne dirait rien de plus qu'une entrée absente.
function galleryAddMenuItems() {
  const items = [
    { value: 'camera', label: t('patternExtras.addImageCamera') },
    { value: 'files', label: t('patternExtras.addImageFiles') },
  ]
  if (pattern.value?.pdf) items.push({ value: 'pdf', label: t('patternExtras.addImagePdf') })
  return items
}
function openGalleryAddMenu(anchorEl) {
  openMenuPopover(anchorEl, galleryAddMenuItems(), (value) => {
    if (value === 'camera') addGalleryImage()
    else if (value === 'files') openGalleryFilePicker()
    else if (value === 'pdf') openGalleryPdfPicker()
  })
}

function removeGalleryImage(idx) {
  draftGallery.value = draftGallery.value.filter((_, i) => i !== idx)
}

async function toggleGallery() {
  galleryOpen.value = !galleryOpen.value
}

// Ligne (1-based) après laquelle une image de galerie s'ancrerait si on l'insérait
// maintenant — `null` tant que le curseur n'a aucun rang/étape au-dessus de lui dans sa
// section (cf. imageAnchorLine, step-line.js) : commande l'état désactivé du bouton
// « Insérer dans le texte » de la bande galerie, PARTAGÉ par toutes ses lignes (l'endroit
// visé dépend du curseur, pas de l'image choisie). Gardé par `galleryOpen` : sans lui,
// `imageAnchorLine` reparcourrait tout `draftMd` à CHAQUE frappe même galerie repliée (le
// seul rendu qui le lit, le bouton, est de toute façon absent tant qu'elle l'est).
const galleryInsertLine = computed(() => (galleryOpen.value ? imageAnchorLine(draftMd.value, cursorLine.value) : null))

// Insertion d'une image de galerie DANS LE TEXTE (retour terrain 27/08/2026, distinct de
// « Suivre comme diagramme » : IMMÉDIAT, comme une frappe — pas une pendingOp différée à
// l'Enregistrer). `images.value` (map chemin -> data-URL de l'éditeur) est mise à jour ICI :
// c'est elle qu'onSave transmet en `opts.extraImages` à editableToReader plus bas, seul
// moyen pour cette image — jamais ancrée dans baseReader — de survivre au reparse.
function insertGalleryImageIntoText(row) {
  const targetLine = galleryInsertLine.value
  if (!targetLine) return
  const g = draftGallery.value[row.idx]
  if (!g) return
  const mdPath = assetImagePath(g.src)
  const ok = editorRef.value?.insertImageLine(targetLine, mdPath, g.src)
  if (!ok) return
  images.value.set(mdPath, g.src)
  removeGalleryImage(row.idx)
}

// Bande « Diagrammes de ce patron » : chaque section chart-éligible de
// baseReader (déjà diagramme OU image promouvable), avec son état EFFECTIF
// (état de base d'origine, retourné par un pending op le cas échéant).
// `img` (vignette) : sectionImageSrc renvoie chart.img ou la 1re image ancrée.
//
// Sections INCOMPLÈTES (retour terrain 24/08/2026, Huawei « Dragon Scale Shawl ») :
// kind:'diagramme' mais ni chart exploitable (sectionCanDemote) ni image promouvable
// (sectionCanPromote) — cause encore non élucidée (import mal classé, ou corruption),
// mais jusqu'ici INVISIBLES ici (le `continue` les sautait en silence), donc
// impossible à retrouver. `broken:true` les signale au lieu de les cacher — aucune
// action de promotion/démotion ne leur est proposée (rien d'exploitable dessus), juste
// un renvoi vers leur ligne dans le texte (goToBrokenSection) pour les corriger à la main.
const chartStripRows = computed(() => {
  const out = []
  for (const sec of workingReader.value?.sections || []) {
    const isChart = sectionCanDemote(sec)
    if (!isChart && !sectionCanPromote(sec)) {
      if (sec.kind === 'diagramme') out.push({ id: sec.id, title: sec.title, broken: true })
      continue
    }
    const fingerprint = sectionFingerprint(sec)
    // `title` EFFECTIF, jamais `sec.title` brut : un renommage a déjà réécrit la ligne de
    // titre dans `draftMd`, et TOUS les appariements de ce fichier (onCursorLine,
    // chartRowAtLine, goToBrokenSection) comparent `slug(row.title)` au titre lu DANS le
    // texte. Garder l'ancien titre de `workingReader` ferait donc mourir, juste après un
    // renommage, le surlignage de la rangée ET le menu du clic-image de cette section.
    const title = (fingerprint && renames.value[fingerprint]) || sec.title
    // `renamed` (lot « clé stable », T3) : distingue un titre choisi par la travailleuse
    // via CE panneau d'un titre encore brut. Nécessaire parce que `sec.id` (ci-dessus)
    // n'est PAS resynchronisé au renommage — seule `renames` l'est, immédiatement — donc
    // `id === 'presentation'` peut rester vrai après un renommage jusqu'au reparse
    // suivant. `sectionTitleLabel` (reader.js) doit alors ignorer `id` pour ne pas
    // retraduire un titre déjà choisi en « Présentation » (cf. site d'appel ci-dessous).
    const renamed = !!(fingerprint && renames.value[fingerprint])
    out.push({ id: sec.id, title, renamed, broken: false, img: sectionImageSrc(sec), fingerprint, isChart, shape: isChart ? sec.chart?.shape : undefined })
  }
  return out
})

// Ce que le PANNEAU affiche, par opposition à ce que `chartStripRows` RÉSOUT (retour terrain
// 26/08/2026, Huawei « Dragon Scale Shawl ») : le panneau annonçait « Diagrammes (4) » sur un
// patron qui n'en compte que 3 — la 4e ligne était une simple image du texte (« Présentation »),
// listée là parce qu'elle est PROMOUVABLE. Deux torts d'un coup : le décompte mentait, et sa
// pastille d'état « Juste une image » se lisait comme un bouton désactivé.
//
// Filtre d'AFFICHAGE seulement — `chartStripRows` reste intact, et c'est vital : ce computed
// est AUSSI la table de résolution de `chartRowAtLine` (donc de imageMenuInfo/setImageShape/
// demoteImageAtLine/sendChartToGalleryAtLine) et de `onCursorLine`. Y appliquer le filtre à la
// source rendrait `imageMenuInfo` nul sur toute image non encore diagramme : le menu du
// clic-image — le SEUL chemin qui reste pour promouvoir une image du texte — mourrait en
// silence, exactement la capacité déjà livrée.
//
// `r.isChart` seul suffit désormais (retour terrain 27/08/2026, actions immédiates) : plus de
// distinction effectif/base — une section démotée SORT du panneau tout de suite (elle n'est
// plus un diagramme, pour de vrai), reste re-promouvable depuis le clic-image dans le texte.
const chartPanelRows = computed(() =>
  chartStripRows.value.filter((r) => r.broken || r.isChart)
)

// Action de la ligne « diagramme incomplet » : ramène le curseur sur la ligne de titre de
// cette section dans le texte — même mécanisme que la cible d'ouverture `?section=` (repli
// silencieux en tête de section/document, cf. onMounted) — pour que l'utilisatrice puisse
// corriger le titre et le type à la main via le sélecteur de kind déjà en place dans
// l'éditeur, sans qu'on invente un second mécanisme de réparation.
function goToBrokenSection(row) {
  const line = sectionLine(draftMd.value, row.title) ?? 1
  editorRef.value?.revealLine(line)
}

// RENOMMER UN DIAGRAMME (retour terrain 26/08/2026) — le nom d'un diagramme est le TITRE de
// sa section, et il ne vivait que dans le texte : le corriger obligeait à passer en
// « Modifier le texte » et à retrouver la bonne ligne `##`. Le panneau le fait maintenant
// directement, mais SANS second magasin de titres : `commitRename` réécrit la ligne de titre
// DANS l'éditeur (replaceLine, cf. ReaderTextEditor) — `draftMd` reste la seule source de
// vérité du texte, et le renommage traverse la même chaîne reparse → reconcile →
// avertissements que n'importe quelle frappe.
//
// `renames` (empreinte image -> nouveau titre, même clé que sectionFingerprint parce
// qu'elle survit au renommage/réordre, cf. tête de fichier) ne DOUBLE pas le texte : il ne
// sert qu'à garder `chartStripRows` — dérivé de workingReader, mis à jour au dernier geste
// image ou reparse, jamais à CHAQUE frappe — en phase avec le titre réellement présent dans
// draftMd, cf. le calcul de `title` ci-dessus.
//
// ⚠️ PERTE ANNONCÉE, PAS DÉCOUVERTE : la progression (coches/compteurs/grilles) est classée
// par `section.id` = slug du titre (limite documentée en tête de fichier, décision 18/07).
// Renommer la remet donc à zéro dans les projets en cours. Le dialogue de synchro le signale
// déjà APRÈS l'enregistrement ; le champ le dit AVANT (correction.renameProgressWarning),
// pour que le geste soit un choix et pas une découverte.
const renames = ref({})
const renamingId = ref(null) // id de la rangée dont le champ de renommage est ouvert, ou null
const renameDraft = ref('')
// Ref de FONCTION, pas `ref="…"` : le champ vit à l'intérieur du `v-for` du panneau, où Vue
// collecte les refs nommées dans un TABLEAU (dont l'ordre suit le rendu, pas la rangée visée).
// Une seule rangée porte le champ à la fois (v-if sur renamingId) : la fonction pose donc
// toujours l'élément courant, ou `null` à sa destruction.
const renameInputRef = ref(null)
function setRenameInput(el) {
  renameInputRef.value = el
}

function startRename(row) {
  renamingId.value = row.id
  // Le titre BRUT (donnée), pas `sectionTitleLabel(...)` : c'est exactement ce que porte la
  // ligne `##` du texte, et c'est ce que la frappe va y remplacer. Semer le champ avec un
  // libellé traduit ferait écrire la traduction dans la donnée au premier « Renommer » —
  // précisément le piège « un libellé affiché ne sert jamais de clé de données ».
  renameDraft.value = row.title
  nextTick(() => renameInputRef.value?.focus?.())
}

function cancelRename() {
  renamingId.value = null
  renameDraft.value = ''
}

// Réécrit le SEUL titre nu de la ligne `##`, en conservant tel quel le préfixe et tout ce qui
// suit — l'attribut de catégorie (`{sleeve}`) comme le compteur de répétition (`{×3}`) : les
// écraser ferait retomber la section en section de travail ordinaire (cf. md-line-type.js) ou
// perdrait silencieusement sa répétition. `null` si la ligne n'est pas le titre attendu (texte
// modifié entre-temps) : l'appelant renonce alors plutôt que d'écrire au hasard.
function renamedTitleLine(line, oldTitle, newTitle) {
  const m = H2_PREFIXE_RE.exec(String(line ?? ''))
  if (!m) return null
  const rest = line.slice(m[0].length)
  if (!rest.startsWith(oldTitle)) return null
  return m[0] + newTitle + rest.slice(oldTitle.length)
}

// Les accolades sont retirées du nom saisi, jamais écrites telles quelles : dans une ligne de
// titre, `{…}` est de la SYNTAXE lue par le parseur (TITLE_KIND_RE, md-line-type.js), pas du
// texte. Taper « Motif {sleeve} » poserait donc silencieusement la catégorie « manche » sur la
// section au prochain reparse — un changement de kind que personne n'a demandé, invisible dans
// le panneau. Même famille de piège que « ne traduis pas le marqueur » (cf. l'aide).
function commitRename(row) {
  const next = renameDraft.value.replace(/[{}]/g, '').trim()
  if (!next || next === row.title) return cancelRename()
  const lineNumber = sectionLine(draftMd.value, row.title)
  const line = lineNumber ? draftMd.value.split('\n')[lineNumber - 1] : null
  const rewritten = line == null ? null : renamedTitleLine(line, row.title, next)
  if (!rewritten) {
    // Jamais silencieux : le titre visé n'est plus dans le texte (édité à la main entre-temps).
    snackbar.show(t('correction.renameFailed'))
    return cancelRename()
  }
  editorRef.value?.replaceLine(lineNumber, rewritten)
  if (row.fingerprint) renames.value = { ...renames.value, [row.fingerprint]: next }
  cancelRename()
}

const highlightedFingerprint = ref(null)
// Dernière ligne connue du curseur dans l'éditeur (1-based) — alimente `galleryInsertLine`
// ci-dessous (insertion d'une image de galerie, retour terrain 27/08/2026). Alimentée par
// `@cursor-moved`, JAMAIS par `@cursor-line`/`onCursorLine` : ce dernier porte le garde-fou
// `!docChanged` de la pastille diagramme (cm-editor.js) — délibéré pour NE PAS rouvrir la
// bande à chaque frappe, mais qui laisserait cette ligne périmée pendant que la travailleuse
// tape un nouveau rang (le curseur avance alors par `docChanged`, jamais par un
// `selectionSet` isolé). `cursor-moved` n'a, lui, aucun effet de bord coûteux à limiter.
// Valeur initiale 1 : avant toute frappe/clic dans l'éditeur, `imageAnchorLine` y trouve un
// titre de section (jamais un rang) et renvoie `null` — le bouton démarre donc désactivé,
// jamais avec une cible fantôme.
const cursorLine = ref(1)

// Le curseur entre dans une section chart-éligible : ouvre la bande si besoin
// et met sa ligne en évidence — un simple focus visuel, sans muter workingReader.
async function onCursorLine(line) {
  const title = sectionTitleAtLine(draftMd.value, line)
  if (!title) { highlightedFingerprint.value = null; return }
  const targetSlug = slug(title)
  const row = chartStripRows.value.find((r) => slug(r.title) === targetSlug)
  highlightedFingerprint.value = row ? row.fingerprint : null
  if (!row) return
  if (!chartsOpen.value) await toggleCharts()
  await nextTick()
  document.querySelector(`[data-chart-fingerprint="${row.fingerprint}"]`)
    ?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() })
}

// Ouvre/ferme la bande « Diagrammes de ce patron » — et, au DÉPLI
// seulement, rattrape le scroll (dans le cadre des travaux d'UX de correction). Mesuré :
// tapée « en bas de page », le navigateur CONSERVE `scrollTop` — les rangées ajoutées
// naissent alors sous l'ancienne ligne de flottaison, exactement là où la barre
// d'action (.correct__actions, `position: sticky; bottom: 0`) reste collée tant que
// le nouveau bas de page réel n'est pas atteint : elles apparaissent recouvertes.
// `scrollMarginBottom`, posé à CHAQUE dépli sur la hauteur MESURÉE de la barre (jamais
// une constante — c'est exactement l'erreur du 22/07 que sticky-top.js documente en
// tête de fichier pour le même genre de bandeau, côté haut cette fois), fait amener la
// bande dans le cadre en tenant compte d'elle : `scrollIntoView` respecte nativement
// `scroll-margin`.
async function toggleCharts() {
  chartsOpen.value = !chartsOpen.value
  if (!chartsOpen.value) return
  // `nextTick` : la liste (v-if="chartsOpen") doit être RENDUE avant de mesurer/scroller,
  // sinon `chartStripRef` ne couvre encore que le bouton replié.
  await nextTick()
  const strip = chartStripRef.value
  const actions = actionsRef.value
  if (!strip || !actions) return
  strip.style.scrollMarginBottom = `${actions.getBoundingClientRect().height}px`
  // `scrollBehavior()`, jamais `'smooth'` en dur : sous « réduire les animations », ce
  // rattrapage doit être instantané. La règle `scroll-behavior: auto !important` de
  // `tokens.css` ne suffit PAS — elle ne gouverne pas une valeur passée en argument JS
  // (piège documenté au long dans src/utils/scroll-behavior.js, et verrouillé ici par
  // tests/e2e/correction-charts-actionbar.spec.js).
  strip.scrollIntoView?.({ block: 'end', behavior: scrollBehavior() })
}

// Signature "pertinente pour les diagrammes" d'une section : chart oui/non + shape, ET —
// UNIQUEMENT côté non-chart — présence de l'image (`hasImage`). Ce 3e champ lève une
// ambiguïté réelle : {chart:false} seul ne distingue PAS "n'a jamais été un diagramme" de "en
// était un, l'image vient de partir vers la galerie" (demoteChartToGallery/stripImageFromSection
// laissent parfois la section vivante SANS son image, cf. leur tête). Deux sections de même
// signature sont indiscernables du point de vue de l'état diagramme/image — exactement ce que
// comparait l'ancien `row.baseIsChart && row.baseShape === shape`, généralisé
// pour être réutilisable ici ET par la réconciliation d'Enregistrer (reconcileWorkingReaderOnSave,
// plus bas).
//
// LIMITE CONNUE (revue finale du 27/08/2026) : `hasImage` reste un BOOLÉEN, pas une
// identité d'image — sur une section à image SŒUR (steps: [{imgs:[IMG, SIBLING]}]),
// `demoteChartToGallery` ne retire que `chart.img` (IMG) et laisse SIBLING ancrée : `hasImage`
// reste `true` des deux côtés (base ET après le geste), donc `sameChartSignature` ne voit PAS
// la différence. Corrigé non pas ici, mais côté appelant : `applyImageAction` n'invoque plus
// JAMAIS le « retour exact à la base » pour "Envoyer vers la galerie" (cf. `restoreToBase`,
// plus bas) — ce geste déplace une image HORS du reader, ce n'est jamais un retour à un état
// antérieur, avec ou sans image sœur. Un `imageSrc` (identité) au lieu d'un booléen aurait aussi
// fermé ce trou, mais cassait un cas différent et déjà testé : `demoteChartToImage`
// (reader-correction.js) ne restaure PAS l'ordre d'origine des steps sur une section à image
// sœur (l'image promue revient en DERNIER, dans un step séparé — cf. sa tête), donc
// `sectionImageSrc` y trouverait SIBLING en premier après un aller-retour promote→demote, ≠ IMG
// côté base : le round-trip "Juste une image" (idempotence, premier correctif) cesserait de se
// restaurer pour ce cas. Le bypass ciblé sur `sendChartToGallery` évite cette régression.
function chartSignature(section) {
  if (!section) return null
  if (sectionCanDemote(section)) return { chart: true, shape: section.chart?.shape }
  return { chart: false, hasImage: !!sectionImageSrc(section) }
}
function sameChartSignature(a, b) {
  const sa = chartSignature(a)
  const sb = chartSignature(b)
  if (!sa || !sb) return sa === sb
  return sa.chart === sb.chart && sa.shape === sb.shape && sa.hasImage === sb.hasImage
}

// Applique IMMÉDIATEMENT `mutate` à la section visée par `fingerprint`, retrouvée
// DIRECTEMENT dans `workingReader.value.sections` — PLUS de reparse ici (retour terrain
// 27/08/2026, premier correctif) : un reparse contre `draftMd` redérive la structure de section
// (kind, présence d'un step {chart:true}, `section.chart`) ENTIÈREMENT depuis le TEXTE
// (mdFragmentToReader) — `reattachCharts` (reader-editable.js) ne fait que RAFFINER les
// métadonnées d'une section DÉJÀ reconnue diagramme par ce parse texte, elle ne peut jamais
// en créer ni en supprimer (garde `if (!sec?.chart) continue`). Comme aucun des 3 gestes ne
// touche `draftMd`, un reparse contre lui effaçait silencieusement toute promotion/démotion
// au clic suivant — confirmé empiriquement. `workingReader` est donc
// mutée EN PLACE, par des transforms purs uniquement : ses ids de section restent stables
// tout du long de la session (rien ne les recalcule jamais), donc l'appariement par
// empreinte reste correct même après un renommage (qui ne touche que `draftMd`, jamais
// `workingReader`). No-op si `fingerprint` est vide ou ne matche plus aucune section de
// `workingReader` (peut arriver après un "Envoyer vers la galerie" qui a retiré la section
// entière, cf. demoteChartToGallery).
//
// `restoreToBase` (revue finale du 27/08/2026) : désactivé par `sendChartToGallery` SEUL
// (cf. sa tête) — ce geste déplace une image HORS du reader vers `draftGallery`, ce n'est
// JAMAIS symétrique d'un retour à un état antérieur, contrairement à `setChartType`/
// `demoteImage`, de vraies bascules chart/pas-chart où un aller-retour peut légitimement
// ramener la section à son état de base.
function applyImageAction(fingerprint, mutate, { restoreToBase = true } = {}) {
  if (!fingerprint) return
  const target = (workingReader.value?.sections || []).find((s) => sectionFingerprint(s) === fingerprint)
  if (!target) return
  const mutated = mutate(workingReader.value, target.id)
  if (restoreToBase) {
    // RETOUR EXACT À LA BASE — ex-optimisation `pendingOps` (auparavant : `if
    // (row.baseIsChart && row.baseShape === shape) delete next[row.fingerprint]`), réexprimée
    // ici contre `workingReader`. Nécessaire, pas seulement cosmétique : `promoteImageToChart`
    // et `demoteChartToImage` (reader-correction.js) ne sont PAS des transforms inverses l'une
    // de l'autre au niveau STRUCTUREL (vérifié empiriquement) — un aller-retour promote→demote
    // scinde en DEUX le step d'ancrage (texte, puis image, alors qu'ils n'en faisaient qu'un) et
    // perd le `kind` d'origine (retombe sur DEFAULT_KIND, jamais restauré). Sans cette
    // restauration, `chartsDirty()` (JSON.stringify) resterait "sale" après un aller-retour qui
    // ramène pourtant la section à un état chart IDENTIQUE à `baseReader`, et l'Enregistrer
    // écrirait une structure de section légèrement différente de l'originale pour rien.
    // ⚠️ Une section NEUVE n'a jamais de contrepartie dans `baseReader` : son id peut être un id
    // RÉÉMIS (nextDiagramSection ne consulte que workingReader — dégrader « Diagramme 1 » vers la
    // galerie libère `diagramme-1`, une promotion ultérieure le reprend). Sans cette garde, la
    // section d'origine, homonyme, est retrouvée ici, `sameChartSignature` la juge identique, et
    // la section neuve est écrasée par son clone : l'image fraîchement promue DISPARAÎT et
    // l'ancienne ressuscite en double avec la galerie. Même garde qu'à
    // reconcileWorkingReaderOnSave, corrigée pour ce piège et pas celle-ci.
    const baseSec = newSectionIds.value.has(target.id)
      ? null
      : (baseReader.value?.sections || []).find((s) => s.id === target.id)
    const mutatedSec = (mutated.sections || []).find((s) => s.id === target.id)
    if (baseSec && mutatedSec && sameChartSignature(baseSec, mutatedSec)) {
      mutated.sections = mutated.sections.map((s) => (s.id === target.id ? JSON.parse(JSON.stringify(baseSec)) : s))
    }
  }
  workingReader.value = mutated
}

// Bascule "Suivre comme diagramme"/"Changer le type" — IMMÉDIAT (retour terrain
// 27/08/2026) : `shape` ∈ {undefined, 'radial-square', 'radial-circle', 'path'} — la
// SENTINELLE UI 'standard' (rangs standards) est convertie en `undefined` par
// shapeFromUiValue AVANT d'atteindre cette fonction (cf. imageMenuInfo/setImageShape/
// openPanelShapeMenu plus bas) : ce fichier ne manipule QUE de vraies valeurs de
// `chart.shape`, jamais la sentinelle du popover. `promoteImageToChart` no-op délibérément
// sur une section DÉJÀ chart (sa propre garde) : `setSectionChartShape` prend le relais
// pour ce cas (seul le type change, jamais la structure).
function setChartType(row, shape) {
  applyImageAction(row.fingerprint, (reader, sectionId) => {
    const sec = reader.sections.find((s) => s.id === sectionId)
    return sectionCanDemote(sec) ? setSectionChartShape(reader, sectionId, shape) : promoteImageToChart(reader, sectionId, shape)
  })
}

// « Juste une image » — IMMÉDIAT. `demoteChartToImage` no-op déjà si la section n'est pas
// un diagramme (sa propre garde) : aucune garde supplémentaire nécessaire ici.
function demoteImage(row) {
  applyImageAction(row.fingerprint, (reader, sectionId) => demoteChartToImage(reader, sectionId))
}

// « Envoyer vers la galerie » — IMMÉDIAT : l'image quitte le diagramme ET rejoint
// `draftGallery` dans le même geste, visible tout de suite dans la bande Galerie.
// `demoteChartToGallery` no-op déjà si la section n'est pas un diagramme (sa propre garde).
// `restoreToBase: false` (revue finale du 27/08/2026) — ce geste ne doit JAMAIS repasser
// par le « retour exact à la base » d'applyImageAction : sur une section à image SŒUR, ce
// garde-fou (pensé pour l'aller-retour promote/demote) se déclenchait à tort et ressuscitait
// dans `workingReader` une image déjà poussée dans `draftGallery` ci-dessous — dupliquée à
// l'Enregistrer. Cf. le commentaire de tête d'applyImageAction et de chartSignature pour le
// détail du mécanisme et le choix entre les deux correctifs possibles.
function sendChartToGallery(row) {
  applyImageAction(
    row.fingerprint,
    (reader, sectionId) => {
      const { reader: next, movedImg } = demoteChartToGallery(reader, sectionId)
      if (movedImg) draftGallery.value = [...draftGallery.value, { src: movedImg, page: 0, w: 0, h: 0 }]
      return next
    },
    { restoreToBase: false },
  )
}

// Les 4 valeurs de type, dans l'ordre d'affichage. `uiValue` est la sentinelle du POPOVER
// (jamais `undefined` littéral, cf. Contraintes Globales du plan — openMenuPopover traite
// `selectedValue === undefined` comme « ce popover ne porte aucune notion de sélection »,
// ce qui désactiverait la coche sur tous les items si 'standard' utilisait `undefined`).
// `shape` est la vraie valeur de `chart.shape` (undefined pour rangs standards).
const CHART_SHAPES = [
  { uiValue: 'standard', shape: undefined, i18nKey: 'standard' },
  { uiValue: 'radial-square', shape: 'radial-square', i18nKey: 'radialSquare' },
  { uiValue: 'radial-circle', shape: 'radial-circle', i18nKey: 'radialCircle' },
  { uiValue: 'path', shape: 'path', i18nKey: 'path' },
]

function chartShapeMenuItems() {
  return CHART_SHAPES.map((s) => ({
    value: s.uiValue,
    label: t(`correction.chartShape.${s.i18nKey}.label`),
    hint: t(`correction.chartShape.${s.i18nKey}.hint`),
  }))
}
function shapeFromUiValue(uiValue) {
  return CHART_SHAPES.find((s) => s.uiValue === uiValue)?.shape
}
function uiValueFromShape(shape) {
  return CHART_SHAPES.find((s) => s.shape === shape)?.uiValue || 'standard'
}

// Résolution partagée par imageMenuInfo/setImageShape/demoteImageAtLine : retrouve la ligne
// de chartStripRows dont le TITRE de section couvre la ligne cliquée (même appariement que
// onCursorLine, par slug). `null` si la ligne n'appartient à aucune section chart-éligible.
function chartRowAtLine(lineNumber) {
  const title = sectionTitleAtLine(draftMd.value, lineNumber)
  if (!title) return null
  const targetSlug = slug(title)
  return chartStripRows.value.find((r) => slug(r.title) === targetSlug) || null
}

// Empreinte d'un chemin d'image ISSU DU TEXTE ÉDITÉ (mdPath, argument des callbacks
// imageActions ci-dessous) : le Rowtine-MD ne porte JAMAIS de data-URL en clair sur une
// ligne image (readerToMdFragment/serialize.js émet toujours `img/photo-<hash>.<ext>`,
// nommage déterministe par CONTENU) — `photoFileName` ne sait donc PAS reparser cette
// forme (elle n'est pas une data-URL, cf. son repli `photo-<fallbackIndex>.bin`). Même
// double forme (data-URL brute OU chemin d'asset) et même résolution que `chartFingerprint`
// (reader-editable.js, réutilisée ici plutôt que réinventée) : une data-URL passe par
// photoFileName, un chemin d'asset porte déjà le nom de fichier `photo-<hash>.<ext>` en
// bout de chaîne — il suffit d'en garder le segment final.
function fingerprintOfPath(mdPath) {
  if (typeof mdPath !== 'string' || !mdPath) return null
  if (mdPath.startsWith('data:')) return photoFileName(mdPath, 0)
  const parts = mdPath.split('/')
  return parts[parts.length - 1] || null
}

// Callback `imageActions.getInfo` (cf. cm-editor.js openImageActionsMenu) : `mdPath`
// est le chemin BRUT de la ligne image CLIQUÉE, pas forcément celui de la 1re image ancrée
// de la section (seule celle-ci compte pour sectionImageSrc/la promotion — le modèle reste
// PAR SECTION). `enabled` compare son empreinte à celle du panneau (row.fingerprint).
function imageMenuInfo(lineNumber, mdPath) {
  const row = chartRowAtLine(lineNumber)
  if (!row) return null
  const fingerprint = fingerprintOfPath(mdPath)
  const enabled = !!fingerprint && !!row.fingerprint && fingerprint === row.fingerprint
  return {
    enabled,
    primary: {
      label: row.isChart ? t('correction.changeType') : t('correction.followAsChart'),
      hint: enabled ? null : t('correction.chartMenuIneligible'),
    },
    isChart: row.isChart,
    demoteLabel: row.isChart ? t('correction.justImage') : null,
    toGalleryLabel: row.isChart ? t('correction.sendToGallery') : null,
    shapeOptions: chartShapeMenuItems(),
    selectedShape: uiValueFromShape(row.shape),
  }
}

// Callback `imageActions.setShape` : ne rejoue JAMAIS la bascule sur une image non éligible
// (filet côté données — le menu ne propose de toute façon pas ce choix côté cm-editor.js).
function setImageShape(lineNumber, mdPath, uiValue) {
  const row = chartRowAtLine(lineNumber)
  if (!row) return
  const fingerprint = fingerprintOfPath(mdPath)
  if (!fingerprint || !row.fingerprint || fingerprint !== row.fingerprint) return
  setChartType(row, shapeFromUiValue(uiValue))
}

// Callback `imageActions.demote`.
function demoteImageAtLine(lineNumber, mdPath) {
  const row = chartRowAtLine(lineNumber)
  if (!row) return
  const fingerprint = fingerprintOfPath(mdPath)
  if (!fingerprint || !row.fingerprint || fingerprint !== row.fingerprint) return
  demoteImage(row)
}

// Callback `imageActions.sendToGallery` — même garde d'empreinte que `demoteImageAtLine`.
function sendChartToGalleryAtLine(lineNumber, mdPath) {
  const row = chartRowAtLine(lineNumber)
  if (!row) return
  const fingerprint = fingerprintOfPath(mdPath)
  if (!fingerprint || !row.fingerprint || fingerprint !== row.fingerprint) return
  sendChartToGallery(row)
}

// Objet stable passé tel quel à ReaderTextEditor (cf. son prop imageActions).
const imageActions = { getInfo: imageMenuInfo, setShape: setImageShape, demote: demoteImageAtLine, sendToGallery: sendChartToGalleryAtLine }

// Sous-popover de type, ouvert depuis le BOUTON du panneau (même mécanisme/mêmes items que
// le clic-image, cf. openImageActionsMenu dans cm-editor.js — décision assumée : les deux
// chemins partagent EXACTEMENT la même logique de choix de type).
function openPanelShapeMenu(row, anchorEl) {
  openMenuPopover(anchorEl, chartShapeMenuItems(), (uiValue) => setChartType(row, shapeFromUiValue(uiValue)), uiValueFromShape(row.shape))
}

// Patch PUR (clone défensif, même convention que reader-correction.js) du seul `chart.shape`
// d'une section — sans passer par `promoteImageToChart`, qui NO-OP délibérément
// quand la section cible est déjà un diagramme (`sectionIsChart(src)`, sa propre garde). Ce
// no-op est correct pour SA raison d'être (ne jamais re-promouvoir une section déjà chart) mais
// devenait un piège pour `setChartType` (cf. applyImageAction plus haut) : « Changer le type »
// d'un diagramme DÉJÀ promu atteint cette fonction avec une section déjà chart (reattachCharts,
// reader-editable.js, l'a déjà ré-attachée AVANT — cf. reconcileWorkingReaderOnSave/
// editableToReader). Rejouer promoteImageToChart dessus la laissait inchangée, PERDANT le type
// choisi SANS avertissement.
function setSectionChartShape(reader, sectionId, shape) {
  const out = JSON.parse(JSON.stringify(reader))
  const sec = (out.sections || []).find((s) => s && s.id === sectionId)
  if (!sec || !sec.chart) return out
  if (shape) sec.chart.shape = shape
  else delete sec.chart.shape
  return out
}

// Empreinte -> section, PREMIÈRE occurrence (même convention FIFO que reattachCharts/
// applyImageAction : deux sections partageant la même image sont indiscernables par empreinte
// seule).
function fingerprintSectionMap(reader) {
  const map = new Map()
  for (const sec of reader?.sections || []) {
    const fp = sectionFingerprint(sec)
    if (fp && !map.has(fp)) map.set(fp, sec)
  }
  return map
}

// Retire l'image d'empreinte de `sectionId` dans `reader`, où qu'elle vive — chart.img
// (demoteChartToGallery, déjà connue) OU 1re image ancrée d'un step ordinaire. Ce 2e cas est
// nécessaire pour « promouvoir PUIS envoyer vers la galerie » : le texte n'a JAMAIS été
// touché par le geste de promotion (lui aussi immédiat, sur `workingReader` seul), donc la
// section FRAÎCHEMENT reparsée à l'Enregistrer n'est PAS encore un diagramme —
// `demoteChartToGallery` no-op délibérément dessus (sa garde `!sectionIsChart`). Même contrat
// de suppression que `demoteChartToGallery` : section réduite à rien -> retirée ENTIÈREMENT
// plutôt que de laisser un titre de section orphelin.
function stripImageFromSection(reader, sectionId) {
  const src = (reader.sections || []).find((s) => s.id === sectionId)
  if (!src) return reader
  if (sectionCanDemote(src)) {
    const { reader: next } = demoteChartToGallery(reader, sectionId)
    return next
  }
  const out = JSON.parse(JSON.stringify(reader))
  const sec = out.sections.find((s) => s.id === sectionId)
  let removed = false
  sec.steps = sec.steps
    .map((step) => {
      if (removed || !step?.imgs?.[0]) return step
      removed = true
      const rest = step.imgs.slice(1)
      const { imgs: _imgs, ...restStep } = step
      if (rest.length) return { ...restStep, imgs: rest }
      return Object.keys(restStep).length ? restStep : null
    })
    .filter(Boolean)
  if (sec.steps.length === 0) out.sections = out.sections.filter((s) => s.id !== sectionId)
  return out
}

// Réconciliation d'Enregistrer (remplace `applyPendingChartOps`, ex-pendingOps) — rejoue sur
// `freshReader` (reparse frais de `draftMd` CONTRE `baseReader`, JAMAIS contre `workingReader`,
// cf. onSave) les gestes accumulés dans `workingReader` au fil de la session, retrouvés PAR
// EMPREINTE IMAGE (seule clé robuste au renommage/réordre texte — l'id, lui, est recalculé au
// reparse = slug du NOUVEAU titre, cf. tête de reader-editable.js). Chaque empreinte
// chart-éligible de `baseReader` OU `workingReader` (union) est classée en comparant sa
// signature chart des deux côtés :
//  - identique : rien à faire, `reattachCharts` a déjà la bonne structure pour cette section ;
//  - empreinte introuvable dans `freshReader` : le texte a changé entre le geste et
//    l'Enregistrer d'une façon qui a fait disparaître la ligne image visée -> PERTE VISIBLE,
//    JAMAIS SILENCIEUSE (avertissement, jamais une structure inventée) ;
//  - absente de `workingReader` (empreinte présente côté base uniquement) : "Envoyer vers la
//    galerie" a fait sortir l'image de `workingReader` — on la retire de `freshReader` par
//    `stripImageFromSection`, en jetant l'image renvoyée (déjà poussée dans `draftGallery` au
//    clic, cf. sendChartToGallery : la ré-ajouter ici la dupliquerait) ;
//  - sinon (signatures différentes, section présente des deux côtés) : promotion / démotion /
//    changement de type -> transform pur adéquat, rejoué sur la section fraîche.
//
// SECTIONS TOUTES NEUVES (promotion galerie→diagramme) — cas à part, HORS de la
// boucle par empreinte ci-dessus : `promoteGalleryImage` ajoute directement à
// `workingReader` une section « Diagramme N » (appendGalleryImageAsChart) qui n'a JAMAIS
// existé dans `baseReader` ni dans le texte — aucun reparse de `draftMd` ne la contient
// donc `freshTarget` y serait TOUJOURS introuvable, et la boucle la classerait à tort en
// PERTE VISIBLE (CORRECTION_CHART_OP_LOST) au lieu de la garder. Identifiées par le marqueur
// EXPLICITE `newSectionIds` (un correctif, revue finale du 27/08/2026 — plus par `!baseIds.
// has(id)`, cf. sa tête) : deux images de galerie byte-identiques promues séparément partagent
// la même empreinte mais reçoivent des ids DISTINCTS (nextDiagramSection, reader-correction.js
// dédoublonne), alors que `fingerprintSectionMap` ne garde que la PREMIÈRE occurrence par
// empreinte — une clé d'empreinte en perdrait donc une des deux ici. Ajoutées APRÈS la
// boucle, dans l'ordre de `workingReader` (préserve les doublons) — même séparation que
// l'ancienne boucle `pendingGalleryPromotions` de `onSave`, avant ce changement : ces sections
// ne passent jamais par le chemin de reparse.
function reconcileWorkingReaderOnSave(freshReader) {
  const baseMap = fingerprintSectionMap(baseReader.value)
  const workingMap = fingerprintSectionMap(workingReader.value)
  const fingerprints = new Set([...baseMap.keys(), ...workingMap.keys()])
  let out = freshReader
  const warnings = []
  for (const fp of fingerprints) {
    const baseSec = baseMap.get(fp)
    const workingSec = workingMap.get(fp)
    if (workingSec && newSectionIds.value.has(workingSec.id)) continue // section neuve : traitée à part, plus bas
    if (sameChartSignature(baseSec, workingSec)) continue

    const freshTarget = (out.sections || []).find((s) => sectionFingerprint(s) === fp)
    if (!freshTarget) {
      const original = baseSec || workingSec
      warnings.push(
        original?.title
          ? W(WARNING_CODES.CORRECTION_CHART_OP_LOST_NAMED, { blockTitle: original.title })
          : W(WARNING_CODES.CORRECTION_CHART_OP_LOST),
      )
      continue
    }

    if (!workingSec) {
      out = stripImageFromSection(out, freshTarget.id)
      continue
    }

    const workingIsChart = sectionCanDemote(workingSec)
    if (workingIsChart) {
      const shape = workingSec.chart?.shape
      out = sectionCanDemote(freshTarget)
        ? setSectionChartShape(out, freshTarget.id, shape)
        : promoteImageToChart(out, freshTarget.id, shape)
    } else {
      out = demoteChartToImage(out, freshTarget.id)
    }
  }

  const newSections = (workingReader.value?.sections || []).filter((s) => s && newSectionIds.value.has(s.id))
  if (newSections.length) {
    out = { ...out, sections: [...(out.sections || []), ...JSON.parse(JSON.stringify(newSections))] }
  }

  return { reader: out, warnings }
}

// Projets à réconcilier : mirroir de `reconcileProgress` (patron-md-sync.js).
// Patron FORKÉ pour un projet → ce seul projet ; patron de bibliothèque partagé
// (pas de fork) → fan-out vers tous les projets qui le pointent.
function linkedProjects() {
  if (pattern.value.ownerProjectId != null) {
    return projectsStore.projects.filter((p) => p.id === pattern.value.ownerProjectId)
  }
  return projectsStore.projects.filter((p) => p.patternId === pattern.value.id)
}

// Galerie brouillon vs galerie d'origine : même raisonnement que sizesText ci-dessus
// (isDirty, correction-dirty.js, ne connaît QUE texte + chartsDirty()) — un changement de
// galerie SEUL (aucun texte, aucune taille touchée) doit quand même déclencher la garde.
//
// `pattern.value?.` — jamais `pattern.value.` (correctif revue finale) : `pattern` vaut
// encore `null` quand onMounted redirige un patron INTROUVABLE vers la bibliothèque, et ce
// `router.replace` déclenche onBeforeRouteLeave, donc dirty(), donc cette fonction. Un
// déréférencement levait alors un TypeError qui ANNULAIT la redirection : utilisatrice
// bloquée sur un écran vide. Même chemin sur un retour Android pressé pendant que
// `patternsStore.get()` est encore en vol. Avec le `?.`, `draftGallery` valant `[]` (son
// état initial, pas encore alimenté par onMounted), la comparaison donne '[]' vs '[]' :
// « pas de modification », la garde laisse passer, la redirection aboutit.
function galleryDirty() {
  return JSON.stringify(draftGallery.value) !== JSON.stringify(pattern.value?.gallery || [])
}

// workingReader diffère-t-il de baseReader ? Même style que galleryDirty() ci-dessus —
// comparaison structurelle, pas d'identité (workingReader est toujours un objet NEUF après
// applyImageAction, jamais le même par référence). Reste valable même après un aller-retour
// promote→demote grâce au « retour exact à la base » d'applyImageAction (cf. sa tête) : sans
// lui, cette comparaison JSON.stringify resterait "sale" pour rien.
function chartsDirty() {
  return JSON.stringify(workingReader.value) !== JSON.stringify(baseReader.value)
}

function dirty() {
  return (
    isDirty(mdInitial.value, draftMd.value, chartsDirty()) ||
    sizesText.value !== sizesInitial.value ||
    galleryDirty()
  )
}

// Garde « modifs non enregistrées » : SEUL point d'interception,
// car l'en-tête (AppHeader back → useSmartBack), le bouton Annuler (goBack)
// ET le bouton physique/geste Android (App.vue → smartBack())
// convergent tous vers une navigation de route (router.back() ou, à défaut
// d'historique, router.push du fallback) — onBeforeRouteLeave les intercepte
// tous sans dupliquer la logique dans App.vue.
//
// Idempotence : si le retour Android est pressé PENDANT que le dialogue est
// déjà ouvert, cette garde s'exécute à nouveau et renvoie `false` (dirty()
// reste vrai, confirmedLeave reste faux) — le dialogue reste simplement
// ouvert. La sortie n'a lieu que via « Quitter » (onDiscardConfirm) ou
// « Enregistrer » (onSave). Comportement sûr assumé : jamais de perte.
// `pendingTo` capture la navigation interceptée (ex. burger de l'en-tête → une
// autre destination qu'un simple retour) pour que la confirmation y atterrisse
// réellement, plutôt que de toujours retomber sur goBack() (bug revue finale :
// « Bibliothèque » depuis le menu ouvrait bien le dialogue, mais « Quitter »
// ramenait en ARRIÈRE au lieu d'aller vers la Bibliothèque demandée).
let pendingTo = null

onBeforeRouteLeave((to) => {
  if (confirmedLeave.value || !dirty()) return true
  pendingTo = to
  showDiscard.value = true
  return false // annule la navigation ; le dialogue décide
})

function onDiscardConfirm() {
  confirmedLeave.value = true
  showDiscard.value = false
  if (pendingTo) router.push(pendingTo.fullPath)
  else goBack()
}

function onDiscardCancel() {
  showDiscard.value = false
}

async function onSave() {
  // Les tailles du champ descendent JUSQU'AU parseur (correctif revue finale) : sans
  // elles, le reparse relisait la table au nombre de colonnes d'ORIGINE (baseReader) alors
  // que l'éditeur venait de l'émettre au NOUVEAU — la table tout juste reconstruite était
  // rejetée (`sizes.countMismatch`), rétrogradée en section de repli titrée `sizeTable-notes`,
  // et le geste échouait au premier essai. Champ vide : repli sur baseReader côté fragment.js,
  // le même que celui de `normalizeReaderForSave` plus bas.
  // Reparse contre `baseReader`, JAMAIS contre `workingReader` (premier correctif, retour terrain
  // 27/08/2026) : `baseReader` est l'ancre STABLE, jamais reparse-dérivée — le seul repère
  // fiable pour ce que le TEXTE encode réellement (renommage/réordre/tailles). `workingReader`,
  // lui, peut avoir dérivé structurellement au fil des gestes (kind perdu, step d'ancrage
  // scindé, cf. applyImageAction) : le reparser directement redonnerait une structure
  // incohérente pour des sections que le texte, lui, décrit différemment. Les 4 gestes
  // (promote/demote/type/galerie) sont réconciliés SÉPARÉMENT ci-dessous, par empreinte.
  const { reader: freshReader, warnings: editWarnings } = editableToReader(draftMd.value, baseReader.value, {
    sizeLabels: effectiveSizeLabels.value,
    // Repli pour une image de galerie insérée dans le texte (insertGalleryImageIntoText,
    // ci-dessus) : jamais ancrée dans baseReader, sa data-URL ne vit QUE dans cette map.
    extraImages: images.value,
  })
  // Réconcilie les gestes accumulés dans `workingReader` (promote/demote/type/galerie) sur ce
  // reparse frais — remplace l'ancien `applyPendingChartOps` (pendingOps map), cf.
  // reconcileWorkingReaderOnSave.
  const { reader: readerWithGalleryCharts0, warnings: chartWarnings } = reconcileWorkingReaderOnSave(freshReader)
  const warnings = [...editWarnings, ...chartWarnings]

  // Toute promotion galerie→diagramme et tout « Envoyer vers la galerie » ont déjà eu lieu
  // au clic (immédiat, cf. promoteGalleryImage/sendChartToGallery) : `draftGallery` porte
  // déjà exactement les images à écrire, `workingReader` porte déjà toutes les sections.
  const readerWithGalleryCharts = readerWithGalleryCharts0
  const finalGallery = draftGallery.value

  // Les tailles saisies dans le champ ci-dessus priment sur celles du reader d'origine.
  // `normalizeReaderForSave` redimensionne au passage les vecteurs c/total de tous les
  // steps (resizeStepCounts/padTo) : réduire le nombre de tailles ne casse rien, le texte
  // reste intact (`t`, jamais touché) — seule la vectorisation d'une ligne devenue non
  // vectorisable est perdue (ex. « 90 (100) 110 » sur 3 tailles : `c` tronqué à 2 valeurs
  // par `padTo`, silencieusement — AUCUN avertissement n'est levé pour ce cas précis,
  // `remainingCarveLoss`/editableToReader ayant déjà tourné plus haut sur les tailles
  // D'ORIGINE ; limite acceptée, pas un bug : le texte source, lui, n'est jamais perdu
  // — décision produit, 19/08/2026).
  //
  // `resizeReferenceSizeTable` (revue finale) recadre ensuite les rangées du tableau des
  // tailles sur la largeur RETENUE (`normalized.sizeLabels`, repli compris — jamais le champ
  // brut) : sans lui, réduire le nombre de tailles laissait des rangées plus larges que
  // l'en-tête, donc une colonne orpheline et un surlignage de taille décalé dans la fiche.
  const normalized = normalizeReaderForSave(readerWithGalleryCharts, sizeLabels.value)
  const readerWithSizes = resizeReferenceSizeTable(normalized, normalized.sizeLabels)

  // Réconciliation PURE (aucune écriture DB à ce stade) pour chaque projet lié —
  // même découpage que `patron-md-sync.reconcileProgress` : le calcul ne dépend
  // d'aucune écriture déjà posée, c'est l'appelant (ci-dessous) qui écrit.
  const reports = []
  const projectPatches = []
  for (const project of linkedProjects()) {
    const { state, report } = reconcileReaderState(baseReader.value, project.readerState || {}, readerWithSizes)
    reports.push(report)
    projectPatches.push({ projectId: project.id, readerState: state })
  }

  // Écriture DB ATOMIQUE : les readerStates des projets liés ET le
  // patron sont posés dans UNE seule transaction Dexie — calqué EXACTEMENT sur
  // `patron-md-sync.processFolder` (même `db`, mêmes tables, même ordre : projets
  // PUIS patron). Un échec (ex. quota dépassé) après un ou plusieurs readerStates
  // déjà écrits fait annuler TOUT (rollback réel Dexie/IndexedDB) : on ne se
  // retrouve jamais avec un projet rebasé sur le NOUVEAU reader pendant que le
  // patron en base est encore l'ANCIEN — l'incohérence qui pouvait placer une
  // fausse coche au prochain passage (même raisonnement que patron-md-sync.js).
  //
  // ÉCHEC : le `try/catch` consomme la rejection de la
  // transaction avortée (sinon Dexie la laisse « unhandled » côté process) ET
  // c'est le comportement produit correct — rien n'a été modifié (rollback réel),
  // donc on NE navigue PAS (le brouillon reste affiché, rien perdu) et on le dit
  // clairement via un snackbar dédié, plutôt que de laisser croire à un succès.
  try {
    await db.transaction('rw', db.projects, db.patterns, async () => {
      for (const { projectId, readerState } of projectPatches) {
        await db.projects.update(projectId, { ...plain({ readerState }), updatedAt: new Date().toISOString() })
      }
      // `sizes` s'aligne sur `reader.sizeLabels` (décision produit, 19/08) : sans cela la
      // fiche patron continue d'annoncer les tailles devinées à l'import alors que le
      // tableau en compte d'autres. Dans la MÊME écriture que le reader — le contrat
      // d'atomicité de cet écran interdit qu'un patron ait un reader neuf et des `sizes`
      // anciennes. Vérifié : aucun projet en cours n'est touché, un projet détient sa
      // propre copie de `sizes` (project-fill.js ne copie que vers un projet vide).
      //
      // Lu sur `readerWithSizes.sizeLabels`, PAS sur `sizeLabels.value` : ce sont les
      // MÊMES tailles tant que le champ n'est pas vide, mais `normalizeReaderForSave`
      // a un repli (champ vidé → conserve les sizeLabels déjà présents sur le reader,
      // cf. reader-edit.js) — lire `sizeLabels.value` directement écrirait `sizes: []`
      // dans ce cas alors que le reader, lui, garde ses tailles. Lire la valeur déjà
      // normalisée garantit que les deux champs restent le miroir l'un de l'autre.
      //
      // RÉGRESSION CORRIGÉE (revue qualité, 20/08/2026) : la sentinelle mono-taille
      // (`isSingleSize`, reader.js) doit rester HORS de `sizes`, exactement comme aux
      // trois chemins d'import (zip-import.js, pdf-import/assemble.js,
      // LocalPdfImportView.vue:187) — décision produit : un patron à taille unique
      // porte `reader.sizeLabels = ['Taille unique']` MAIS `pattern.sizes = []`, pour ne
      // jamais afficher un sélecteur de taille à un seul choix. Sans cette garde, rouvrir
      // Corriger le patron SANS toucher au champ Tailles faisait apparaître un sélecteur
      // fantôme (bibliothèque, fiche patron, fiche projet) sur toute la classe des
      // patrons mono-taille — régression silencieuse, pas un cas limite.
      await db.patterns.update(Number(route.params.id), plain({
        reader: readerWithSizes,
        sizes: isSingleSize(readerWithSizes.sizeLabels) ? [] : [...readerWithSizes.sizeLabels],
        gallery: finalGallery,
      }))
    })
  } catch (e) {
    console.error('[correction] échec de sauvegarde atomique', e)
    snackbar.show(t('correction.saveError'))
    return
  }

  // Recharge les stores Pinia réactifs APRÈS le commit (même motif que
  // `processFolder`) : la transaction ci-dessus a déjà persisté les données, il
  // ne reste qu'à faire relire les stores pour que le reste de l'app (fiche
  // projet, bibliothèque…) reflète immédiatement le nouvel état.
  await Promise.all([patternsStore.load(), projectsStore.load()])

  const reconcile = aggregateReconcileReports(reports)
  if (isMergedEntryFlagged({ reconcile, warnings })) {
    // Jamais de perte silencieuse : même dialogue que la re-synchro MD, pour ne
    // pas dupliquer une 2ᵉ UI qui dirait la même chose différemment. Effet UI,
    // volontairement HORS transaction, après le commit réussi.
    syncReportStore.setReport({
      merged: [{ kind: 'pattern', id: pattern.value.id, name: pattern.value.name, reconcile, warnings, missingAssets: [] }],
      skipped: [],
      errors: [],
    })
  }

  snackbar.show(t('correction.saved'))
  confirmedLeave.value = true
  newSectionIds.value = new Set() // hygiène post-Enregistrer (cf. tête de newSectionIds) : la vue navigue ensuite, mais un futur appel ne doit pas hériter du set de la session précédente
  router.back()
}

function onCancel() {
  goBack()
}
</script>

<template>
<div>
  <AppHeader :title="t('correction.title')" back />
  <main v-if="pattern" class="correct">
    <div class="correct__body">
      <CorrectionHelp />
      <FieldHelp
        for="correction-sizes"
        :label="t('correction.sizesLabel')"
        :hint="t('correction.sizesHint')"
      />
      <input
        id="correction-sizes"
        v-model="sizesText"
        class="input"
        :placeholder="t('project.sizesPlaceholder')"
      />
      <ReaderTextEditor
        ref="editorRef"
        v-model:md="draftMd"
        :images="images"
        :size-labels="effectiveSizeLabels"
        :image-actions="imageActions"
        @cursor-line="onCursorLine"
        @cursor-moved="(line) => (cursorLine = line)"
      />

      <section v-if="chartPanelRows.length" ref="chartStripRef" class="chart-strip card">
        <button
          type="button"
          class="chart-strip__toggle"
          :aria-expanded="chartsOpen"
          @click="toggleCharts"
        >
          <AppIcon name="chart" :size="18" />
          <span>{{ t('correction.diagramsToggle', { count: chartPanelRows.length }) }}</span>
          <AppIcon :name="chartsOpen ? 'chevronUp' : 'chevronDown'" :size="16" />
        </button>
        <div v-if="chartsOpen" class="chart-strip__list">
          <div
            v-for="row in chartPanelRows"
            :key="row.id"
            class="chart-strip__row"
            :class="{ 'chart-strip__row--active': row.fingerprint && row.fingerprint === highlightedFingerprint, 'chart-strip__row--broken': row.broken }"
            :data-chart-fingerprint="row.fingerprint"
          >
            <template v-if="row.broken">
              <span class="chart-strip__label">
                <AppIcon name="warning" :size="18" />
                {{ t('correction.brokenDiagramLabel') }}
              </span>
              <p class="chart-strip__hint">{{ t('correction.brokenDiagramHint') }}</p>
              <div class="chart-strip__actions">
                <button type="button" class="btn" @click="goToBrokenSection(row)">
                  {{ t('correction.brokenDiagramGoTo') }}
                </button>
              </div>
            </template>
            <template v-else>
              <img v-if="row.img" :src="row.img" class="chart-strip__preview" alt="" />
              <span class="chart-strip__label">
                <AppIcon v-if="!row.img" name="chart" :size="18" />
                <!-- `row.renamed` court-circuite TOUTE l'étiquette, pas seulement l'id : une
                     fois la section renommée via ce panneau, `row.title` porte un texte choisi
                     par la travailleuse — il s'affiche TEL QUEL, jamais passé à
                     `sectionTitleLabel` (qui traduirait aussi bien un id `'presentation'`
                     encore non resynchronisé qu'un titre tapé qui vaudrait littéralement
                     « Présentation »). Seul un titre NON renommé passe par
                     `sectionTitleLabel`. -->
                <span class="chart-strip__name">{{ row.renamed ? row.title : sectionTitleLabel(row, t) }}</span>
                <button
                  type="button"
                  class="chart-strip__rename-btn"
                  :aria-label="t('correction.renameDiagram')"
                  @click="startRename(row)"
                >
                  <AppIcon name="edit" :size="17" />
                </button>
              </span>
              <span class="corr-chip" :class="{ 'corr-chip--on': row.isChart }">
                {{ row.isChart ? t('correction.isChart') : t('correction.justImage') }}
              </span>
              <div v-if="renamingId === row.id" class="chart-strip__rename">
                <label class="chart-strip__rename-label" :for="`chart-rename-${row.id}`">
                  {{ t('correction.renameLabel') }}
                </label>
                <input
                  :id="`chart-rename-${row.id}`"
                  :ref="setRenameInput"
                  v-model="renameDraft"
                  class="input"
                  type="text"
                  @keyup.enter="commitRename(row)"
                  @keyup.esc="cancelRename"
                />
                <p class="chart-strip__rename-warn">{{ t('correction.renameProgressWarning') }}</p>
                <div class="chart-strip__actions">
                  <button type="button" class="btn chart-strip__btn" @click="commitRename(row)">
                    <AppIcon name="check" :size="17" />
                    {{ t('correction.renameConfirm') }}
                  </button>
                  <button type="button" class="btn chart-strip__btn" @click="cancelRename">
                    {{ t('correction.cancel') }}
                  </button>
                </div>
              </div>
              <div class="chart-strip__actions">
                <button type="button" class="btn chart-strip__btn" aria-haspopup="menu" @click="openPanelShapeMenu(row, $event.currentTarget)">
                  <AppIcon name="chart" :size="16" />
                  {{ row.isChart ? t('correction.changeType') : t('correction.followAsChart') }}
                </button>
                <button v-if="row.isChart" type="button" class="btn chart-strip__btn" @click="demoteImage(row)">
                  <AppIcon name="camera" :size="16" />
                  {{ t('correction.justImage') }}
                </button>
                <button v-if="row.isChart" type="button" class="btn chart-strip__btn" @click="sendChartToGallery(row)">
                  <AppIcon name="import" :size="16" />
                  {{ t('correction.sendToGallery') }}
                </button>
              </div>
            </template>
          </div>
        </div>
      </section>

      <section ref="galleryStripRef" class="gallery-strip card">
        <button
          type="button"
          class="gallery-strip__toggle"
          :aria-expanded="galleryOpen"
          @click="toggleGallery"
        >
          <AppIcon name="camera" :size="18" />
          <span>{{ t('correction.galleryToggle', { count: galleryRows.length }) }}</span>
          <AppIcon :name="galleryOpen ? 'chevronUp' : 'chevronDown'" :size="16" />
        </button>
        <div v-if="galleryOpen" class="gallery-strip__list">
          <div v-for="row in galleryRows" :key="row.idx" class="gallery-strip__row">
            <img
              :src="row.src"
              class="gallery-strip__img"
              :alt="row.page > 0 ? t('patternExtras.fromPage', { n: row.page }) : t('patternExtras.addedImage')"
            />
            <button type="button" class="gallery-strip__del" :aria-label="t('common.delete')" @click="removeGalleryImage(row.idx)">
              <AppIcon name="close" :size="15" />
            </button>
            <button
              v-if="!row.pending"
              type="button"
              class="gallery-strip__insert"
              :disabled="!galleryInsertLine"
              @click="insertGalleryImageIntoText(row)"
            >
              {{ t('correction.insertIntoText') }}
            </button>
            <button
              type="button"
              class="gallery-strip__promote"
              aria-haspopup="menu"
              @click="openGalleryShapeMenu(row, $event.currentTarget)"
            >
              {{ t('correction.followAsChart') }}
            </button>
          </div>
          <button
            type="button"
            class="gallery-strip__add btn"
            aria-haspopup="menu"
            @click="openGalleryAddMenu($event.currentTarget)"
          >
            <AppIcon name="plus" :size="18" /> {{ t('patternExtras.addImage') }}
          </button>
          <input ref="galleryFileInputRef" type="file" accept="image/*" class="gallery-strip__fileinput" @change="onGalleryFilePicked" />
          <PdfPagePickerDialog v-if="pattern?.pdf" v-model:open="galleryPdfPickerOpen" :pdf="pattern.pdf" @pick="onGalleryPdfPagePicked" />
        </div>
      </section>
    </div>

    <div ref="actionsRef" class="correct__actions">
      <button type="button" class="btn" @click="onCancel">{{ t('correction.cancel') }}</button>
      <button type="button" class="btn btn--primary" @click="onSave">
        <AppIcon name="check" :size="18" /> {{ t('correction.save') }}
      </button>
    </div>

    <ConfirmDialog
      :open="showDiscard"
      :title="t('correction.discardTitle')"
      :message="t('correction.discardBody')"
      :confirm-label="t('correction.leave')"
      :cancel-label="t('correction.stay')"
      danger
      @confirm="onDiscardConfirm"
      @cancel="onDiscardCancel"
    />
  </main>

  <!-- Chargement (dans le cadre des travaux d'UX de correction) : `onMounted` lit la base avant de poser
       `pattern`, laissant sinon la page vide sous l'en-tête pendant l'attente. Même
       motif que ProjectDetailView.vue (`v-else-if="loading"`, mutuellement exclusif
       avec `v-if="pattern"` ci-dessus — `pattern` seul gouverne le vrai contenu, jamais
       `loading`, cf. commentaire posé sur `loading.value = false` dans onMounted). -->
  <SkeletonScreen v-else-if="loading" variant="detail" />
</div>
</template>

<style scoped>
.chart-strip {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin-top: var(--sp-4);
}
.chart-strip__toggle {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  min-height: 44px;
  background: none;
  border: none;
  font-family: var(--font-ui);
  font-size: 15px;
  font-weight: 700;
  color: var(--ink-70);
}
/* `> :not(.app-icon)` et non `> span` : AppIcon (AppIcon.vue) rend LUI AUSSI un
   <span class="app-icon">, donc un sélecteur `> span` naïf frappe les TROIS enfants
   directs du bouton (icône chart, libellé, chevron) à parts égales — mesuré : 100px
   chacun sur un bouton de 327px, le libellé perd la place et passe sur deux lignes
   (42px de haut au lieu de 18). Même correctif, même justification, que
   `.help__summary > :not(.app-icon)` (CorrectionHelp.vue) : modifier CETTE règle
   plutôt que d'en ajouter une concurrente — les styles scoped Vue portent un
   attribut [data-v-…] qui leur donne une priorité qu'une règle ajoutée n'aurait pas. */
.chart-strip__toggle > :not(.app-icon) { flex: 1; text-align: left; }
.chart-strip__list { margin-top: var(--sp-2); }
/* Rangée EN COLONNE (retour terrain 26/08/2026) : l'aperçu d'abord, pleine largeur, les
   boutons dessous. Avant, tout tenait sur une ligne autour d'une vignette de 24px — sur une
   grille de diagramme, 24px en `object-fit: cover` ne montraient qu'un recadrage du coin
   supérieur gauche : une pastille illisible, impossible à reconnaître d'un diagramme à
   l'autre. `--broken` n'a donc PLUS besoin de redéclarer `column` (sa règle est retirée
   plus bas plutôt que laissée en double, cf. le piège des règles concurrentes documenté
   sur .chart-strip__toggle).

   `padding-inline` + `margin-inline` négatif (correctif du même retour) : la rangée n'avait
   AUCUN padding horizontal, donc l'anneau `inset` de --active était dessiné pile SUR les
   boutons — le cadre semblait les traverser. Le padding écarte le contenu de l'anneau, la
   marge négative rend les rangées ordinaires visuellement inchangées. */
.chart-strip__row {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--sp-2);
  padding: var(--sp-2);
  margin-inline: calc(-1 * var(--sp-2));
  border-top: 1px solid var(--sage-tile-line);
}
.chart-strip__row:first-of-type {
  border-top: none;
}
.chart-strip__row--active {
  background: var(--tile);
  border-radius: var(--r-md, 8px);
  box-shadow: inset 0 0 0 1.5px var(--brand-deep);
  /* Sinon le trait de séparation double l'anneau sur le bord haut. */
  border-top-color: transparent;
}
.chart-strip__label {
  display: flex;
  align-items: center;
  gap: var(--sp-1, 6px);
  min-width: 0;
  font-weight: 600;
}
.chart-strip__name {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.chart-strip__row--broken .chart-strip__label {
  color: var(--warning);
}
.chart-strip__hint {
  margin: 0;
  font-size: 13px;
  color: var(--ink-70);
}
/* `contain`, PAS `cover` : un diagramme doit se lire ENTIER — un recadrage en montrerait le
   coin et rien d'autre. `max-height` borne l'encombrement d'un diagramme très haut sans
   jamais l'étirer (`width: 100%` + `height: auto` gardent ses proportions). Fond `--tile` :
   `contain` laisse des marges autour d'une image qui n'a pas le ratio du cadre, et un fond
   nommé vaut mieux qu'un trou transparent sur le fond de la carte. */
.chart-strip__preview {
  width: 100%;
  height: auto;
  max-height: 180px;
  object-fit: contain;
  background: var(--tile);
  border-radius: var(--r-sm);
  display: block;
}
.chart-strip__actions {
  display: flex;
  gap: var(--sp-2);
  flex-wrap: wrap;
}
/* « Plus petits » au sens du retour terrain : moins de texte et moins de rembourrage — mais
   `min-height: 44px` INTACT. C'est la cible tactile minimale du projet, contrainte globale
   jamais négociée (même règle, même justification, que .gallery-strip__promote plus bas, née
   d'une revue qui avait précisément rattrapé des boutons à ~26px). `flex: 1` + `min-width` :
   les deux boutons se partagent la largeur sous l'image et repassent l'un sous l'autre quand
   la place manque, plutôt que de déborder. */
.chart-strip__btn {
  flex: 1;
  min-width: 132px;
  justify-content: center;
  min-height: 44px;
  font-size: 13px;
  padding-inline: var(--sp-2);
}
/* Cible tactile atteinte par ::after (comme .gallery-strip__del) plutôt qu'en gonflant le
   carré du crayon, qui pousserait la ligne du titre à 44px de haut pour rien. */
.chart-strip__rename-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: var(--surface);
  color: var(--ink-70);
}
.chart-strip__rename-btn::after {
  content: '';
  position: absolute;
  inset: -8px;
}
/* Encadré : sans lui, « Renommer »/« Annuler » se lisaient comme deux boutons DE PLUS dans la
   grille d'actions du diagramme, juste au-dessus de « Changer le type »/« Juste une image » —
   quatre boutons de même gabarit, deux portées différentes. Le fond + le trait délimitent la
   parenthèse ouverte par le crayon. */
.chart-strip__rename {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1, 6px);
  padding: var(--sp-2);
  background: var(--tile);
  border: 1px solid var(--line);
  border-radius: var(--r-md, 8px);
}
.chart-strip__rename-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-70);
}
.chart-strip__rename-warn {
  margin: 0;
  font-size: 12.5px;
  color: var(--ink-70);
}
/* La rangée est passée en colonne étirée (cf. .chart-strip__row) : sans ceci, la pastille —
   un `inline-flex` — se ferait étirer sur toute la largeur et cesserait de se lire comme une
   pastille. `align-self` la ramène à sa largeur de contenu, calée à gauche. */
.chart-strip__row .corr-chip {
  align-self: flex-start;
}
.corr-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--sage-tile-line);
  background: var(--surface);
  color: var(--ink-55);
  font-weight: 600;
  font-size: 13px;
  padding: 7px 13px;
  border-radius: var(--r-pill);
}
.corr-chip--on {
  background: var(--sage-tile-bg);
  /* --sage-deep-strong, PAS --sage-deep : ce texte 13px/600 sur le dégradé
     --sage-tile-bg (donc « petit texte », seuil AA 4.5:1) descend à 4.00:1 sur l'arrêt
     le plus sombre du dégradé en CLAIR avec --sage-deep — sous AA (cf. tokens.css et
     tests/e2e/theme-contrast-clair.spec.js). En sombre, --sage-deep-strong reprend la
     valeur --sage-deep déjà conforme (5.98:1) : ce changement ne touche QUE le clair. */
  color: var(--sage-deep-strong);
}
.gallery-strip {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin-top: var(--sp-4);
}
.gallery-strip__toggle {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  min-height: 44px;
  background: none;
  border: none;
  font-family: var(--font-ui);
  font-size: 15px;
  font-weight: 700;
  color: var(--ink-70);
}
.gallery-strip__toggle > :not(.app-icon) { flex: 1; text-align: left; }
.gallery-strip__list { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin-top: var(--sp-2); align-items: flex-start; }
.gallery-strip__row {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 90px;
}
/* `min-height: 44px` (correctif revue finale) : cible tactile MINIMALE du projet,
   contrainte globale jamais négociée (cf. .correct__actions .btn ci-dessous et
   tests/e2e/correction-line-movers-actionbar.spec.js). Ces deux boutons naissaient à
   ~26px (12px de texte + 2×4px de padding) — les seuls interactifs du fichier sous le
   plancher : .gallery-strip__toggle le pose en dur, .gallery-strip__del l'atteint par son
   ::after { inset: -9px }, la paire promote/demote de la bande Diagrammes passe par .btn.
   La classe .btn n'est PAS reprise ici : elle ne porte aucun min-height dans tokens.css
   (elle ne garantirait donc pas le plancher), et son gabarit — 15px de texte, 18px de
   padding horizontal — déborderait de la colonne de 90px d'une vignette. `display: flex`
   + centrage : sans lui, min-height laisserait le libellé collé en haut du bouton. */
.gallery-strip__promote,
.gallery-strip__insert {
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  min-height: 44px;
  font-size: 12px;
  padding: 4px 8px;
  border: 1px solid var(--line);
  border-radius: var(--r-pill);
  background: var(--surface);
  color: var(--ink-70);
  width: 100%;
}
.gallery-strip__insert:disabled { opacity: 0.5; }
.gallery-strip__img { width: 56px; height: 56px; object-fit: cover; border-radius: var(--r-sm); display: block; }
.gallery-strip__del { position: absolute; top: -6px; right: -6px; width: 26px; height: 26px; border-radius: 50%; background: var(--surface); border: 1px solid var(--line); display: flex; align-items: center; justify-content: center; }
.gallery-strip__del::after { content: ''; position: absolute; inset: -9px; }
/* Les règles .gallery-strip__addgroup ont disparu avec le groupe de 3 boutons qu'elles
   habillaient (un seul bouton + menu désormais) : supprimées plutôt que laissées orphelines. */
.gallery-strip__add {
  min-height: 56px;
  width: 100%;
  justify-content: center;
}
.gallery-strip__fileinput {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.correct {
  max-width: var(--w-content); /* repris de .screen : centrage tablette/desktop */
  margin: 0 auto;
  padding: var(--sp-4) max(var(--sp-4), var(--sa-right)) 0
    max(var(--sp-4), var(--sa-left)); /* .screen sans le padding-bas : géré par la barre d'action */
}
.correct__body {
  padding-bottom: var(--sp-4);
}
.correct__actions {
  position: sticky;
  bottom: 0;
  display: flex;
  gap: var(--sp-2);
  /* Retour terrain (Nexus 7, second tour) : bandeau abaissé, retour terrain
     répété — « le bandeau Annuler/Enregistrer est trop haut, surtout clavier ouvert ».
     Padding vertical --sp-3/12px -> --sp-2/8px (le vrai levier) + boutons 48px -> 44px
     (cf. règle `.btn` ci-dessous, un PLANCHER, pas une hauteur imposée : leur contenu
     icône+texte les rend naturellement ~47px, cette règle ne les CONTRAINT donc plus —
     44px reste la cible tactile MINIMALE du projet, contrainte globale, jamais
     en dessous, même sans être la valeur RENDUE). Bandeau mesuré (Playwright, Pixel 5,
     rendu réel, pas un calcul arithmétique déclaratif) : 73px -> 64px, soit -12%.
     `padding-bottom` gardé lié à `--sa-bottom` (encoche bas
     d'écran), intact. */
  padding: var(--sp-2) var(--sp-4);
  padding-bottom: calc(var(--sp-2) + var(--sa-bottom));
  margin: 0 calc(-1 * var(--sp-4)); /* pleine largeur sous le padding du .correct */
  background: var(--bg);
  border-top: 1px solid var(--line);
}
.correct__actions .btn {
  flex: 1;
  min-height: 44px;
  justify-content: center;
}
</style>
