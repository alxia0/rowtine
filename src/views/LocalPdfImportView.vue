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
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AppHeader from '@/components/AppHeader.vue'
import AppIcon from '@/components/AppIcon.vue'
import ImportProgress from '@/components/ImportProgress.vue'
import { usePatternsStore } from '@/stores/patterns'
import { useSnackbarStore } from '@/stores/snackbar'
import { parsePdfLocally } from '@/utils/pdf-import'
import { unzipToPattern } from '@/utils/zip-import'
import { sniffFile } from '@/utils/import-kind'
import { isSingleSize } from '@/utils/reader'
import { useImportProgress } from '@/composables/useImportProgress'
import { useImportHandoff } from '@/stores/import-handoff'
import { useImportReportStore } from '@/stores/import-report'
import { useImportSuccessStore } from '@/stores/import-success'
import { beginImport, endImport } from '@/backup/import-guard'
import { isSyncRunning, whenSyncIdle } from '@/backup/patron-md-sync'
import { CONTACT_EMAIL } from '@/constants/app-links'
import { GUIDE_SECTION_BIBLIOTHEQUE } from '@/constants/guide-sections'

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
const result = ref(null) // { pattern, reader, warnings, confidence, stats, scanned }
const savedId = ref(null)
// Portées par le bloc de réussite (savedId != null) : le nom vient du patron tel
// qu'écrit en base (identique aux 2 voies, PDF et zip), le compte de warnings de la
// liste que ce même enregistrement a poussée dans import-report.
const savedName = ref('')
const savedWarnCount = ref(0)
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
    kind = 'pdf' // fichier illisible : la voie PDF portera l'erreur, pas de message de plus
  }
  if (token !== importToken) return // abandon pendant la lecture des 4 octets
  if (kind === 'zip') {
    await startZipImport(file, token)
    return
  }
  progress.begin('local', file.size || 0)
  try {
    const out = await parsePdfLocally(file, { onProgress: (e) => progress.report(e) })
    if (token !== importToken) return // import interrompu entre-temps : résultat tardif ignoré
    result.value = out
    progress.end()
    // PDF scanné OU import risqué (blocking) : on n'enregistre PAS automatiquement,
    // l'écran reste affiché. Le scanné aiguille vers la saisie manuelle ou le contact
    // ; le bloqué propose « Importer quand même » (saveAndView) — réversible,
    // « jamais perdre d'info ».
    if (!out.scanned && !out.blocking?.blocked) await saveAndView()
  } catch (err) {
    if (token !== importToken) return
    error.value = err?.message || String(err)
    progress.reset()
  } finally {
    if (token === importToken) busy.value = false
  }
}

// PORTE DE SERVICE (08/08). Un .zip déposé dans l'import PDF est un patron déjà mis en
// forme (Rowtine-MD + images). RIEN ne l'annonce dans l'interface : ni libellé, ni titre,
// ni texte d'aide — seul le filtre du sélecteur de fichiers le laisse sélectionnable. Elle
// sert à dépanner une utilisatrice dont le PDF ne passe pas, en lui retravaillant son
// patron. Ne pas la documenter dans l'interface ni dans le guide.
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
  importSuccess.set(savedId.value, savedName.value, savedWarnCount.value)
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
  <AppHeader :title="t('importLocal.title')" back />
  <main class="screen">
    <p class="lead">{{ t('importLocal.lead') }}</p>
    <p class="lead">{{ t('importLocal.leadNext') }}</p>

    <label v-if="!busy && savedId == null" class="btn btn--primary btn--block file-pick">
      <AppIcon name="import" :size="18" /> {{ t('importLocal.pick') }}
      <input type="file" accept="application/pdf,.pdf,.zip,application/zip" class="file-pick__input" @change="onFile" />
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

    <!-- PDF scanné : la voie locale ne peut rien extraire (aucun texte). On invite à
         saisir le patron à la main, ou à nous écrire pour se faire aider — plus d'IA. -->
    <section v-if="result?.scanned" class="res mt3">
      <p class="warn"><AppIcon name="warning" :size="15" /> {{ t('importLocal.scanned', { email: CONTACT_EMAIL }) }}</p>
    </section>

    <!-- Import risqué (blocking) : le moteur a détecté un cas mal géré
         (colonnes / multi-patrons). Auto-save suspendu (cf. startImport) ; l'écran
         reste affiché avec les raisons et un bouton réversible « Importer quand
         même » qui déclenche saveAndView() manuellement. « Interrompre l'import »
         reste disponible plus bas — « jamais perdre d'info » : rien n'empêche
         l'import, seul l'automatisme est mis en pause. -->
    <section v-if="result && !result.scanned && result.blocking?.blocked && savedId == null" class="res mt3" role="alert">
      <p class="warn"><AppIcon name="warning" :size="15" /> {{ t('importLocal.blockTitle') }}</p>
      <ul class="block-reasons">
        <li v-if="result.blocking.reasons.includes('columns')">{{ t('importLocal.blockColumns') }}</li>
        <li v-if="result.blocking.reasons.includes('multiPattern')">{{ t('importLocal.blockMultiPattern') }}</li>
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
         n > 0 : l'une compte ce que le moteur a repéré, l'autre dit qu'il ne repère pas tout. -->
    <section v-if="savedId != null" class="res mt3 done">
      <p class="done__title"><AppIcon name="check" :size="18" /> {{ t('importLocal.doneTitle') }}</p>
      <p class="done__name">« {{ savedName }} »</p>
      <p v-if="savedWarnCount > 0" class="muted">{{ t('importLocal.warnings', { n: savedWarnCount }) }}</p>
      <p class="done__caveat">
        <AppIcon name="warning" :size="15" /> {{ t('importLocal.doneCaveat') }}
      </p>
      <button type="button" class="btn btn--block done__howto" @click="howToFix">
        {{ t('importLocal.doneHowToFix') }}
      </button>
      <button type="button" class="btn btn--primary btn--block mt2" @click="viewPattern">
        {{ t('importLocal.viewPattern') }}
      </button>
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
.done__title { display: flex; align-items: center; gap: var(--sp-2); font-weight: 700; color: var(--success); margin: 0 0 var(--sp-2); }
.done__name { font-size: 15px; margin: 0 0 var(--sp-2); }
.done__caveat { display: flex; align-items: flex-start; gap: var(--sp-2); color: var(--ink-55); font-size: 13px; margin: var(--sp-2) 0; }
.warn { color: var(--warning); font-size: 13.5px; margin: 0 0 var(--sp-3); }
.block-reasons { margin: 0 0 var(--sp-2); padding-left: 1.1em; color: var(--ink-70); font-size: 13.5px; }
.block-anyway { margin-top: var(--sp-2); }
</style>
