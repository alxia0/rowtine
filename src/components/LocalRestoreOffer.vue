<script setup>
// L'offre de restauration LOCALE — les données trouvées DANS LE DOSSIER qu'on vient
// de désigner (cf. `maybeRestoreAfterDesignation`,
// restore-on-designate.js), pas arrivées d'un autre monde. Elle remplace (31/08/2026)
// l'ancien `window.confirm` système, dont les boutons CANCEL/OK n'étaient jamais
// traduits et dont le figement des minuteries est documenté dans restore-service.js.
//
// VISIBILITÉ EXTERNE, même doctrine que BackupDecisionPrompt.vue : ce composant ne
// décide jamais de s'afficher — le parent le monte (`v-if`) pendant qu'une réponse est
// attendue, et résout son attente sur les émissions. « Restaurer » enchaîne `runRestore`
// (côté parent, via le helper).
//
// LE REFUS EST DEVENU UN GESTE COMPLET (décision produit du 05/09/2026 :
// « je confirme Perdre les données »). Avant cette évolution, « Plus tard » ne faisait que
// refermer — les données du dossier restaient en pause et l'offre était reposée ensuite
// (bandeau de décision) : un refus qui n'en était pas un, puisqu'il n'écartait rien.
// Désormais le second bouton dit « Perdre les données » (`saf.startFresh` — le MÊME
// vocabulaire que le bandeau et les Réglages, une seule grille) et fait CE QU'IL DIT :
// l'équivalent exact de « Repartir de zéro » (`runBackup` en écrasement +
// `recordBackupDecision`, exécutés par le PARENT sur l'émission `discard` — ce
// composant ne décide de rien). C'est ce geste qui rend l'offre définitivement
// écartée : régler le refus SANS écraser laisserait la pause (« aucune décision » ou
// « autre appareil ») rouvrir le bandeau aussitôt (backup-pause.js : seul l'écrasement
// réécrit la fiche du dossier avec CE device) — et l'étiquette « Perdre les données »
// n'aurait alors pas mérité son nom. Le corps (`restore.discardHint`) énonce CE QUE le
// bouton va faire : sans lui, un libellé destructeur flotterait sans conséquence dite.
//
// CONFIRMATION PRÉALABLE, TOUJOURS — un geste destructeur ne part jamais d'un seul
// clic. JAMAIS `window.confirm` (doctrine du 31/08 : boutons système non traduits,
// minuteries gelées) : ConfirmDialog.vue maison, avec le texte existant
// `saf.startFreshConfirm`, le focus initial sur « Annuler » (comportement par défaut
// du dialogue) et son bouton de confirmation en variante danger.
//
// ⚠️ Z-INDEX : ConfirmDialog pose son voile à 80 EN DUR dans son style scopé — SOUS
// cette offre (1300). La couche `.lro-confirm-layer` (1400) reproduit le geste de
// `.app-version-guard-layer` (App.vue) : `position: relative` + z-index explicite
// ouvrent un contexte d'empilement qui fait peindre les descendants `position: fixed`
// du dialogue AU-DESSUS de l'offre, sans toucher ConfirmDialog.vue.
//
// ÉCHAP : elle n'est PLUS le refus direct. Une fois le refus devenu le chemin
// destructeur, une touche qui détruirait seule serait une régression — Échap emprunte
// donc le MÊME chemin que le clic sur « Perdre les données » (l'ouverture de la
// confirmation). Le vrai garde reste la confirmation, où « Annuler » est l'option sûre.
//
// Motif et styles repris de BackupDecisionPrompt.vue / OnboardingFolderPrompt.vue
// (overlay + panneau, tokens du projet). Accessibilité : `role="dialog"`, focus
// initial sur « Restaurer » (l'action qui récupère le travail), Tab piégé entre les
// deux boutons.
import { nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { trapTabFocus } from '@/composables/useFocusTrap'

const { t } = useI18n()
const emit = defineEmits(['restore', 'discard'])

const restoreBtn = ref(null)
// La confirmation est un ÉTAT LOCAL : tant qu'elle n'est pas confirmée, rien ne sort
// du composant — le parent ne verra qu'un `discard` déjà assumé.
const confirming = ref(false)

// Un seul chemin vers la destruction : le clic sur « Perdre les données », ou Échap
// (cf. en-tête) — jamais deux.
function askDiscardConfirmation() {
  confirming.value = true
}

// Confirmé : referme la confirmation et émet. Le parent referme l'offre puis exécute
// l'écrasement (cf. OnboardingFolderPrompt.vue, `onRestoreDiscard`).
function onDiscardConfirmed() {
  confirming.value = false
  emit('discard')
}

onMounted(async () => {
  await nextTick()
  restoreBtn.value?.focus()
})

// Piège de focus (accessibilité, pas une fermeture) — deux boutons, Tab et
// Shift+Tab cyclent dans l'ordre du DOM. Échap = demande de confirmation du refus
// (MÊME chemin que le clic, cf. en-tête), jamais la destruction directe. Quand la
// confirmation est ouverte, ce gestionnaire se retire : le focus vit dans
// ConfirmDialog — frère de l'overlay, ses événements clavier ne le traversent normalement
// pas — et ce garde est la ceinture qui couvre ce qui reste (double Échap pendant la
// transition d'ouverture, focus résiduel).
function onKeydown(e) {
  if (confirming.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    askDiscardConfirmation()
    return
  }
  // Piège de focus — version partagée (composables/useFocusTrap.js, ex-copie locale) :
  // deux boutons, Tab et Shift+Tab cyclent dans l'ordre du DOM.
  trapTabFocus(e)
}
</script>

<template>
  <div
    class="lro-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="lro-title"
    aria-describedby="lro-body"
    data-test="local-restore-offer"
    @keydown="onKeydown"
  >
    <div class="lro-overlay__panel">
      <h2 id="lro-title" class="lro__title">{{ t('restore.foundOnDevice') }}</h2>
      <!-- Le corps explicatif : la conséquence du refus, dite AVANT que le
           bouton ne la réalise — même règle que `saf.hintStartFresh` côté Réglages. -->
      <p id="lro-body" class="lro__body">{{ t('restore.discardHint') }}</p>
      <div class="lro__actions">
        <button
          ref="restoreBtn"
          class="btn btn--primary"
          data-test="local-restore-accept"
          @click="emit('restore')"
        >
          {{ t('restore.accept') }}
        </button>
        <button
          class="btn"
          data-test="local-restore-decline"
          @click="askDiscardConfirmation"
        >
          {{ t('saf.startFresh') }}
        </button>
      </div>
    </div>
  </div>
  <!-- La confirmation du geste destructeur, dans SA COUCHE (cf. en-tête, z-index) :
       frère de l'overlay et non enfant, pour que son clavier (Échap via son écouteur
       document, Tab natif entre ses deux boutons) ne rencontre jamais le piège de
       focus de l'offre — qui reste dormante tant qu'elle est ouverte. -->
  <div class="lro-confirm-layer">
    <ConfirmDialog
      :open="confirming"
      danger
      :title="t('saf.startFresh')"
      :message="t('saf.startFreshConfirm')"
      :confirm-label="t('saf.startFresh')"
      :cancel-label="t('common.cancel')"
      @confirm="onDiscardConfirmed"
      @cancel="confirming = false"
    />
  </div>
</template>

<style scoped>
.lro-overlay {
  position: fixed;
  inset: 0;
  /* AU-DESSUS de la porte du dossier (1200) et de la modale de décision : l'offre
     apparaît PENDANT que la porte tient l'écran, elle doit se peindre devant. */
  z-index: 1300;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  padding: max(var(--sp-4), var(--sa-top)) var(--sp-4) max(var(--sp-4), var(--sa-bottom));
}
.lro-overlay__panel {
  position: relative;
  width: 100%;
  max-width: 420px;
  background: var(--bg);
  border-radius: var(--r-md);
  padding: var(--sp-4);
  box-shadow: var(--clay-sm);
}
.lro__title {
  font-size: 18px;
  margin-bottom: var(--sp-2);
}
.lro__body {
  color: var(--ink-55);
  font-size: 14px;
  margin-bottom: var(--sp-4);
}
/* La couche de la confirmation (cf. en-tête) : contexte d'empilement AU-DESSUS de
   l'offre (1300) — sans lui, le dialogue (voile à 80 en dur chez lui) peindrait
   DERRIÈRE. Vide quand la confirmation est fermée (ConfirmDialog est v-if). */
.lro-confirm-layer {
  position: relative;
  z-index: 1400;
}
.lro__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  justify-content: flex-end;
}
</style>
