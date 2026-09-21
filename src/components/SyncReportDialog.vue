<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSyncReportStore } from '@/stores/sync-report'
import { classifySyncReport, isMergedEntryFlagged } from '@/backup/sync-report-decision'
import { warningText } from '@/utils/warning-i18n'
import { isStructuredWarning } from '@/utils/pattern-md/warning-codes'
import { NOTICE } from '@/constants/notice-queue'
import { useNoticeSlot } from '@/composables/useNoticeSlot'
import { trapTabFocus } from '@/composables/useFocusTrap'
import { lockBodyScroll, unlockBodyScroll } from '@/utils/body-scroll-lock'

// Modale de rapport de synchro MD — mirroir d'`OnboardingFolderPrompt`
// (role=dialog, aria-modal, piège de focus par ordre DOM, Échap ferme). N'apparaît QUE
// dans le cas « à signaler » (progression perdue, avertissement, asset manquant,
// dossier ignoré, erreur) — le cas propre est géré ailleurs par une snackbar
// (cf. `classifySyncReport` + câblage dans `App.vue`).
const { t } = useI18n()
const store = useSyncReportStore()
const closeBtn = ref(null)

// Rapport actuellement PRÉSENTÉ dans la modale — délibérément DÉCOUPLÉ de
// `store.report` une fois ouvert : une resynchro déclenchée par un `resume` pendant
// que la modale est ouverte (ex. l'utilisateur revient au premier plan) réécrit
// `store.report` avec un rapport propre (les témoins viennent d'être mis à jour par
// la fusion qu'on est justement en train d'afficher) — sans ce découplage, la
// modale se refermerait TOUTE SEULE avant que l'avertissement/la perte de
// progression ait pu être lu, ce qui est exactement la perte silencieuse que ce
// rapport existe pour éviter. Seul un NOUVEAU rapport à signaler remplace l'ancien ;
// un rapport propre/vide pendant que la modale est ouverte est ignoré (elle ne se
// ferme que sur « Compris »/Échap, cf. `onClose`).
const displayedReport = ref(null)
watch(
  () => store.report,
  (report) => {
    if (classifySyncReport(report).kind === 'modal') displayedReport.value = report
  },
  { immediate: true },
)

const visible = computed(() => displayedReport.value != null)
// File des messages (19/08/2026). Le rapport rend compte d'une écriture DÉJÀ faite : il ne
// doit jamais être perdu. La file ne le perd pas — elle le fait attendre son tour.
const hasSlot = useNoticeSlot(NOTICE.SYNC_REPORT, visible)

// Patrons/projets fusionnés ayant quelque chose à signaler (les fusions propres,
// s'il y en a en plus de celles à signaler, ne sont pas listées ici — rien à en dire).
const flaggedMerged = computed(() => (displayedReport.value?.merged || []).filter(isMergedEntryFlagged))
const skippedWithReason = computed(() => (displayedReport.value?.skipped || []).filter((s) => s && s.reason))
const errors = computed(() => displayedReport.value?.errors || [])

// Somme d'un sous-ensemble de champs de `m.reconcile` — factorise les trois lectures
// ci-dessous, qui ne différaient que par la liste de clés additionnées.
function sumReconcile(m, keys) {
  const r = m.reconcile || {}
  return keys.reduce((total, key) => total + (r[key] || 0), 0)
}

function keptCount(m) {
  return sumReconcile(m, ['doneKept', 'countersKept'])
}

function lostCount(m) {
  return sumReconcile(m, ['doneLost', 'countersLost'])
}

// Somme des pertes d'état par grille (rang/répétition/calage/rideau) — l'affichage est
// GÉNÉRIQUE (peu importe quelle grille) : ce qui compte, c'est que la tricoteuse sache
// qu'un réglage de grille est à refaire. Remplace l'ancien indicateur `chartRowReset`.
function chartStateLost(m) {
  return sumReconcile(m, ['chartRowsLost', 'chartRepsLost', 'chartFramesLost', 'chartCurtainsLost'])
}

// `missingAssets` peut contenir des doublons (même image référencée par plusieurs
// steps) — on ne les affiche qu'une fois.
function dedupedMissing(m) {
  return [...new Set(m.missingAssets || [])]
}

function entryLabel(entry) {
  return entry.name || entry.folder || ''
}

// « Le libellé i18n raconte, le verbatim diagnostique ». Une erreur
// structurée (code + params, fabrique E() de warning-codes.js) est rendue TRADUITE par
// warningText — même canal que les ignorés — et son verbatim français d'origine (.message)
// reste lisible au survol via l'attribut title. Une erreur brute (chaîne, ou objet hors
// catalogue) est rendue telle quelle (comportement warningText), SANS title.
function errorTitle(e) {
  if (!isStructuredWarning(e?.error)) return undefined
  return typeof e.error.message === 'string' && e.error.message ? e.error.message : undefined
}

// ⚠️ CE `watch` SUIT `hasSlot`, PAS `visible` — et la nuance a coûté une régression
// d'accessibilité. `visible` dit « j'ai quelque chose à montrer », `hasSlot` dit « la file
// m'accorde l'écran » : depuis que le rendu (`v-if` du template) est passé sur `hasSlot`
// (depuis le 19/08), les deux ne coïncident plus dès qu'un message plus fort tient l'écran.
// Calés sur `visible`, les effets de bord partaient trop tôt : le fond était verrouillé
// alors qu'AUCUNE modale n'était peinte, et le focus, posé sur un bouton pas encore rendu,
// n'entrait JAMAIS dans le dialogue quand celui-ci apparaissait enfin — son piège de focus
// (`onKeydown`, plus bas) ne s'amorçait donc jamais. Gardé par le test « effets de bord de
// la modale » de tests/unit/sync-report-dialog.spec.js.
//
// ⚠️ `{ immediate: true }` N'EST PAS COSMÉTIQUE ICI, et c'est mesuré : le `watch` de
// `displayedReport` ci-dessus est lui-même immédiat, donc `visible` — et avec lui `hasSlot` —
// peut être VRAI dès le `setup` si le magasin porte déjà un rapport à signaler au montage.
// Un `watch` non immédiat ne verrait alors aucun changement : la modale s'afficherait sans
// verrou et sans focus, en silence. (Sonde du 19/08 : montée avec un rapport déjà posé, elle
// était rendue, `overflow` restait vide et le focus restait sur BODY.) Ce cas n'est pas
// atteignable aujourd'hui — `App.vue` monte cette modale une fois pour toutes au démarrage,
// avant qu'aucun rapport n'existe — mais il le deviendrait au premier `v-if` posé devant elle.
// `verrouPose` va avec : sans lui, le tout premier appel immédiat (`hasSlot` faux) libérerait
// un verrou de défilement posé par un AUTRE composant (PhotoLightbox, la porte du dossier).
//
// Deux modales successives, fond déverrouillé : la pose et le retrait
// passent par le verrou à COMPTEUR partagé (utils/body-scroll-lock.js) — la fermeture d'ICI
// ne déverrouille plus le fond tant qu'une AUTRE modale le tient ; le retrait n'y arrive
// qu'à la dernière libération.
let verrouPose = false
watch(
  hasSlot,
  async (v) => {
    if (v) {
      verrouPose = true
      lockBodyScroll()
      await nextTick()
      closeBtn.value?.focus()
    } else if (verrouPose) {
      verrouPose = false
      unlockBodyScroll()
    }
  },
  { immediate: true },
)
// Le verrou n'est relâché par le `watch` que si `hasSlot` REDEVIENT faux du vivant du
// composant. Démonté alors qu'il tient encore la place (le cas même que le commentaire
// ci-dessus anticipe, « il le deviendrait au premier `v-if` posé devant elle »), le
// `overflow: hidden` serait resté sur `<body>` pour le reste de la session et plus AUCUN
// écran n'aurait défilé. `verrouPose` garde la symétrie : on ne relâche que ce qu'on a posé,
// jamais le verrou d'un autre composant. Même geste que BackupDecisionPrompt.vue.
onBeforeUnmount(() => {
  if (verrouPose) {
    verrouPose = false
    unlockBodyScroll()
  }
})

function onClose() {
  displayedReport.value = null
  store.setReport(null)
}

function onKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    onClose()
    return
  }
  // Piège de focus — version partagée (composables/useFocusTrap.js, ex-copie locale) :
  // un seul bouton focalisable dans la carte, Tab/Shift+Tab le reboucle sur lui-même
  // plutôt que de laisser le focus s'échapper de la modale.
  trapTabFocus(e)
}
</script>

<template>
  <div
    v-if="hasSlot"
    class="srd-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="srd-title"
    @keydown="onKeydown"
  >
    <div class="srd-overlay__panel">
      <h2 id="srd-title" class="srd__title">{{ t('patronSync.reportTitle') }}</h2>
      <ul class="srd__list">
        <li v-for="m in flaggedMerged" :key="`m-${m.kind}-${m.id}`" class="srd__item">
          <p class="srd__item-name">{{ entryLabel(m) }}</p>
          <p v-if="keptCount(m) > 0" class="srd__line">{{ t('patronSync.reportKeptProgress') }}</p>
          <p v-if="lostCount(m) > 0" class="srd__line srd__line--warn">
            {{ t('patronSync.reportRedo', { n: lostCount(m) }) }}
          </p>
          <p v-if="m.reconcile?.sizeReset" class="srd__line srd__line--warn">
            {{ t('patronSync.reportSizeReset') }}
          </p>
          <p v-if="chartStateLost(m) > 0" class="srd__line srd__line--warn">
            {{ t('patronSync.reportChartStateLost') }}
          </p>
          <p v-for="(w, i) in m.warnings" :key="`w-${i}`" class="srd__line srd__line--warn">
            {{ t('patronSync.reportWarning') }} : {{ warningText(w, t) }}
          </p>
          <p v-for="(img, i) in dedupedMissing(m)" :key="`img-${i}`" class="srd__line srd__line--warn">
            {{ t('patronSync.reportMissingImg') }} : {{ img }}
          </p>
        </li>
        <li v-for="(s, i) in skippedWithReason" :key="`s-${i}`" class="srd__item">
          <p class="srd__item-name">{{ entryLabel(s) }}</p>
          <p class="srd__line srd__line--warn">{{ t('patronSync.reportSkipped', { reason: warningText(s.reason, t) }) }}</p>
        </li>
        <li v-for="(e, i) in errors" :key="`e-${i}`" class="srd__item">
          <p class="srd__line srd__line--warn" :title="errorTitle(e)">{{ t('patronSync.reportError') }} : {{ e.folder }} — {{ warningText(e.error, t) }}</p>
        </li>
      </ul>
      <div class="srd__actions">
        <button ref="closeBtn" class="btn btn--primary" data-test="close" @click="onClose">
          {{ t('patronSync.close') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.srd-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  padding: max(var(--sp-4), var(--sa-top)) var(--sp-4) max(var(--sp-4), var(--sa-bottom));
}
.srd-overlay__panel {
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
.srd__title {
  font-size: 18px;
  margin-bottom: var(--sp-3);
}
.srd__list {
  list-style: none;
  margin: 0 0 var(--sp-4);
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.srd__item {
  border-radius: var(--r-sm);
  /* --surface-2 n'a jamais été défini (audit couleurs du 18/07) : le fallback
     s'appliquait donc toujours. Remplacé par le vrai token de surface, qui reste
     lisible en sombre (le fallback à 3% de noir devenait quasi invisible sur --bg
     déjà très sombre). */
  background: var(--surface);
  padding: var(--sp-2) var(--sp-3);
}
.srd__item-name {
  font-weight: 700;
  margin-bottom: var(--sp-1);
}
.srd__line {
  color: var(--ink-55);
  font-size: 14px;
  margin: 2px 0;
}
.srd__line--warn {
  color: var(--ink);
}
.srd__actions {
  display: flex;
  justify-content: flex-end;
}
</style>
