<script setup>
// Modale singleton d'incident de RESTAURATION (décision produit du
// 05/09/2026 : « informer l'utilisateur qu'une erreur technique a été rencontrée
// à la restauration et donner un moyen de voir le détail de l'erreur, et de
// copier l'erreur pour la faire remonter »). Montée UNE FOIS dans App.vue,
// pilotée par le store `restore-error` (même motif que SyncReportDialog +
// stores/sync-report.js) : elle survit ainsi à la fermeture de la porte du
// dossier ou du bandeau de décision qui l'ont déclenchée — tous deux publient
// AVANT de se retirer, précisément parce qu'elle vit ailleurs qu'eux.
//
// ⚠️ DÉLIBÉRÉMENT HORS FILE DES MESSAGES (useNoticeSlot/notice-queue). Son rang
// dans la file la placerait DERRIÈRE la porte du dossier (rang 2) et le bandeau
// de décision (rang 3) — or elle est déclenchée pendant que l'un des deux tient
// l'écran et doit se peindre PAR-DESSUS lui, puis LUI SUCCÉDER quand il se
// retire. Passée par la file, elle n'apparaîtrait qu'après leur retrait — voire
// jamais, si un message plus fort arrivait entre-temps — exactement la perte
// silencieuse qu'elle existe pour éviter. La primauté à l'écran est donc ici
// portée par le SEUL z-index (1300, précédent LocalRestoreOffer.vue : au-dessus
// des 1200 de la porte et du bandeau), le mécanisme d'avant la file — qui reste
// en place pour tout ce qu'elle ne gouverne pas (cf. App.vue). Un futur lot qui
// voudrait « la filer par cohérence » dans useNoticeSlot casserait ce
// comportement : NE PAS LE FAIRE sans rouvrir la décision du 05/09.
//
// Deux variantes, un seul gabarit (choisies par `report.kind`, cf. le store) :
//   - 'error'   : la restauration a ÉCHOUÉ (erreur de garde avalée, erreur E/S,
//                 JSON corrompu…) — le chemin qui, avant ce lot, ne laissait
//                 AUCUNE trace sur le téléphone neuf ;
//   - 'unowned' : la restauration a RÉUSSI mais l'appropriation du dossier n'a
//                 pas pu être confirmée (`runRestore` → `owned:false`) — ce
//                 n'est PAS un échec, la formulation le dit.
// Dans les deux cas : le détail technique multi-lignes vient du compositeur de
// rapport (failure-report.js — date, version, dossier, erreur intégrale), et
// « Copier le rapport » remet EXACTEMENT ce texte dans le presse-papiers, une
// seule grille pour tout le lot (échec de copie → snackbar backupFailure
// .copyFailed, clé existante, réutilisée — pas une seconde formulation).
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  composeBackupFailureReport,
  RESTORE_FAILURE_REPORT_TITLE,
  RESTORE_UNOWNED_REPORT_TITLE,
} from '@/backup/failure-report'
import { copyToClipboard } from '@/utils/copy-to-clipboard'
import { lockBodyScroll, unlockBodyScroll } from '@/utils/body-scroll-lock'
import { useRestoreErrorStore } from '@/stores/restore-error'
import { useSnackbarStore } from '@/stores/snackbar'
import { trapTabFocus } from '@/composables/useFocusTrap'

const { t } = useI18n()
const store = useRestoreErrorStore()
const snackbar = useSnackbarStore()
const closeBtn = ref(null)

// ⚠️ `{ immediate: true }` N'EST PAS COSMÉTIQUE (même piège que SyncReportDialog,
// mesuré là-bas) : le store peut porter déjà un rapport au montage (test, ou un
// futur v-if posé devant ce composant) — un watch non immédiat ne verrait alors
// AUCUN changement : modale peinte sans verrou de défilement ni focus, et son
// piège de focus (onKeydown, plus bas) jamais amorcé. `verrouPose` va avec : on
// ne relâche que le verrou QU'ON A posé, jamais celui d'un autre composant
// (PhotoLightbox, la porte du dossier) — au premier appel immédiat (`visible`
// faux) comme au démontage en cours de détention.
//
// Deux modales successives, fond déverrouillé : la pose et le
// retrait passent par le verrou à COMPTEUR partagé (utils/body-scroll-lock.js) —
// la fermeture d'ICI ne déverrouille plus le fond tant qu'une AUTRE modale le
// tient ; le retrait n'y arrive qu'à la dernière libération.
const visible = computed(() => store.report != null)
let verrouPose = false
watch(
  visible,
  async (v) => {
    if (v) {
      verrouPose = true
      lockBodyScroll()
      await nextTick()
      // Focus initial sur « Fermer » : Entrée referme — le geste neutre, sans
      // effet de bord. Copier reste un geste DÉLIBÉRÉ (Tab, puis Entrée).
      closeBtn.value?.focus()
    } else if (verrouPose) {
      verrouPose = false
      unlockBodyScroll()
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  if (verrouPose) {
    verrouPose = false
    unlockBodyScroll()
  }
})

// Titre et phrase courte selon la variante — la publication a posé `kind`.
const isUnowned = computed(() => store.report?.kind === 'unowned')
const title = computed(() => (isUnowned.value ? t('restoreFailure.unownedTitle') : t('restoreFailure.errorTitle')))
const body = computed(() => (isUnowned.value ? t('restoreFailure.unownedBody') : t('restoreFailure.errorBody')))

// Le détail affiché EST le rapport copié — une seule source, jamais deux textes
// qui divergeraient entre l'écran et le presse-papiers. Titre A1 choisi par
// `kind` (les libellés du rapport restent en français NON traduit : c'est un
// texte de signalement, cf. failure-report.js) ; `error`/`path`/`at`/`details`
// sont repris tels que publiés, le compositeur gérant lui-même les null.
const reportText = computed(() =>
  composeBackupFailureReport({
    title: isUnowned.value ? RESTORE_UNOWNED_REPORT_TITLE : RESTORE_FAILURE_REPORT_TITLE,
    error: store.report?.error,
    path: store.report?.path,
    at: store.report?.at,
    details: store.report?.details,
  }),
)

async function onCopy() {
  // Contrat de copyToClipboard : booléen, jamais de levée. Un échec de copie ne
  // peut pas être muet ; la snackbar étant unique, le message REMPLACE
  // temporairement tout autre — accepté, même parti pris qu'App.vue (A2).
  const copied = await copyToClipboard(reportText.value)
  if (!copied) snackbar.show(t('backupFailure.copyFailed'))
}

function onClose() {
  store.setReport(null)
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    onClose()
    return
  }
  // Piège de focus — version partagée (composables/useFocusTrap.js, ex-copie locale) :
  // deux boutons focalisables, Tab/Shift+Tab cyclent dans l'ordre du DOM (Copier, Fermer).
  trapTabFocus(e)
}
</script>

<template>
  <div
    v-if="visible"
    class="red-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="red-title"
    data-test="restore-error-dialog"
    @keydown="onKeydown"
  >
    <div class="red-overlay__panel">
      <h2 id="red-title" class="red__title">{{ title }}</h2>
      <p class="red__body">{{ body }}</p>
      <!-- Le détail technique EST le rapport copiable : `pre` + pré-wrap pour respecter
           les retours à la ligne du compositeur sans jamais tronquer (une erreur SAF
           peut faire des centaines de caractères — c'est précisément ce qu'on veut
           voir ET récupérer intégralement). -->
      <pre class="red__detail" data-test="restore-error-detail">{{ reportText }}</pre>
      <div class="red__actions">
        <button class="btn" data-test="restore-error-copy" @click="onCopy">
          {{ t('restoreFailure.copyAction') }}
        </button>
        <button ref="closeBtn" class="btn btn--primary" data-test="restore-error-close" @click="onClose">
          {{ t('common.close') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.red-overlay {
  position: fixed;
  inset: 0;
  /* AU-DESSUS de la porte du dossier et du bandeau de décision (1200), au même rang
     que LocalRestoreOffer (1300) : cf. l'en-tête du composant — la primauté NE DOIT
     PAS passer par la file des messages, elle tient à ce z-index seul. */
  z-index: 1300;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  padding: max(var(--sp-4), var(--sa-top)) var(--sp-4) max(var(--sp-4), var(--sa-bottom));
}
.red-overlay__panel {
  position: relative;
  width: 100%;
  max-width: 460px;
  max-height: 80vh;
  overflow-y: auto;
  background: var(--bg);
  border-radius: var(--r-md);
  padding: var(--sp-4);
  box-shadow: var(--clay-sm);
}
.red__title {
  font-size: 18px;
  margin-bottom: var(--sp-2);
}
.red__body {
  color: var(--ink);
  font-size: 14px;
  margin-bottom: var(--sp-3);
}
.red__detail {
  /* Même surface que les items de SyncReportDialog (token réel, lisible en sombre). */
  background: var(--surface);
  border-radius: var(--r-sm);
  font-family: inherit;
  font-size: 12px;
  line-height: 1.5;
  margin: 0 0 var(--sp-4);
  max-height: 40vh;
  overflow-y: auto;
  padding: var(--sp-2) var(--sp-3);
  white-space: pre-wrap;
  word-break: break-word;
}
.red__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  justify-content: flex-end;
}
</style>
