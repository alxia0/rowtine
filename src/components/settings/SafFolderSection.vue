<script setup>
import { computed, ref, onMounted, watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import { useI18n } from 'vue-i18n'
import { hasFolder } from '@/backup/saf-folder'
import { folderDisplayPath } from '@/backup/saf-folder-label'
import { db } from '@/db/db'
import { runBackup, getBackupStorage } from '@/backup/backup-service'
import { useSnackbarStore } from '@/stores/snackbar'
import { useFolderChangeStore } from '@/stores/folder-change'
import { hasBackup } from '@/backup/restore'
import { isDbRestorable } from '@/backup/restore-service'
import { recordBackupDecision } from '@/backup/backup-decision'
import { backupPauseReason } from '@/backup/backup-pause'
import { describeOrigin, adviceSentence, originSentence } from '@/backup/backup-origin'
import SyncProgressLine from '@/components/SyncProgressLine.vue'
import { beginSyncProgress, endSyncProgress } from '@/backup/progress'
import { isLibraryPattern } from '@/utils/pattern-price'

// La section n'interpole plus de date dans une phrase traduite (la ligne « Copie à
// jour, faite le… » est retirée le 06/09/2026 sur retour d'usage) : plus besoin de
// suivre la `locale` de l'APPLICATION — `t` suffit.
const { t } = useI18n()
const emit = defineEmits(['changed'])
const snackbar = useSnackbarStore()
// Pont Réglages ↔ porte (décision produit du 05/09/2026 : « AJOUTER un
// bouton qui permet de modifier »). Cette section est profonde dans le RouterView, la
// porte (OnboardingFolderPrompt) est montée par App.vue : le mini-store est le fil
// entre les deux (cf. src/stores/folder-change.js pour la répartition des deux champs).
const folderChange = useFolderChangeStore()

// Le bouton « Changer de dossier » est rendu sur plateforme native
// TOUJOURS — sans dossier désigné il FAIT la désignation (même porte, même flux que le
// premier lancement), avec dossier il permet d'en changer. Pas de nouvelle
// confirmation ici : la porte ET le sélecteur système en sont déjà une.
const nativePlatform = Capacitor.isNativePlatform()

// État du dossier désigné. Sans état côté JS — tout vient du
// plugin natif (SharedPreferences) — donc on recharge à chaque montage et après
// chaque désignation réussie. Ce composant est le hub unique remplaçant les boutons
// « Sauvegarder »/« Restaurer » explicites de SettingsView (écriture continue
// débouncée sur mutation — cf. src/backup/auto-backup.js).
const designated = ref(false)
const backupFound = ref(false)
const dbRestorable = ref(false)
// Garde anti-écrasement : reflète le
// VRAI critère de `isBackupPaused` (backup-pause.js) — dossier avec sauvegarde ET
// aucune décision prise POUR CE DOSSIER, plus la DÉCISION, pas `isDbRestorable`.
// Correctif (revue) : avant, cette ligne restait dérivée de `dbRestorable`
// (`backupFound && dbRestorable`) — depuis l'avenant, la garde ne s'éteint plus
// dès que l'utilisatrice a du travail réel, mais `dbRestorable` devient faux dès
// ce même travail réel. Le bouton « Repartir de zéro » (seule porte de sortie
// quand la garde est active, §3.4) aurait alors disparu de l'écran alors que
// `runBackup` continuait de refuser d'écrire — un cul-de-sac invisible.
//
// Lot du 06/08/2026 : cet écran ne REFLÈTE plus le critère, il le LIT. `pauseReason`
// reçoit la réponse de `backupPauseReason(storage)` telle quelle ; la ligne « en pause »
// et le `v-if` du bouton de sortie n'en sont plus que des vues. « Reflète le vrai
// critère » est une promesse qu'une conjonction recopiée à la main ne peut pas tenir
// dans la durée : deux fois déjà, une règle ajoutée d'un côté a arrêté les écritures
// sans que l'autre ne dessine la porte de sortie.
const pauseReason = ref(null)
const backupPaused = computed(() => pauseReason.value !== null)
const counts = ref({ p: 0, m: 0, l: 0 })

// Fiche d'identité de la sauvegarde (lot du 06/08/2026). Le 06/08 au matin, l'app a
// annoncé « une sauvegarde t'attend » et suspendu ses écritures : rien à l'écran ne
// disait ce qu'était cette sauvegarde, d'où elle venait, ni laquelle des deux faces
// était la plus récente. `origin` reste à `'unknown'` tant qu'on n'a pas su lire —
// c'est le repli qui interdit de conseiller à l'aveugle.
const manifest = ref(null)
const origin = ref('unknown')
// La restaurabilité telle que le CONSEIL doit la lire (correctif de revue, 07/08) : trois
// états, `null` valant « la sonde n'a pas su répondre » ⇒ aucun conseil. `dbRestorable`
// ci-dessus garde son repli `false`, qui est le bon pour ce qu'il gouverne (le bouton
// « Restaurer » et la ligne de diagnostic) mais ne distingue pas « base non restaurable »
// de « on ne sait pas » — or le conseil, lui, dit deux choses OPPOSÉES dans ces deux cas.
const restorable = ref(null)

// Les deux phrases viennent de `backup-origin.js`, avec le prédicat qui les alimente —
// elles ne sont PAS écrites ici. Le bandeau de décision (BackupDecisionPrompt.vue) dit
// exactement les mêmes choses au moment où l'on décide vraiment ; deux `computed`
// recopiés auraient divergé, comme deux grilles de messages divergent toujours.
// `restorable` (et NON `dbRestorable`, cf. sa déclaration) commande le conseil : conseiller
// « restaure tes données » quand `runRestore` va refuser (travail réel sur l'appareil, garde
// `not-empty`) enverrait l'utilisatrice vers une porte fermée. Elle est posée par
// `loadState()` AVANT la fiche d'identité — les deux valeurs lues ici sont donc toujours du
// même instant.
const adviceText = computed(() => adviceSentence(t, origin.value, restorable.value))
const originText = computed(() => originSentence(t, origin.value, manifest.value))

// `readManifest` ne valide QUE le champ `appareil` : une fiche peut être « ok » sans
// porter de décomptes, ou n'en porter qu'une partie.
//
// ⚠️ MESURÉ, pas supposé : vue-i18n n'écrit JAMAIS `{projets}` en clair quand le
// paramètre manque — il l'interpole en chaîne VIDE. Sans ce garde-fou, la ligne du
// dossier afficherait donc « Le dossier — 6 projets,  patrons,  laines », voire
// « Le dossier —  projets,  patrons,  laines » : des trous silencieux, pas des accolades
// visibles. Sur l'écran dont le seul rôle est de rassurer, c'est pire qu'un espace
// réservé — ça se lit comme un décompte à zéro sans le dire.
//
// Les TROIS nombres sont donc exigés un par un : tester la seule présence de `contenu`
// laisserait passer `{}`, qui est un objet parfaitement véridique et produit exactement
// le même affichage troué.
const folderCounts = computed(() => {
  const c = manifest.value?.contenu
  if (!c || typeof c !== 'object') return null
  const complet = ['projets', 'patrons', 'laines'].every((k) => Number.isFinite(c[k]))
  return complet ? c : null
})

// Une seule opération de dossier à la fois. Après le retrait des trois boutons
// (09/08/2026), « Repartir de zéro » est la seule qui reste — mais la garde demeure : un
// `:disabled` d'affichage ne protège pas d'un double événement, et ce geste écrit dans le
// dossier. C'est le mécanisme du sinistre du 04/08 qu'elle ferme.
const startingFresh = ref(false)
const folderBusy = computed(() => startingFresh.value)

// Le chemin réel, posé à la désignation par la porte (OnboardingFolderPrompt.vue) :
// réglage `safFolderLabel`, repli sur le nom seul. La composition vit désormais dans
// `folderDisplayPath()` (saf-folder-label.js), partagée avec le rapport d'échec de
// l'enregistrement automatique (auto-backup.js) — les deux
// écrans doivent désigner le même dossier sous le même nom, deux compositions
// parallèles divergeraient.
// ⚠️ LIBELLÉ D'AFFICHAGE, JAMAIS UNE CLÉ : l'identité d'un dossier, c'est `folderKey()`
// (l'URI de l'arbre SAF). Une comparaison sur ce libellé laisserait une décision prise
// sur un dossier acquitter le suivant — le risque documenté dans backup-decision.js.
const folderPath = ref(null)

async function loadState() {
  // Garde native : sur web/dev, le plugin Capacitor n'est pas implémenté (proxy
  // qui rejette en UNIMPLEMENTED) — on garde l'état par défaut « aucun dossier »
  // plutôt que de déclencher un rejet non intercepté à l'ouverture des Réglages.
  if (!Capacitor.isNativePlatform()) return
  const has = await hasFolder()
  designated.value = has
  // Libellé d'affichage du dossier (cf. commentaire au-dessus de `folderPath`) :
  // une seule lecture via le site unique de composition (réglage + repli nom).
  folderPath.value = await folderDisplayPath()

  // Diagnostic (04/08/2026) : dire à l'utilisatrice POURQUOI la restauration est
  // ou n'est pas possible. Sans ces trois lignes, une restauration qui ne se
  // propose pas est indiscernable d'une app qui ne marche pas — c'est ce qui a
  // coûté trois écrasements de dossier avant d'être diagnostiqué.
  //
  // Correctif (auto-revue, avant commit) : `hasBackup` interroge le plugin natif
  // SAF (`storage.exists`, cf. saf-storage.js) SANS filet — contrairement à
  // `runRestore` (restore-service.js) qui capture systématiquement toute erreur
  // native pour ne jamais laisser une exception remonter. Un rejet ici (permission
  // perdue en cours de route, erreur I/O) planterait cette portion de `loadState()`
  // APRÈS que `designated` soit déjà vrai — affichant par défaut la ligne rouge
  // « tu as déjà du travail, restauration bloquée » sur un appareil dont on ignore
  // en réalité l'état. Repli sûr (fail-closed, même esprit que `isDbRestorable`) :
  // en cas d'échec, les trois refs restent à leur valeur par défaut déjà prudente
  // (backupFound=false, dbRestorable=false) plutôt que de laisser planter tout
  // `loadState()` (qui aurait aussi empêché `designated`/`name` de s'afficher).
  try {
    const storage = await getBackupStorage()
    backupFound.value = storage ? await hasBackup(storage) : false
    // Sonde ISOLÉE dans son propre filet (correctif de revue, 07/08). Avant, son rejet
    // partait dans le `catch` global, qui remettait `backupFound` à `false` : tout le bloc
    // d'identité du dossier — origine, comparaison des deux côtés, conseil — disparaissait
    // de l'écran dont c'est précisément le rôle. Un échec de la sonde ne dit rien sur le
    // contenu du dossier ; il ne doit effacer que ce qu'il concerne. `dbRestorable` garde
    // son repli fail-closed `false` (le bouton « Restaurer » reste refusé), `restorable`
    // passe à `null` (« on ne sait pas » ⇒ aucun conseil).
    try {
      const answer = await isDbRestorable()
      dbRestorable.value = answer
      restorable.value = answer
    } catch {
      dbRestorable.value = false
      restorable.value = null
    }
    const [p, m, l] = await Promise.all([
      db.projects.count(),
      db.patterns.filter(isLibraryPattern).count(),
      db.yarns.count(),
    ])
    counts.value = { p, m, l }
    // Site unique de vérité (lot du 06/08) : la ligne « en pause » ET le `v-if` du bouton
    // de sortie qui en découle doivent suivre EXACTEMENT le critère qui gouverne
    // l'écriture. Les dériver à part est ce qui avait rendu le cul-de-sac possible.
    pauseReason.value = await backupPauseReason(storage)
    // Fiche d'identité (lot du 06/08). Quelques centaines d'octets — principe général à
    // garder : ne jamais lire ici un fichier potentiellement lourd (ex. un gros
    // original.pdf) juste pour afficher trois lignes. `laines.json` ne relève plus de cette
    // mise en garde depuis le 15/08/2026 (photos de laine externalisées) : il redevient
    // petit quelle que soit la taille du stock.
    const described = await describeOrigin(storage)
    origin.value = described.origin
    manifest.value = described.manifest
  } catch {
    backupFound.value = false
    dbRestorable.value = false
    // Pas de remise à zéro d'`origin`/`manifest` ici, et c'est VOULU : les trois lignes
    // qui les affichent sont toutes gardées par `backupFound`, que la ligne ci-dessus
    // vient de mettre à `false`. Une remise à zéro serait du code qu'aucun test ne peut
    // faire rougir — j'en avais écrit une, la revue l'a montrée inobservable.
    // Repli PRUDENT (revue) : en cas d'erreur, on ne sait pas si le dossier
    // contient une sauvegarde — or `isBackupPaused` (backup-pause.js) répond `true`
    // dans exactement le même cas. Répondre `false` ici masquerait la ligne « en
    // pause » ET le bouton « Repartir de zéro » pendant que la sauvegarde est
    // effectivement arrêtée : un cul-de-sac invisible. Afficher la ligne alors qu'on
    // ignore l'état est sans danger — « Repartir de zéro » sur un dossier vide se
    // contente d'écrire. `'no-decision'` est le repli que `backupPauseReason` choisit
    // elle-même dans ce cas (même raison, mêmes boutons déjà en place).
    pauseReason.value = 'no-decision'
  }
}

onMounted(loadState)

// La section ne se recharge qu'au MONTAGE — après un changement de dossier
// via la porte, la raison de pause et le chemin affichés seraient
// périmés jusqu'à la prochaine visite des Réglages. Le pont porte le signal de
// fermeture : un COMPTEUR incrémenté à CHAQUE fermeture de la porte (conclue ou
// annulée — l'annulation ne change rien au dossier, mais recharger l'état est sans
// danger et couvre tous les cas sans distinguer). Un compteur plutôt qu'un booléen
// « porte refermée » : deux fermetures rapprochées laissent un booléen inchangé et le
// `watch` muet, alors que l'état du dossier a pu bouger entre les deux.
watch(
  () => folderChange.closeCount,
  () => {
    loadState()
  },
)

// Sortie de secours de la garde anti-écrasement. Seul
// appelant de `overwriteBackup: true` dans toute l'app — la SEULE porte qui franchit
// la garde. Confirmation obligatoire : ce geste remplace définitivement la sauvegarde
// du dossier par l'état (vierge) de cet appareil.
async function startFresh() {
  // Garde croisée (re-revue) : sans elle, presser « Repartir de
  // zéro » PENDANT une restauration fait réconcilier le dossier contre une base
  // encore vide pendant que `readBackup` le lit — le mécanisme exact du sinistre
  // du 04/08/2026. `:disabled="folderBusy"` (gabarit) ne suffit pas seul.
  if (folderBusy.value) return
  if (!window.confirm(t('saf.startFreshConfirm'))) return
  startingFresh.value = true
  const report = beginSyncProgress('backup')
  try {
    const res = await runBackup({ overwriteBackup: true, onProgress: report })
    if (res.ok) {
      // Le booléen de `recordBackupDecision()` DOIT être lu (correctif) :
      // ignoré, un échec d'enregistrement (permission perdue entre le
      // clic et l'écriture, base illisible) laissait croire « Patrons sauvegardés »
      // alors que la garde se refermait aussitôt derrière — un cul-de-sac silencieux.
      const decided = await recordBackupDecision()
      snackbar.show(decided ? t('saf.syncDone') : t('saf.decisionNotSaved'))
    } else if (res.skipped === 'permission') {
      snackbar.show(t('saf.syncFailedPermission'))
    } else {
      snackbar.show(t('saf.syncFailed'))
    }
    await loadState()
    emit('changed')
  } finally {
    endSyncProgress()
    startingFresh.value = false
  }
}
</script>

<template>
  <section class="block">
    <h2 class="block__title">{{ t('saf.section') }}</h2>
    <!-- [1] le dossier désigné, ou l'avertissement s'il n'y en a pas. -->
    <p v-if="designated" class="muted small" data-test="folder-path">{{ t('saf.folder', { path: folderPath }) }}</p>
    <p v-else class="muted small warning">{{ t('saf.noFolderWarning') }}</p>
    <!-- [2] NOUVEAU (07/08/2026) : la raison d'être du dossier, en
         permanence — première question à laquelle répondre, avant même de savoir si
         un dossier est déjà désigné. -->
    <p class="muted small mt" data-test="purpose">{{ t('saf.purpose') }}</p>
    <!-- [3] La ligne d'état (« Copie à jour, faite le… » / « Aucune copie pour
         l'instant. ») est RETIRÉE (06/09/2026, retour d'usage : l'horodatage
         machine ne dit rien à une tricoteuse, et le haut des Réglages dit déjà
         « sauvegardé automatiquement »). Les clés `saf.stateUpToDate`/
         `saf.stateNever` n'ont plus de consommateur — ne pas les réintroduire
         sans redemander. Le bloc de pause [4] ci-dessous reste, lui, la SEULE
         ligne qui parle de synchro : elle ne sort qu'en cas de décision à prendre. -->

    <!-- [4] LE BLOC DE DÉCISION — seulement s'il y a une décision à prendre
         (`pauseReason !== null`, cf. `backupPaused`). C'est le principe qui gouverne
         tout le lot : le diagnostic ne sort que s'il sert. `diagBackupFound`/
         `diagBackupNone`, `diagDbRestorable`, l'origine, les deux lignes de comparaison
         et le conseil rejoignent ce bloc, inchangés, au lieu d'être permanents.
         Correctif de revue : `diagDbNotEmpty` ne s'affiche PLUS ici — la
         règle est explicite, ce message « cesse d'être une ligne
         permanente et DEVIENT la ligne sous le bouton Restaurer » (`hintRestoreBlocked`,
         plus bas) : une MIGRATION, pas une duplication. L'afficher aux deux endroits
         aurait produit, dans l'état de pause le plus fréquent (base non vide), deux
         phrases quasi identiques l'une sous l'autre. -->
    <template v-if="designated && backupPaused">
      <p class="muted small mt" data-test="diag-backup">
        {{ backupFound ? t('saf.diagBackupFound') : t('saf.diagBackupNone') }}
      </p>
      <p v-if="dbRestorable" class="muted small" data-test="diag-db">{{ t('saf.diagDbRestorable') }}</p>
      <!-- Décision produit (07/08) : l'ancienne ligne « Sur cet appareil : … » a été
           retirée d'ici. La paire « Le dossier / Cet appareil » plus bas la remplace —
           c'est une COMPARAISON, pas un décompte isolé, et l'écran affichait les deux
           l'une sous l'autre. Argument décisif : dans le cas le plus fréquent (toutes les
           sauvegardes écrites avant ce lot, qui n'ont pas de fiche), la colonne « Le
           dossier » est masquée ; l'utilisatrice voyait alors DEUX FOIS l'appareil et
           jamais le dossier. Sur l'écran dont le seul rôle est de rassurer, ça se lit
           comme un bug d'affichage.
           La clé i18n `saf.diagDbContents` a perdu son consommateur ici ; retirée des
           quatre langues le 07/08/2026 (passe de ménage des textes, séparée de ce lot). -->

      <p v-if="backupFound" class="muted small mt" data-test="origin">{{ originText }}</p>
      <!-- Côté dossier affiché UNIQUEMENT quand la fiche donne ses décomptes : un comptage
           de secours par `readdir` inclurait le patron libre `builtin` et ignorerait la
           corbeille, donc annoncerait un écart imaginaire — sur l'écran dont le seul rôle
           est de rassurer. -->
      <p v-if="backupFound && folderCounts" class="muted small" data-test="side-folder">
        {{ t('saf.sideFolder') }} — {{ t('saf.sideCounts', folderCounts) }}
      </p>
      <p class="muted small" data-test="side-device">
        {{ t('saf.sideDevice') }} — {{ t('saf.sideCounts', { projets: counts.p, patrons: counts.m, laines: counts.l }) }}
      </p>
      <!-- ⚠️ LES TROIS LIGNES QUI PARLENT DU DOSSIER (`origin`, `side-folder`, `advice`)
           PORTENT LA MÊME GARDE : `backupFound` (dans ce bloc, déjà filtré par
           `designated && backupPaused`). Elles l'ont d'abord eue chacune la sienne, et
           c'était atteignable en vrai — `hasBackup` ne sonde que `Projets/`, `Patrons/`,
           `laines.json` et `reglages.json`, JAMAIS `sauvegarde.json`. Un dossier dont la
           fiche survit à la disparition de ces quatre-là aurait affiché les décomptes et
           le conseil SANS la phrase d'origine, juste sous la ligne « Aucune sauvegarde
           dans ce dossier » : deux affirmations contraires l'une sous l'autre, sur
           l'écran dont le seul rôle est de rassurer. Une seule condition pour un seul
           sujet — si le dossier n'a pas de sauvegarde, l'app n'a rien à en dire, et
           surtout rien à conseiller. -->
      <p v-if="backupFound && adviceText" class="muted small mt" data-test="advice">{{ adviceText }}</p>
      <!-- Une seule phrase de pause à la fois, et celle qui dit la VRAIE raison :
           `saf.backupPaused` (« restaure d'abord ») n'a aucun sens quand le blocage vient
           d'un autre appareil. Seule la ligne change ici : le bouton de sortie
           « Repartir de zéro » ci-dessous reste attaché à `backupPaused`, c'est-à-dire à
           TOUTE raison de pause — le restreindre à l'une d'elles rouvrirait le cul-de-sac
           (écritures arrêtées, aucune issue affichée) que ce code a déjà produit deux fois. -->
      <p v-if="pauseReason === 'no-decision'" class="muted small mt warning" data-test="backup-paused">
        {{ t('saf.backupPaused') }}
      </p>
      <p v-if="pauseReason === 'other-device'" class="muted small mt warning" data-test="other-device-blocked">
        {{ t('saf.otherDeviceBlocked') }}
      </p>
    </template>

    <!-- [5] le seul bouton qui reste (09/08/2026) : « Repartir de zéro », suivi de sa
         ligne d'aide (`data-test="hint-<bouton>"`, rendue IMMÉDIATEMENT après lui). -->
    <button
      v-if="designated && backupPaused"
      class="btn btn--block mt"
      data-test="start-fresh"
      :disabled="folderBusy"
      @click="startFresh"
    >
      {{ t('saf.startFresh') }}
    </button>
    <p v-if="designated && backupPaused" class="muted small" data-test="hint-start-fresh">{{ t('saf.hintStartFresh') }}</p>

    <!-- [5 bis] « Changer de dossier » (clé `saf.change`, existante et
         jusque-là orpheline). Vit avec les GESTES de la section, après « Perdre les
         données » et sa ligne d'aide, avant la note technique — c'est une action, pas
         une explication. Rendu sur plateforme native TOUJOURS : sans dossier il
         désigne (la porte s'en charge, même flux que le premier lancement), avec
         dossier il change. Pas de confirmation ici : la porte ET le sélecteur système
         en sont déjà une. Le clic ne fait que LEVER la demande ; c'est App.vue qui
         ouvre la porte (seul propriétaire de sa ref), via le pont
         `stores/folder-change.js`. -->
    <button
      v-if="nativePlatform"
      class="btn btn--block mt"
      data-test="change-folder"
      @click="folderChange.requestChange()"
    >
      {{ t('saf.change') }}
    </button>

    <!-- [6] descend ici, après les boutons : caractéristique technique, pas raison
         d'être (celle-ci est déjà dite en [2], `saf.purpose`). -->
    <p class="muted small mt" data-test="explain">{{ t('saf.explain') }}</p>
    <SyncProgressLine owner="inline" />
  </section>
</template>

<style scoped>
.block { background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--sp-4); margin-bottom: var(--sp-4); box-shadow: var(--clay-sm); }
.block__title { font-size: 17px; margin-bottom: var(--sp-3); }
.mt { margin-top: var(--sp-3); }
.small { font-size: 12.5px; }
.muted { color: var(--ink-55); }
.warning { color: var(--danger); font-weight: 600; }
</style>
