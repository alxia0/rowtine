<script setup>
// Import PDF local (voie par défaut) : analyse sur l'appareil, gratuite et hors-ligne.
// Le texte n'est plus édité ici. Depuis le 17/08 : dès que
// l'enregistrement réussit, l'écran RESTE affiché — un bloc de réussite montre le nom du
// patron et, en bouton d'action principal, « Voir le patron », qui fait la navigation au
// clic (cf. viewPattern ci-dessous). Depuis le 19/08, un second bouton, « Comment
// corriger » (cf. howToFix), renvoie au guide : voir le commentaire du bloc de réussite
// dans le template pour le pourquoi. Les warnings d'import survivent au saut d'écran via
// le store transitoire import-report, affichés en bandeau persistant sur PatternView.
// La correction reste accessible depuis l'aperçu Prévisualiser de la fiche (écran
// « Corriger le patron », cf. CorrectionView.vue et ReaderView.vue).
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AppHeader from '@/components/AppHeader.vue'
import AppIcon from '@/components/AppIcon.vue'
import ImportProgress from '@/components/ImportProgress.vue'
import { usePatternsStore } from '@/stores/patterns'
import { useSnackbarStore } from '@/stores/snackbar'
import { parsePdfLocally } from '@/utils/pdf-import'
import { unzipToPattern } from '@/utils/zip-import'
import { sniffFile, PDF_ACCEPT, ROWTINE_ACCEPT } from '@/utils/import-kind'
import { isSingleSize } from '@/utils/reader'
import { summarizeImportedPattern } from '@/utils/import-summary'
import { useImportProgress } from '@/composables/useImportProgress'
import { useImportHandoff } from '@/stores/import-handoff'
import { useImportReportStore } from '@/stores/import-report'
import { useImportSuccessStore } from '@/stores/import-success'
import { beginImport, endImport } from '@/backup/import-guard'
import { isSyncRunning, whenSyncIdle } from '@/backup/patron-md-sync'
import { CONTACT_EMAIL } from '@/constants/app-links'
import { GUIDE_SECTION_BIBLIOTHEQUE } from '@/constants/guide-sections'

// Porte d'entrée (23/09) : 'pdf' (défaut) ou 'rowtine', passée par la route
// (`?format=rowtine`, cf. router/index.js). Le retour arrière depuis le guide garde la requête.
const props = defineProps({ format: { type: String, default: 'pdf' } })
const isRowtine = computed(() => props.format === 'rowtine')

const router = useRouter()
const { t } = useI18n()
const patternsStore = usePatternsStore()
const snackbar = useSnackbarStore()
const handoff = useImportHandoff()
const importReport = useImportReportStore()
// Relais du bloc de réussite à travers l'aller-retour vers le guide (cf. import-success.js).
const importSuccess = useImportSuccessStore()

const busy = ref(false)
const error = ref('')
const progress = useImportProgress()
const result = ref(null) // { pattern, reader, warnings, confidence, stats, blocking, rejected, … } (cf. pdf-import/index.js)
const savedId = ref(null)
// Portées par le bloc de réussite (savedId != null) : le nom vient du patron tel
// qu'écrit en base (identique aux 2 voies, PDF et zip), le compte de warnings de la
// liste que ce même enregistrement a poussée dans import-report.
const savedName = ref('')
const savedWarnCount = ref(0)
// Bilan du patron enregistré (sections/étapes/tailles/diagrammes) et « prévisualisable »
// (même condition que le bouton Prévisualiser de PatternView.vue) : posés par ensureSaved,
// restitués par le relais import-success au retour du guide (cf. onMounted plus bas et
// howToFix). Portent la mise en page du bloc de réussite, jamais l'enregistrement lui-même.
const savedSummary = ref(null)
const savedPreviewable = ref(true)
// true pendant l'écriture IndexedDB (patternsStore.add) : masque le bouton
// d'abandon (cf. template) et rend ensureSaved non ré-entrant (double-tap).
const saving = ref(false)
// true le temps d'attendre la fin d'une synchro MD DÉJÀ en cours à l'ouverture de cet
// écran (repro nexus7_2026-08-26) : `beginImport` (import-guard.js) empêche une NOUVELLE
// synchro de démarrer, mais n'interrompt pas une synchro déjà lancée avant l'ouverture de
// l'écran (ex. réveil de l'écran juste avant). Sans cet état, l'écran restait silencieux
// pendant que la synchro continuait de lire les patrons un par un en tâche de fond, sur un
// appareil lent, plusieurs minutes durant.
const waitingSync = ref(false)
// Jeton d'import : parsePdfLocally n'est pas annulable (pas d'AbortController côté
// moteur). « Interrompre l'import » incrémente ce jeton ; si la conversion en cours
// se termine malgré tout, sa résolution tardive est ignorée (cf. abortImport).
let importToken = 0

// Message du refus net (scanné, pas un patron, plusieurs patrons) : un seul encart, un seul
// texte, choisi par `result.rejected.reason`. Aucun bouton de forçage : ces fichiers ne
// donneraient pas un patron utilisable (spec rejets d'import du 2026-09-24).
const rejectMessage = computed(() => {
  const reason = result.value?.rejected?.reason
  if (reason === 'scanned') return t('importLocal.scanned', { email: CONTACT_EMAIL })
  if (reason === 'notPattern') return t('importLocal.notPattern', { email: CONTACT_EMAIL })
  if (reason === 'multiPattern') return t('importLocal.blockMultiPattern')
  return ''
})

// Cœur d'import partagé par le sélecteur de fichier local ET par le relais depuis la
// Bibliothèque (cf. useImportHandoff). parsePdfLocally n'est pas annulable : le jeton
// invalide un résultat tardif si l'import a été interrompu entre-temps.
//
// Dès que la conversion réussit (et n'est pas un PDF scanné, cf. plus
// bas), on enchaîne AUTOMATIQUEMENT l'enregistrement (saveAndView) — plus d'écran de
// revue intermédiaire à taper pour continuer. Depuis le 17/08 : plus de
// navigation automatique ensuite — l'écran RESTE affiché, un bloc de réussite prend
// le relais (cf. template, savedId != null) avec le bouton « Voir le patron » qui
// fait la navigation au clic.
async function startImport(file) {
  if (!file) return
  const token = ++importToken
  busy.value = true
  error.value = ''
  result.value = null
  savedId.value = null
  // Un nouvel import périme le bloc de réussite du précédent — ici plutôt que chez les deux
  // appelants (le sélecteur de fichier et le relais depuis la Bibliothèque) : c'est le seul
  // endroit par où passent les deux.
  importSuccess.clear()
  // Synchro MD déjà en cours à l'ouverture de l'écran (cf. déclaration de waitingSync) :
  // on attend qu'elle libère le thread avant de lancer l'analyse, plutôt que de la lancer
  // en concurrence et laisser l'écran paraître inerte pendant que les deux se disputent
  // le pont natif. `whenSyncIdle` ne rejette jamais (cf. patron-md-sync.js).
  if (isSyncRunning()) {
    waitingSync.value = true
    await whenSyncIdle()
    if (token !== importToken) return // « Interrompre l'import » tapé pendant l'attente
    waitingSync.value = false
  }
  // Reconnaissance AVANT progress.begin : le profil de la barre ('local' | 'zip') en dépend.
  // Un begin() posé avant ferait dérouler à un import zip la liste de phases du PDF —
  // une barre qui décrit une opération qui n'a pas lieu.
  let kind
  try {
    kind = await sniffFile(file)
  } catch {
    // Fichier illisible : par la porte PDF, la voie PDF portera l'erreur, pas de message de plus.
    kind = isRowtine.value ? 'unknown' : 'pdf'
  }
  if (token !== importToken) return // abandon pendant la lecture des 4 octets
  if (kind === 'zip') {
    await startZipImport(file, token)
    return
  }
  // Porte .rowtine : un contenu qui n'est pas une archive est refusé, jamais envoyé en
  // silence au moteur PDF (pas de repli 'unknown' vers le PDF ici, contrairement à la porte PDF).
  if (isRowtine.value) {
    error.value = t('importZip.badZip')
    busy.value = false
    return
  }
  progress.begin('local', file.size || 0)
  try {
    const out = await parsePdfLocally(file, { onProgress: (e) => progress.report(e) })
    if (token !== importToken) return // import interrompu entre-temps : résultat tardif ignoré
    result.value = out
    progress.end()
    // Refus net (rejected : scanné, pas un patron, plusieurs patrons) OU import risqué
    // (blocking : colonnes) : on n'enregistre PAS automatiquement, l'écran reste affiché.
    // Le refus dit pourquoi et laisse choisir un autre fichier ; le risqué propose
    // « Importer quand même » (saveAndView), réversible, « jamais perdre d'info ».
    if (!out.rejected && !out.blocking?.blocked) await saveAndView()
  } catch (err) {
    if (token !== importToken) return
    error.value = err?.message || String(err)
    progress.reset()
  } finally {
    if (token === importToken) busy.value = false
  }
}

// Import d'un patron au format de l'app (.rowtine ou .zip : Rowtine-MD + images). Depuis le
// 23/09, porte visible et documentée (option de la feuille d'ajout, mode `format` rowtine) ;
// un zip déposé par la porte PDF reste reconnu à son contenu et suit ce même chemin.
//
// La décompression décode et plafonne chaque image du kit (resizeDataUrl, canvas) : ce n'est
// PLUS synchrone depuis le 15/08/2026 (compression des images importées). Deux fenêtres
// d'abandon désormais : après `file.arrayBuffer()`, et après `unzipToPattern` (qui peut prendre
// un temps réel si le kit contient plusieurs images) — le chemin partagé (ensureSaved) ferme de
// toute façon l'écriture en base.
async function startZipImport(file, token) {
  progress.begin('zip', file.size || 0)
  try {
    const buf = await file.arrayBuffer()
    if (token !== importToken) return
    progress.report({ phase: 'read' })
    const { pattern, warnings } = await unzipToPattern(new Uint8Array(buf))
    if (token !== importToken) return
    progress.report({ phase: 'images' })
    progress.end()
    // `low` = false : l'import zip n'a pas d'indice de confiance. Ne PAS inventer de valeur,
    // qui ferait afficher un bandeau « qualité faible » mensonger sur la fiche.
    await saveAndFinish(pattern, warnings, false)
  } catch (err) {
    if (token !== importToken) return
    // Codes stables du cœur pur → message clair ; sinon message générique.
    const code = err?.code
    error.value =
      code === 'no-md' ? t('importZip.noMd') : code === 'bad-zip' ? t('importZip.badZip') : t('importZip.failed')
    progress.reset()
  } finally {
    if (token === importToken) busy.value = false
  }
}

function onFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  startImport(file)
}

// Garde import↔synchro MD (repro nexus7_2026-08-25, cf. import-guard.js) : tant que cet
// écran est monté, `syncPatronMd` ne démarre plus tout seul au retour du sélecteur de
// fichiers système (événement `resume`, App.vue) — sur un appareil lent, ce balayage
// complet de la bibliothèque peut prendre plusieurs minutes et masquait toute
// progression d'import. Portée volontairement large (tout le montage, pas juste
// `busy`) : l'écran reste "en cours d'import" tant qu'on peut y choisir un nouveau
// fichier (y compris après un abandon, cf. abortImport).
onMounted(() => {
  beginImport()
})
onUnmounted(() => {
  endImport()
})

// Import lancé depuis la Bibliothèque : le fichier a été posé dans le relais avant la
// navigation ; on le consomme et on démarre directement la progression.
onMounted(() => {
  const f = handoff.take()
  if (f) {
    startImport(f)
    return
  }
  // Aucun fichier en relais : on n'ARRIVE pas de la Bibliothèque (le seul chemin qui pousse
  // vers cet écran y dépose toujours un fichier d'abord, cf. LibraryView.onImportFile) — on
  // REVIENT. On restitue alors le bloc de réussite tel qu'il a été quitté : nom, nombre
  // d'avertissements et bouton « Voir le patron », qui a besoin de l'identifiant. Sans ça,
  // l'écran repartait vierge et l'utilisatrice perdait le fil au moment précis où elle suivait
  // notre conseil (point 6 de la revue du 19/08).
  //
  // Le relais n'étant posé QUE par « Comment corriger » (cf. howToFix), il n'y a rien à
  // restituer dans tous les autres cas — un montage sans fichier et sans aller-retour en cours
  // repart bien de l'écran de choix de fichier.
  if (importSuccess.patternId != null) {
    savedId.value = importSuccess.patternId
    savedName.value = importSuccess.name
    savedWarnCount.value = importSuccess.warnCount
    savedSummary.value = importSuccess.summary
    savedPreviewable.value = importSuccess.previewable
  }
})

function currentPattern() {
  // Le texte n'est plus édité à l'import : le reader assemblé par
  // parsePdfLocally (déjà normalisé dans assemble.js, PUIS enrichi par
  // promoteGridSections — cf. pdf-import/index.js) est utilisé tel quel. Le
  // re-passer dans normalizeReaderForSave recalculerait les ids (slug du
  // titre) et risquerait de désynchroniser une section-diagramme promue.
  const reader = result.value.reader
  return { ...result.value.pattern, reader, sizes: isSingleSize(reader.sizeLabels) ? [] : reader.sizeLabels }
}

// Chemin d'enregistrement PARTAGÉ par les deux voies d'import (PDF et zip). Il porte, et
// lui seul : le jeton d'import, l'écriture en base, le nettoyage de l'orphelin quand
// l'abandon tombe pendant l'écriture, la remontée des avertissements vers la fiche, le
// message de confirmation, et le renseignement du bloc de réussite (`savedName`,
// `savedWarnCount`).
//
// ⚠️ Il reçoit un patron DÉJÀ CONSTRUIT, et c'est volontaire : les deux voies ne rendent pas
// le même objet. parsePdfLocally pose le `reader` À CÔTÉ du pattern (d'où currentPattern(),
// qui en dérive `sizes`), alors qu'unzipToPattern le pose DANS le pattern, avec des `sizes`
// déjà normalisées par la couche zip. Faire passer un patron zip dans currentPattern()
// lèverait sur un `reader` absent.
async function ensureSaved(patternObject, warnings, low) {
  if (savedId.value != null) return savedId.value
  if (saving.value) return null // écriture déjà en vol : anti double-tap, ne pas relancer add()
  saving.value = true
  const token = importToken // capturé avant l'await : détecte un abandon pendant l'écriture
  try {
    const id = await patternsStore.add(patternObject)
    if (token !== importToken) {
      // « Interrompre l'import » a été tapé pendant l'écriture (race) : patternsStore.add
      // n'est pas annulable, la ligne est déjà en base. On la retire pour ne pas laisser un
      // patron orphelin, et on n'affecte ni savedId ni le snackbar.
      try {
        await patternsStore.remove(id)
      } catch {
        // best-effort : un échec de nettoyage ne doit pas faire remonter d'erreur ici
      }
      return null
    }
    savedId.value = id
    savedName.value = patternObject.name
    savedWarnCount.value = Array.isArray(warnings) ? warnings.length : 0
    savedSummary.value = summarizeImportedPattern(patternObject)
    // Même condition que le bouton « Prévisualiser » de PatternView.vue (cf. son template) :
    // un patron sans section ET sans galerie n'a rien à prévisualiser, le bloc retombe sur
    // « Voir le patron » plutôt que d'ouvrir un lecteur vide.
    savedPreviewable.value = !!(patternObject.reader?.sections?.length || patternObject.gallery?.length)
    snackbar.show(t('importLocal.saved'))
    importReport.set(id, warnings, low)
    return savedId.value
  } finally {
    saving.value = false
  }
}

// Enregistre le patron et s'arrête là : plus de navigation automatique, sur aucun des
// trois chemins qui l'appellent (PDF réussi, zip, « Importer quand même »). C'est le
// bouton « Voir le patron » (cf. viewPattern) qui navigue, au clic de l'utilisatrice.
async function saveAndFinish(patternObject, warnings, low) {
  await ensureSaved(patternObject, warnings, low)
}

// Fait la navigation que saveAndFinish ne fait plus. replace (pas push) : l'écran
// d'import quitte l'historique, le bouton retour de la fiche patron ramène à la
// bibliothèque et pas à l'écran d'import terminé.
function viewPattern() {
  // Le relais a fini son office : `replace` retire l'écran d'import de l'historique, on ne
  // reviendra pas sur ce bloc de réussite. Le garder afficherait, à un import suivant qui
  // échouerait avant d'enregistrer, la réussite du précédent.
  importSuccess.clear()
  router.replace({ name: 'pattern', params: { id: savedId.value } })
}

// Bouton principal du bloc de réussite quand le patron A quelque chose à prévisualiser
// (cf. savedPreviewable). `replace` d'abord (même raison que viewPattern ci-dessus : la
// fiche prend la place de l'écran d'import dans l'historique), PUIS `push` vers le lecteur
// — le bouton retour du lecteur ramène ainsi sur la fiche, où l'on crée le projet, jamais
// sur ce bloc de réussite. `await` avant le `push` : même garde d'ordre que startFix dans
// ReaderView.vue (son commentaire fait référence), sans quoi vue-router peut abandonner la
// navigation vers la fiche si les deux appels tombent dans le même tick.
async function previewPattern() {
  importSuccess.clear()
  await router.replace({ name: 'pattern', params: { id: savedId.value } })
  router.push({ name: 'pattern-read', params: { id: savedId.value } })
}

// Renvoi vers le guide, section « Ta bibliothèque de patrons » (19/08/2026). Même
// destination que la pop-up d'avertissement de la Bibliothèque : une seule page à tenir à
// jour, pas deux.
function howToFix() {
  // LE RELAIS EST POSÉ ICI, ET NULLE PART AILLEURS. Ce bouton n'existe qu'À L'INTÉRIEUR du
  // bloc de réussite (`savedId != null`, cf. le gabarit) : le relais ne peut donc pas être
  // posé sans qu'un patron soit réellement en base — la voie scannée, qui n'enregistre rien,
  // n'a jamais ce bouton. Et il ne vit que le temps de l'aller-retour qu'on déclenche à la
  // ligne suivante, au lieu de survivre à toute la session : un bloc de réussite périmé,
  // rouvert plus tard sur un import qui n'a pas eu lieu, serait un mensonge d'interface.
  importSuccess.set(savedId.value, savedName.value, savedWarnCount.value, savedSummary.value, savedPreviewable.value)
  router.push({ name: 'guide', query: { section: GUIDE_SECTION_BIBLIOTHEQUE } })
}

// Voie PDF. Conservée sous ce nom : le gabarit l'appelle sur « Importer quand même ».
// Qualité faible = confidence.global < 50 (direct — les paliers de `level` sont 40/70).
async function saveAndView() {
  await saveAndFinish(
    currentPattern(),
    result.value.warnings,
    (result.value.confidence?.global ?? 100) < 50,
  )
}

// Abandonne l'import en cours (mauvais fichier, changement d'avis) : rien
// n'est enregistré. La conversion en cours n'est pas annulable côté moteur
// (parsePdfLocally n'expose pas d'AbortController) : on invalide le jeton
// pour que sa résolution tardive soit ignorée, et l'écran repart de zéro,
// prêt à choisir un nouveau fichier.
function abortImport() {
  importToken++
  busy.value = false
  waitingSync.value = false
  error.value = ''
  result.value = null
  savedId.value = null
  importSuccess.clear() // rien n'est enregistré : aucun bloc de réussite à retrouver
  progress.reset()
}
</script>

<template>
<div>
  <AppHeader :title="t(isRowtine ? 'importLocal.titleRowtine' : 'importLocal.title')" back />
  <main class="screen">
    <p class="lead">{{ t(isRowtine ? 'importLocal.leadRowtine' : 'importLocal.lead') }}</p>
    <p class="lead">{{ t('importLocal.leadNext') }}</p>

    <label v-if="!busy && savedId == null" class="btn btn--primary btn--block file-pick">
      <AppIcon name="import" :size="18" /> {{ t(isRowtine ? 'importLocal.pickRowtine' : 'importLocal.pick') }}
      <input type="file" :accept="isRowtine ? ROWTINE_ACCEPT : PDF_ACCEPT" class="file-pick__input" @change="onFile" />
    </label>

    <!-- Synchro MD déjà en cours à l'ouverture de l'écran (cf. waitingSync) : l'écran
         reste silencieux sinon, le temps qu'elle libère le thread — sur un appareil
         lent, cela peut prendre plusieurs minutes (repro nexus7_2026-08-26). -->
    <p v-if="waitingSync" class="lead">{{ t('importLocal.waitingSync') }}</p>

    <ImportProgress
      v-if="busy && !waitingSync"
      :pct="progress.pct.value"
      :label-key="progress.labelKey.value"
      :elapsed-sec="progress.elapsedSec.value"
      :page="progress.page.value"
      :total="progress.total.value"
    />
    <p v-if="error" class="err">{{ error }}</p>

    <!-- Refus net (spec du 2026-09-24) : PDF scanné, fichier qui n'est pas un patron de
         tricot ou de crochet, ou recueil de plusieurs patrons. Rien n'est enregistré et
         aucun bouton ne force l'import ; le sélecteur reste affiché pour choisir un autre
         fichier. -->
    <section v-if="result?.rejected" class="res mt3" role="alert">
      <p class="warn"><AppIcon name="warning" :size="15" /> {{ rejectMessage }}</p>
    </section>

    <!-- Import risqué (blocking) : le moteur a détecté un cas mal géré
         (colonnes). Auto-save suspendu (cf. startImport) ; l'écran
         reste affiché avec les raisons et un bouton réversible « Importer quand
         même » qui déclenche saveAndView() manuellement. « Interrompre l'import »
         reste disponible plus bas — « jamais perdre d'info » : rien n'empêche
         l'import, seul l'automatisme est mis en pause. -->
    <section v-if="result && !result.rejected && result.blocking?.blocked && savedId == null" class="res mt3" role="alert">
      <p class="warn"><AppIcon name="warning" :size="15" /> {{ t('importLocal.blockTitle') }}</p>
      <ul class="block-reasons">
        <li v-if="result.blocking.reasons.includes('columns')">{{ t('importLocal.blockColumns') }}</li>
      </ul>
      <p class="muted">{{ t('importLocal.blockLead') }}</p>
      <button type="button" class="btn btn--primary btn--block block-anyway" @click="saveAndView">
        <AppIcon name="import" :size="17" /> {{ t('importLocal.importAnyway') }}
      </button>
    </section>

    <!-- Import réussi (PDF, zip, ou « Importer quand même ») : l'écran reste affiché
         (17/08). savedId != null couvre les trois chemins — pas `result`,
         que la voie zip ne renseigne jamais. Les warnings d'import survivent dans le
         bandeau de la fiche (cf. import-report store + PatternView.vue) : ce bloc-ci ne
         fait qu'annoncer leur nombre, il ne les détaille pas.
         AJOUT DU 19/08/2026 : la phrase d'avertissement est FIXE, affichée quel que soit le
         nombre d'avertissements — ZÉRO COMPRIS. C'est justement le cas qui inquiète : la
         conversion peut se tromper sans lever le moindre avertissement, et jusqu'ici l'écran
         ne disait alors rien du tout. La ligne « n point(s) à vérifier » reste conditionnée à
         n > 0 : l'une compte ce que le moteur a repéré, l'autre dit qu'il ne repère pas tout.
         Refonte du bloc de réussite (lot du 23/09/2026) : le bloc « res » générique cède la
         place à trois cartes empilées — bilan (vert), avertissement (ambre), bouton
         d'action — plutôt qu'une seule carte à fond neutre. `savedSummary` (sections/
         étapes/tailles/diagrammes, cf. summarizeImportedPattern) est posé par ensureSaved
         en même temps que savedName — `&& savedSummary` ci-dessous est une garde
         défensive : rien dans ce fichier ne pose savedId sans lui, mais la grille juste en
         dessous lit `savedSummary.*` sans autre filet. -->
    <section v-if="savedId != null && savedSummary" class="done mt3">
      <div class="done__summary">
        <div class="done__summary-head">
          <span class="done__badge done__badge--ok"><AppIcon name="check" :size="16" /></span>
          <h2 class="done__summary-title">{{ t('importLocal.summaryTitle') }}</h2>
        </div>
        <p class="done__name">« {{ savedName }} »</p>
        <div class="done__grid">
          <div class="done__tile">
            <p class="done__tile-val">{{ savedSummary.sections }}</p>
            <p class="done__tile-label">{{ t('importLocal.summary.sections', savedSummary.sections) }}</p>
          </div>
          <div class="done__tile">
            <p class="done__tile-val">{{ savedSummary.steps }}</p>
            <p class="done__tile-label">{{ t('importLocal.summary.steps', savedSummary.steps) }}</p>
          </div>
          <div class="done__tile">
            <p class="done__tile-val">{{ savedSummary.singleSize ? 1 : savedSummary.sizes }}</p>
            <p class="done__tile-label">
              {{ savedSummary.singleSize ? t('importLocal.summary.singleSize') : t('importLocal.summary.sizes', savedSummary.sizes) }}
            </p>
          </div>
          <!-- Tuile masquée à 0 diagramme (brief) : contrairement aux trois autres, un
               patron SANS diagramme est le cas courant — l'annoncer partout alourdirait
               inutilement la grille pour la majorité des imports. -->
          <div v-if="savedSummary.charts > 0" class="done__tile">
            <p class="done__tile-val">{{ savedSummary.charts }}</p>
            <p class="done__tile-label">{{ t('importLocal.summary.charts', savedSummary.charts) }}</p>
          </div>
        </div>
      </div>

      <div class="done__caveat">
        <div class="done__caveat-head">
          <span class="done__badge done__badge--warn"><AppIcon name="warning" :size="15" /></span>
          <div class="done__caveat-body">
            <h2 class="done__caveat-title">{{ t('importLocal.caveatTitle') }}</h2>
            <p class="done__caveat-text">{{ t('importLocal.caveatBody') }}</p>
            <p v-if="savedWarnCount > 0" class="done__warncount">{{ t('importLocal.warnings', { n: savedWarnCount }) }}</p>
          </div>
        </div>
        <button type="button" class="btn btn--block done__howto" @click="howToFix">
          {{ t('importLocal.doneHowToFix') }}
        </button>
      </div>

      <!-- Bouton d'action principal : « Prévisualiser le patron » (mène au lecteur, cf.
           previewPattern) sauf pour un patron sans section ni galerie, qui retombe sur
           « Voir le patron » (viewPattern) — même condition que PatternView.vue pour son
           propre bouton Prévisualiser, cf. savedPreviewable posé par ensureSaved. -->
      <button v-if="savedPreviewable" type="button" class="btn btn--primary btn--block" @click="previewPattern">
        {{ t('pattern.preview') }}
      </button>
      <button v-else type="button" class="btn btn--primary btn--block" @click="viewPattern">
        {{ t('importLocal.viewPattern') }}
      </button>

      <p class="done__hint">{{ t('importLocal.nextHint') }}</p>
    </section>

    <!-- Bouton d'abandon : reachable dès qu'il y a quelque chose à annuler
         (conversion en cours ou résultat pas encore enregistré), y compris
         sur l'écran « PDF scanné ». Masqué pendant l'écriture en base
         (`saving`) : ferme la course à l'abandon au niveau UI (le jeton
         d'import ci-dessus reste la garde qui fait foi, cf. ensureSaved). -->
    <button v-if="(busy || result) && !saving && savedId == null" class="btn btn--block mt2" @click="abortImport">
      <AppIcon name="close" :size="18" /> {{ t('importLocal.cancelImport') }}
    </button>
  </main>
</div>
</template>

<style scoped>
.lead { color: var(--ink-70); font-size: 14px; margin-bottom: var(--sp-4); }
.file-pick { cursor: pointer; margin-bottom: var(--sp-3); }
/* input masqué visuellement mais gardé dans l'ordre de tabulation et l'arbre
   d'accessibilité (WCAG 2.1.1) : le <label> stylé reste le bouton visible, mais
   le contrôle réel reçoit toujours le focus clavier — à l'inverse de [hidden]. */
.file-pick__input { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
/* focus visible : l'anneau se porte sur le label puisque l'input réel est masqué.
   `:focus-within` (et non `:has(:focus-visible)`) car `:has()` manque aux WebView Android
   < Chrome 105 — l'anneau n'y apparaissait jamais. Compromis assumé : `:focus-within` peut
   aussi s'allumer après un tap (pas seulement au clavier), acceptable pour un bouton d'import. */
.file-pick:focus-within { outline: 2px solid var(--brand-deep); outline-offset: 2px; border-radius: var(--r-md); }
.mt2 { margin-top: var(--sp-2); }
.mt3 { margin-top: var(--sp-4); }
.muted { color: var(--ink-55); font-size: 13px; }
.err { color: var(--danger); font-size: 14px; font-weight: 600; }
.res { background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-md); box-shadow: var(--clay-sm); padding: var(--sp-4); }
/* Bloc de réussite (lot du 23/09/2026) : trois cartes empilées, pas de fond commun (.res
   ne s'y applique plus). */
.done { display: flex; flex-direction: column; gap: var(--sp-4); }
.done__badge { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: var(--r-pill); flex-shrink: 0; color: var(--on-solid); }
.done__badge--ok { background: var(--sage); }
.done__badge--warn { background: var(--warning); }
/* Carte bilan : vert doux du thème (même dégradé que les tuiles « métrique positive »
   ailleurs dans l'app, cf. --sage-tile-bg dans tokens.css). Le titre y passe par
   --sage-deep-strong, pas --sage-deep : sur ce dégradé, --sage-deep seul descend sous le
   seuil AA en clair (mesuré, même raison que .corr-chip--on, cf. le commentaire du token). */
.done__summary { background: var(--sage-tile-bg); border: 1px solid var(--sage-tile-line); border-radius: var(--r-lg); padding: var(--sp-4); }
.done__summary-head { display: flex; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-3); }
.done__summary-title { font-family: var(--font-display); font-weight: 700; font-size: 18px; color: var(--sage-deep-strong); margin: 0; }
.done__name { font-size: 15px; color: var(--ink-70); margin: 0 0 var(--sp-3); }
.done__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-2); }
.done__tile { background: var(--tile); border-radius: var(--r-sm); padding: var(--sp-2) var(--sp-3); }
.done__tile-val { font-family: var(--font-display); font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; color: var(--ink); margin: 0; }
.done__tile-label { font-size: 13px; color: var(--ink-70); margin: 2px 0 0; }
/* Encart d'avertissement : ambre doux du thème, même formule que .ypur__gap
   (YarnPurchases.vue) — fond color-mix(--warning 12%, --tile), texte par défaut
   --warning (icône + titre), le corps repasse en --ink-70 pour rester lisible. */
.done__caveat { background: color-mix(in srgb, var(--warning) 12%, var(--tile)); border: 1px solid var(--warning); border-radius: var(--r-lg); padding: var(--sp-4); color: var(--warning); }
.done__caveat-head { display: flex; align-items: flex-start; gap: var(--sp-3); }
.done__caveat-body { flex: 1; min-width: 0; }
.done__caveat-title { font-family: var(--font-display); font-weight: 700; font-size: 16px; margin: 0 0 4px; }
.done__caveat-text { font-size: 14px; line-height: 1.45; color: var(--ink-70); margin: 0; }
.done__warncount { font-size: 13px; font-weight: 600; color: var(--ink-70); margin: var(--sp-2) 0 0; }
/* Repasse le bouton `.btn` par défaut (fond --surface, prévu pour une carte neutre) en
   fond clair + bordure/texte ambre : sur le fond déjà teinté de .done__caveat, --surface
   tranchait (lavande sur ambre). Contraste mesuré ≥ 5.5:1 dans les deux thèmes. */
.done__howto { margin-top: var(--sp-3); background: var(--tile); border-color: var(--warning); color: var(--warning); }
.done__hint { text-align: center; color: var(--ink-70); font-size: 14px; line-height: 1.45; margin: calc(-1 * var(--sp-2)) 0 0; }
.warn { color: var(--warning); font-size: 13.5px; margin: 0 0 var(--sp-3); }
.block-reasons { margin: 0 0 var(--sp-2); padding-left: 1.1em; color: var(--ink-70); font-size: 13.5px; }
.block-anyway { margin-top: var(--sp-2); }
</style>
