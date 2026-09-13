<script setup>
// Le bandeau bloquant qui pose LA décision. Monté par App.vue via
// `v-if="showBackupDecisionPrompt"` (drapeau posé par `maybeOfferRestore()`, lui-même
// bâti sur `shouldOfferRestore(...)`) : visibilité EXTERNE, ce composant ne décide
// jamais lui-même de s'afficher.
//
// POURQUOI BLOQUANT. Le premier des quatre chemins de destruction du 04/08 était
// précisément un bandeau à UNE seule action, qu'ignorer suffisait à détruire.
// Ce composant porte les DEUX gestes qui acquittent un dossier —
// « Restaurer » et « Repartir de zéro ».
//
// LA NUANCE (décision produit) : dans le cas NOMINAL (base
// restaurable), le bandeau reste strictement inéludable — pas de croix, pas de
// « Plus tard », Échap ne ferme pas. Mais quand « Restaurer » ne PEUT PAS aboutir
// (elle a déjà du travail réel sur cet appareil), la seule branche qui aboutit
// alors serait « Repartir de zéro » — la destructrice. L'enfermement forcerait donc
// l'écrasement. `canRestore` (calculé au montage via `isDbRestorable()`) commande
// un troisième bouton, « Plus tard », qui ferme SANS rien écrire ; la sauvegarde
// reste en pause, le bandeau revient au lancement suivant. Inspiré du motif éprouvé
// d'OnboardingFolderPrompt.vue (overlay + piège de focus), qui lui PEUT toujours se
// fermer sans choisir — ce composant-ci ne le rejoint que dans ce cas précis.
//
// MESSAGES RÉUTILISÉS, PAS RÉINVENTÉS : mêmes clés que SafFolderSection (les trois
// refus distincts de `runRestore`, `saf.decisionNotSaved`) — une seconde grille de
// messages divergerait tôt ou tard de la première.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { isDbRestorable, runRestore } from '@/backup/restore-service'
import { runBackup, getBackupStorage } from '@/backup/backup-service'
import { recordBackupDecision } from '@/backup/backup-decision'
import { adviceSentence, describeOrigin, originSentence } from '@/backup/backup-origin'
import { folderDisplayPath } from '@/backup/saf-folder-label'
import { useSnackbarStore } from '@/stores/snackbar'
import { useRestoreErrorStore } from '@/stores/restore-error'
import { beginSyncProgress, endSyncProgress } from '@/backup/progress'
import SyncProgressLine from '@/components/SyncProgressLine.vue'
import { lockBodyScroll, unlockBodyScroll } from '@/utils/body-scroll-lock'
import { trapTabFocus } from '@/composables/useFocusTrap'

const { t } = useI18n()
// La RAISON de la pause, telle qu'App.vue l'a lue (`backupPauseReason`, backup-pause.js) —
// jamais re-déduite ici. Ce lot existe justement parce que le critère de pause était
// recalculé à quatre endroits : la RE-DÉDUCTION est ce qui a rendu possible le cul-de-sac
// « écritures arrêtées, aucune issue affichée », déjà produit deux fois.
// Le défaut vaut `'no-decision'` : c'est le cas historique, celui dont le message et les
// deux boutons étaient déjà en place avant ce lot.
const props = defineProps({ pauseReason: { type: String, default: 'no-decision' } })
const emit = defineEmits(['resolved'])
const snackbar = useSnackbarStore()

const busy = ref(false)
const panel = ref(null)
const restoreBtn = ref(null)
const startFreshBtn = ref(null)
const laterBtn = ref(null)

// Étape 1a : « Restaurer » peut-il seulement aboutir ? `runRestore` refuse
// (`not-empty`) si la base contient autre chose que les exemples semés. Sans cette
// distinction, le bandeau enfermerait l'utilisatrice qui a déjà importé un patron :
// « Restaurer » refuserait, et « Repartir de zéro » — la seule branche qui aboutit —
// écraserait sa sauvegarde. Repli PRUDENT : en cas de levée, `canRestore` reste
// `true` (on ne propose pas la sortie de secours sans raison — « Restaurer » dira
// lui-même pourquoi il refuse s'il refuse effectivement).
const canRestore = ref(true)
// La MÊME sonde, mais pour le CONSEIL — et son repli est l'INVERSE (correctif de revue,
// 07/08). `canRestore` ci-dessus commande un BOUTON : en cas d'échec de la sonde, il
// retombe sur `true`, c'est-à-dire « n'offre pas la sortie de secours sans raison ». Pour
// une phrase qui recommande un geste, le repli sûr est l'autre : ne rien conseiller. Une
// seule ref pour les deux usages faisait conseiller « restaure tes données » sur une sonde
// en échec, pendant que les Réglages, eux, ne disaient rien — les deux écrans concluaient
// l'inverse l'un de l'autre à partir du module censé les tenir d'accord.
// `null` = on ne sait pas ; il ne devient booléen que si la sonde a VRAIMENT répondu.
const restorable = ref(null)
// Étape 1d : un échec de « Repartir de zéro » (disque plein, erreur E/S, permission
// perdue) alors que `canRestore` était vrai murerait quand même l'app — aucune
// branche n'aboutirait plus. Une fois cet échec constaté, « Plus tard » doit
// apparaître quelle que soit la valeur de `canRestore`.
const forceLater = ref(false)
// Fiche d'identité de la sauvegarde : le 06/08 au matin, ce bandeau a annoncé
// « Une sauvegarde t'attend » sur un téléphone réel, et personne n'a su s'il fallait
// restaurer — rien ne disait ce qu'était cette sauvegarde ni d'où elle venait. `unknown`
// est le repli, et il vaut aussi pour « on n'a pas su lire » : c'est lui qui interdit de
// conseiller à l'aveugle.
const manifest = ref(null)
const origin = ref('unknown')
// Les deux phrases viennent de backup-origin.js, PARTAGÉES avec la section des Réglages
// (SafFolderSection.vue) : le même dossier doit se raconter de la même façon aux deux
// endroits qui en parlent. `adviceText` vaut `null` quand l'origine est inconnue — on ne
// conseille que lorsqu'on sait. `restorable` (et NON `canRestore`, cf. sa déclaration)
// décide LEQUEL des deux conseils « autre appareil » s'applique, ou aucun quand la sonde
// n'a pas su répondre. Il est posé dans `onMounted` AVANT la fiche d'identité, donc jamais
// lu en cours de route.
const adviceText = computed(() => adviceSentence(t, origin.value, restorable.value))
const originText = computed(() => originSentence(t, origin.value, manifest.value))
// Description accessible du dialogue (correctif de revue, 07/08). `aria-describedby` ne
// désignait que le premier paragraphe : un lecteur d'écran annonçait la mise en pause, puis
// deux boutons — sans jamais lire d'où vient la sauvegarde ni ce qui est conseillé, c'est-à-
// dire tout ce que cette tâche ajoute. L'attribut accepte PLUSIEURS identifiants, lus dans
// l'ordre donné. Le troisième n'est cité que s'il existe : désigner un identifiant absent
// est sans effet, mais l'écrire quand même laisserait croire à une couverture qu'on n'a pas.
const describedBy = computed(() =>
  adviceText.value ? 'bdp-body bdp-origin bdp-advice' : 'bdp-body bdp-origin',
)
// Vrai exactement quand le bouton « Plus tard » est affiché — et donc quand le
// retour Android/le balayage de bord peuvent lui être délégués sans murer l'app
// (cf. `handleBackPressed`, exposé à App.vue ci-dessous, étape 3).
//
// Troisième cas ajouté : un AUTRE appareil a écrit dans le dossier. Ce
// n'est PAS redondant avec `!canRestore` — la pause « autre appareil » suppose qu'une
// décision existe déjà pour ce dossier, ce qui arrive aussi sur une base encore vierge
// (elle a rempli un dossier vide, `runBackup` a enregistré la décision toute seule), et
// `canRestore` vaut alors vrai. Or, dans ce cas précis, aucun des deux boutons ne règle
// quoi que ce soit : « Restaurer » lance un va-et-vient sans fin entre les deux appareils,
// « Repartir de zéro » détruit la sauvegarde de l'autre. Le vrai remède — désigner un
// autre dossier — est dans les Réglages, inatteignables tant que ce bandeau bloque tout.
const canLeave = computed(
  () => !canRestore.value || forceLater.value || props.pauseReason === 'other-device',
)

onMounted(async () => {
  // Verrouille le défilement du fond — via le compteur partagé :
  // le bandeau est monté par `v-if` et démonté une seule fois, l'acquisition ci-dessous
  // et la libération dans `onBeforeUnmount` sont donc exactement symétriques.
  lockBodyScroll()
  await nextTick()
  restoreBtn.value?.focus()
  // Sonde de restaurabilité (étape 1a) : APRÈS le focus initial ci-dessus, exprès —
  // elle ne doit jamais retarder le focus (repli déjà sûr : `canRestore` démarre à
  // `true`, le troisième bouton n'apparaît qu'un tick plus tard s'il doit apparaître).
  try {
    const answer = await isDbRestorable()
    canRestore.value = answer
    restorable.value = answer
  } catch {
    canRestore.value = true // repli du BOUTON, permissif (inchangé)
    restorable.value = null // repli du CONSEIL, prudent : on ne sait pas ⇒ on ne conseille pas
  }
  // Fiche d'identité, APRÈS la sonde de restaurabilité : celle-ci commande un BOUTON,
  // celle-là n'écrit que des phrases — la lecture du dossier ne doit pas retarder
  // l'apparition de la seule sortie non destructrice.
  //
  // Filet propre, malgré `describeOrigin` qui ne lève jamais par contrat : c'est
  // `getBackupStorage()` qui n'a aucun filet (App.vue le dit de son côté). Un rejet ici
  // sans capture couperait la fin d'`onMounted` en silence. Repli = ne rien changer :
  // `origin` reste `'unknown'`, donc aucun conseil — la doctrine du module elle-même.
  try {
    const described = await describeOrigin(await getBackupStorage())
    origin.value = described.origin
    manifest.value = described.manifest
  } catch {
    origin.value = 'unknown'
    manifest.value = null
  }
})

onBeforeUnmount(() => {
  unlockBodyScroll()
})

// `runRestore` acquitte lui-même le dossier en cas de succès (restaurer EST le
// geste, cf. restore-service.js) — `res.decided` dit si cet acquittement a abouti.
//
// Publication à la modale RestoreErrorDialog (décision produit du
// 05/09/2026) : un snackbar ne sait ni montrer le DÉTAIL technique multi-lignes
// ni porter une action de copie fiable — la décision du 05/09 demande les deux.
// Le dossier est résolu au moment de la publication via `folderDisplayPath()`
// (même composition que la ligne des Réglages, site unique) ; une levée laisse
// `path` à null, le rapport dira « (inconnu) » plutôt que de mentir — une
// erreur de lecture du dossier ne doit jamais empêcher de décrire l'erreur
// qu'on est justement en train de signaler.
async function publishRestoreReport(report) {
  let path = null
  try {
    path = await folderDisplayPath()
  } catch {
    // path reste null : cf. le commentaire d'en-tête.
  }
  useRestoreErrorStore().setReport({ ...report, path, at: new Date().toISOString() })
}

async function onRestore() {
  if (busy.value) return
  busy.value = true
  const report = beginSyncProgress('read', 'app')
  try {
    const res = await runRestore({ onProgress: report })
    if (res.ok) {
      if (res.owned === false) {
        // Variante « reprise du dossier non confirmée » : la
        // restauration a RÉUSSI, ce n'est PAS un échec — la modale le dit et
        // porte le détail copiable. REMPLACE le snackbar restore.done dans CE
        // CAS PRÉCIS (décision explicite : la modale dit « données restaurées
        // mais… » ; un snackbar « Données restaurées. » en plus se contredirait
        // avec elle) — le chemin nominal, lui, garde le snackbar inchangé.
        // `decisionNotSaved` reste distinct et inchangé : l'acquittement du
        // dossier et l'appropriation sont DEUX écritures différentes, l'une
        // pouvant échouer sans l'autre — quand les deux échouent, la snackbar
        // dit la sienne sous la modale qui dit la sienne.
        await publishRestoreReport({ kind: 'unowned', error: null, details: res.errors })
        if (res.decided) emit('resolved')
        else snackbar.show(t('saf.decisionNotSaved'))
      } else {
        snackbar.show(res.decided ? t('restore.done') : t('saf.decisionNotSaved'))
        if (res.decided) emit('resolved')
      }
    } else if (res.error) {
      // Branche `error` : au snackbar restore.failed — une phrase
      // qui noyait le détail ou le tronquait — succède la modale, qui montre
      // l'erreur INTÉGRALE et permet de la copier pour la faire remonter.
      // `forceLater` reste posé (cf. ci-dessous) : après « Fermer », le
      // bandeau reste avec « Plus tard » — pas de mur.
      await publishRestoreReport({ kind: 'error', error: res.error })
      // Étape 1d appliquée SYMÉTRIQUEMENT à « Restaurer » — c'est le cas qui murait
      // réellement l'app. Quand la sonde `isDbRestorable()` échoue au montage, le repli
      // permissif laisse `canRestore` à `true` : pas de « Plus tard », Échap absorbée,
      // retour Android inerte. L'utilisatrice clique alors « Restaurer », `runRestore`
      // rejoue la MÊME sonde en garde finale, elle relève, et le résultat arrive ici en
      // `error` — pas en `not-empty`. Sans cette ligne, il ne restait que « Repartir de
      // zéro », la branche destructrice. Même doctrine que dans `onStartFresh` : un
      // échec ne doit JAMAIS murer l'app.
      forceLater.value = true
    } else if (res.skipped === 'permission') {
      snackbar.show(t('saf.syncFailedPermission'))
    } else if (res.skipped === 'empty') {
      snackbar.show(t('saf.diagBackupNone'))
    } else if (res.skipped === 'not-empty') {
      snackbar.show(t('saf.restoreNowBlocked'))
      // Cohérence avec les deux refus de « Repartir de zéro » ci-dessous (étape 1d) :
      // « Restaurer » vient de dire NON pour de bon — la base contient du travail réel.
      // Sans cette ligne, une sonde `isDbRestorable()` en échec (repli permissif :
      // `canRestore` reste `true`, cf. `onMounted`) laissait le bandeau sans AUCUNE
      // branche aboutissante sauf « Repartir de zéro », la destructrice. Le refus est
      // ici une réponse ferme de `runRestore` lui-même, pas une supposition : c'est
      // exactement le cas où la sortie non destructrice doit apparaître.
      forceLater.value = true
    } else {
      // `skipped === 'web'` ou `'restore-running'` atteints ici — le premier
      // INATTEIGNABLE dans ce composant (App.vue ne monte le bandeau que quand
      // `getBackupStorage()` a déjà renvoyé un stockage natif, cf. `maybeOfferRestore`),
      // le second transitoire (une restauration tourne déjà : réessayer suffit, on ne
      // pose donc PAS `forceLater`). Gardé HONNÊTE plutôt que de
      // laisser silencieusement un message sur un travail existant s'appliquer par
      // accident (correctif de revue, étape 5c). Même traitement que
      // `SafFolderSection.restoreNow`, dont le repli générique couvre ce même cas
      // inatteignable de la même façon.
      snackbar.show(t('saf.restoreNowBlocked'))
    }
  } finally {
    endSyncProgress()
    busy.value = false
  }
}

// Sortie de secours : seule porte qui franchit la garde
// anti-écrasement, confirmation obligatoire. Acquitte le dossier APRÈS que
// l'écriture a réussi (même ordre que SafFolderSection.startFresh).
async function onStartFresh() {
  if (busy.value) return
  if (!window.confirm(t('saf.startFreshConfirm'))) return
  busy.value = true
  const report = beginSyncProgress('backup', 'app')
  try {
    const res = await runBackup({ overwriteBackup: true, onProgress: report })
    if (res.ok) {
      const decided = await recordBackupDecision()
      snackbar.show(decided ? t('saf.syncDone') : t('saf.decisionNotSaved'))
      // Étape 1e (correctif de revue) : ferme le bandeau MÊME si l'acquittement
      // a échoué — avant ce correctif, il restait ouvert, et chaque nouvel essai
      // réécrivait le dossier (l'écriture, elle, avait déjà réussi). `decisionNotSaved`
      // a déjà prévenu ; les Réglages permettent de reprendre l'acquittement seul.
      emit('resolved')
    } else if (res.skipped === 'permission') {
      snackbar.show(t('saf.syncFailedPermission'))
      // Étape 1d : un échec ne doit JAMAIS murer l'app — une sortie doit toujours
      // exister quand rien n'aboutit, quelle que soit la valeur de `canRestore`.
      forceLater.value = true
    } else {
      snackbar.show(t('saf.syncFailed'))
      forceLater.value = true
    }
  } finally {
    endSyncProgress()
    busy.value = false
  }
}

// Étape 1b : sortie de secours réservée au cas où « Restaurer » ne peut pas
// aboutir (`canLeave` vrai). Ferme le bandeau SANS RIEN ÉCRIRE, sans poser de
// décision : la sauvegarde reste en pause (voulu, et dit par `saf.decisionBlocked`)
// — le bandeau reviendra au prochain lancement (`shouldOfferRestore` reste vrai
// tant qu'aucune décision n'existe pour ce dossier), et la ligne des Réglages
// continue de l'afficher. Réutilise l'événement `resolved` : du point de vue
// d'App.vue, les DEUX significations (décision posée, ou bandeau simplement
// refermé pour ce lancement) se traduisent par le même geste, masquer le bandeau.
function onLater() {
  emit('resolved')
}

// Étape 3 : point d'entrée unique pour le retour Android ET le balayage de bord —
// App.vue fait passer les deux par `onBack()`, qui route ici tant que ce bandeau
// est affiché (cf. commentaire d'`onBack`, App.vue). Le bandeau AVALE le retour
// (ne laisse jamais le routeur naviguer derrière lui) SAUF quand `canLeave` est
// vrai, où le retour vaut « Plus tard » — refuser le retour sans offrir de sortie
// muterait l'app. Exposée à App.vue via `defineExpose` (même mécanisme que
// `ChartStage::focusViewport`) plutôt que dupliquée : App.vue n'a pas à connaître
// la règle d'affichage du bouton « Plus tard ».
function handleBackPressed() {
  if (canLeave.value) onLater()
}

defineExpose({ canLeave, handleBackPressed })

// Piège de focus (accessibilité, pas une fermeture) — DEUX boutons focalisables en
// temps normal, TROIS quand « Plus tard » est affiché (`canLeave`) : Tab et
// Shift+Tab cyclent dans l'ordre du DOM (Restaurer, Repartir de zéro, Plus tard),
// quel que soit leur nombre. Échap est INTERCEPTÉE et NE FERME RIEN : c'est tout
// l'objet de l'avenant, aucune façon de fermer sans choisir — sauf via le bouton
// « Plus tard » lui-même, atteignable par ce même piège quand il existe (correctif
// de revue : le piège figeait le focus sur les deux premiers boutons même
// quand un troisième, seule sortie non destructrice, était affiché).
function onKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    // Échap est INTERCEPTÉE dans le cas nominal (rien ne se ferme sans choisir : c'est
    // tout l'objet de l'avenant), mais elle vaut « Plus tard » exactement quand ce
    // bouton est affiché — même règle que le retour Android (`handleBackPressed`), qui
    // passe déjà par `canLeave`. Avant ce correctif, la seule sortie non destructrice
    // existait à l'écran sans que le clavier ni le geste système ne puissent l'atteindre.
    if (canLeave.value) onLater()
    return
  }
  // Piège de focus — version partagée (composables/useFocusTrap.js, ex-copie locale) :
  // cyclage dans l'ordre du DOM, boutons `disabled` exclus (pendant `busy`, la boucle
  // saute Restaurer/Repartir de zéro au lieu de buter dessus en silence).
  trapTabFocus(e)
}
</script>

<template>
  <div
    ref="panel"
    class="bdp-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="bdp-title"
    :aria-describedby="describedBy"
    data-test="backup-decision-prompt"
    @keydown="onKeydown"
  >
    <div class="bdp-overlay__panel">
      <h2 id="bdp-title" class="bdp__title">{{ t('saf.decisionTitle') }}</h2>
      <!-- Une seule phrase de pause à la fois, et celle qui dit la VRAIE raison (même
           règle que SafFolderSection) : « restaure d'abord » n'a aucun sens quand le
           blocage vient d'un autre appareil. La raison est REÇUE, jamais re-déduite. -->
      <p id="bdp-body" class="bdp__body">
        {{ pauseReason === 'other-device' ? t('saf.otherDeviceBlocked') : t(canRestore ? 'saf.backupPaused' : 'saf.decisionBlocked') }}
      </p>
      <!-- Sans `v-if` : `originSentence` rend TOUJOURS une phrase, y compris « on ne sait
           pas d'où elle vient » — et ce bandeau ne s'affiche que sur un dossier qui
           contient une sauvegarde. Une condition qui ne peut pas être fausse est un
           défaut ; celle du conseil juste en dessous, elle, l'est vraiment. -->
      <p id="bdp-origin" class="bdp__body" data-test="origin">{{ originText }}</p>
      <!-- On ne conseille que lorsqu'on sait : origine inconnue ⇒ `adviceText` vaut
           `null` ⇒ aucune ligne. Conseiller à l'aveugle enverrait quelqu'un écraser la
           sauvegarde qui était justement la bonne. -->
      <p v-if="adviceText" id="bdp-advice" class="bdp__body" data-test="advice">{{ adviceText }}</p>
      <div class="bdp__actions">
        <button
          ref="restoreBtn"
          class="btn btn--primary"
          data-test="prompt-restore"
          :disabled="busy"
          @click="onRestore"
        >
          {{ t('restore.cta') }}
        </button>
        <button
          ref="startFreshBtn"
          class="btn"
          data-test="prompt-start-fresh"
          :disabled="busy"
          @click="onStartFresh"
        >
          {{ t('saf.startFresh') }}
        </button>
        <!-- Étape 1b : uniquement quand « Restaurer » ne peut pas aboutir (ou vient
             d'échouer, étape 1d) — jamais dans le cas nominal. -->
        <button
          v-if="canLeave"
          ref="laterBtn"
          class="btn"
          data-test="later"
          :disabled="busy"
          @click="onLater"
        >
          {{ t('saf.later') }}
        </button>
      </div>
      <!-- Étape 2 : montée DANS le panneau (pas dans App.vue, sous la ligne de
           flottaison) pour rester visible pendant que ce bandeau bloque le
           défilement et recouvre l'écran — cf. son en-tête pour le détail du défaut
           corrigé. `owner="app"` doit s'accorder avec `beginSyncProgress(phase,
           'app')` ci-dessus, seul appelant de cette valeur. -->
      <SyncProgressLine owner="app" />
    </div>
  </div>
</template>

<style scoped>
.bdp-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  padding: max(var(--sp-4), var(--sa-top)) var(--sp-4) max(var(--sp-4), var(--sa-bottom));
}
.bdp-overlay__panel {
  position: relative;
  width: 100%;
  max-width: 420px;
  background: var(--bg);
  border-radius: var(--r-md);
  padding: var(--sp-4);
  box-shadow: var(--clay-sm);
}
.bdp__title {
  font-size: 18px;
  margin-bottom: var(--sp-2);
}
.bdp__body {
  color: var(--ink);
  font-size: 14px;
  /* Écart RESSERRÉ : le panneau porte désormais jusqu'à trois
     paragraphes (la pause, l'origine, le conseil) qui parlent tous du même dossier —
     avec l'ancien `--sp-4` entre chacun, ils se lisaient comme trois messages sans
     rapport, et le panneau débordait de l'écran sur un petit téléphone. */
  margin-bottom: var(--sp-2);
}
/* Le DERNIER paragraphe garde l'écart plein : c'est la séparation entre ce qu'on explique
   et ce qu'on demande de décider. Les trois paragraphes sont les seuls <p> du panneau. */
.bdp__body:last-of-type {
  margin-bottom: var(--sp-4);
}
.bdp__actions {
  display: flex;
  /* Sans retour à la ligne, les trois boutons débordent du panneau dès que les libellés
     s'allongent — en allemand, « Repartir de zéro » fait à lui seul la largeur utile. */
  flex-wrap: wrap;
  gap: var(--sp-2);
  justify-content: flex-end;
}
</style>
