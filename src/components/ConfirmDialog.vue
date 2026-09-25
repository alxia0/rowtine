<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount, useId } from 'vue'
import { trapTabFocus, useDialogFocusReturn } from '@/composables/useFocusTrap'

// Dialogue de confirmation générique. La charte veut « rassurer, pas punir » : il ne
// s'ouvre QUE pour une action réellement lourde (cf. §3 « confirm seulement pour les
// actions lourdes »). Structure calquée sur YarnConsumptionDialog/ColorPickerDialog
// (dialogues les plus récents du projet) : Transition fade, voile en élément séparé,
// carte role="dialog", Échap via un écouteur document (pas @keydown sur la racine).
//
// Mode à 1 bouton (P3) : `cancelLabel` est optionnel. Absent, le bouton Annuler
// n'est pas rendu — il ne reste qu'une astuce à lire ("C'est compris"), sans « annuler »
// possible : Échap et le clic sur le voile émettent alors `confirm` (au lieu de `cancel`),
// et le focus initial va sur l'unique bouton. Motif calqué sur YarnConsumptionDialog, où
// toute fermeture applique la même action faute d'alternative.
//
// `dismissAction` (correctif « appui à côté doit juste fermer », décision produit,
// 19/08/2026) : à QUOI un appui « à côté » (Échap, clic sur le voile) doit ressembler
// quand les DEUX boutons existent. Par défaut ('cancel'), c'est le comportement
// historique décrit ci-dessus : Annuler est l'option sûre, donc Échap/voile ET le focus
// initial s'alignent dessus — INCHANGÉ pour tous les appelants existants (bienvenue,
// astuce de balayage, garde-fou de version, suppression de patron/laine, abandon de
// correction…), aucun ne passe cette prop. Un SEUL appelant à ce jour la passe à
// 'confirm' : l'avertissement d'import (LibraryView.vue), dont le bouton secondaire
// « Comment corriger » NAVIGUE — un appui réflexe à côté de la carte ne doit jamais
// déclencher une navigation qu'on n'a pas demandée, il doit juste refermer la pop-up,
// exactement comme le bouton principal. Sans effet quand il n'y a qu'un seul bouton
// (`hasCancel` faux) : dans ce cas l'unique bouton (`confirm`) est déjà la cible, cf.
// paragraphe ci-dessus.
// `centered` (correctif « bienvenue centrée », 10/08/2026) : par défaut le dialogue reste
// une feuille du bas (charte §2.10). Activée d'abord par la seule pop-up de bienvenue du
// premier lancement (HomeView.vue), sur demande explicite du porteur du projet ; rejointe
// depuis par le garde-fou de version (App.vue, 13/08/2026) et par
// l'avertissement d'import (LibraryView.vue, lot du 19/08/2026) — les trois sont des
// messages qu'on veut voir au centre, pas glisser depuis le bas. Tous les autres appelants
// (astuce de navigation comprise) restent inchangés au pixel près.
//
// `dismissOnScrim` (correctif garde-fou de démarrage,
// round de correction 1, 13/08/2026) : par défaut `true`, comportement EXISTANT
// inchangé — un clic sur le voile ou Échap ferme le dialogue (ligne 12 ci-dessus). Un
// SEUL appelant le passe à `false` à ce jour : le garde-fou de version (App.vue), dont
// c'est le seul avertissement — le voile couvre tout l'écran (`position: fixed;
// inset: 0`) et un appui accidenté au démarrage l'aurait fermé sans retour possible
// avant le prochain lancement de l'app. `false` désarme UNIQUEMENT le voile et Échap ;
// les boutons (Annuler/Confirmer) continuent de fermer normalement le dialogue dans
// tous les cas — ce n'est pas un dialogue qu'on ne peut pas fermer, seulement un
// dialogue qu'on ne ferme pas par erreur.
const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, required: true },
  message: { type: String, required: true },
  confirmLabel: { type: String, required: true },
  cancelLabel: { type: String, default: null },
  danger: { type: Boolean, default: false },
  centered: { type: Boolean, default: false },
  dismissOnScrim: { type: Boolean, default: true },
  dismissAction: { type: String, default: 'cancel', validator: (v) => v === 'cancel' || v === 'confirm' },
})
const emit = defineEmits(['confirm', 'cancel'])
// Identifiant de titre PAR INSTANCE, via `useId()` (Vue 3.5) — PAS un compteur déclaré ici :
// le corps d'un `<script setup>` EST la fonction `setup()`, il re-tourne à chaque instance,
// donc un `let seq = 0` local redonnerait 1 à tout le monde (le `numpromptId()` de
// cm-editor.js ne marche que parce que ce fichier-là est un module .js ordinaire).
// Un `id="cfd-title"` en dur cassait `aria-labelledby` dès que deux dialogues coexistaient —
// LibraryView en monte deux et FirstDetailTip un troisième sur le même écran : le nom
// accessible se résolvait sur le PREMIER du DOM, donc une confirmation de suppression
// s'annonçait sous le titre de l'astuce restée ouverte derrière.
const titleId = useId()
const cancelBtn = ref(null)
const confirmBtn = ref(null)
const hasCancel = computed(() => !!props.cancelLabel)
// Ce qu'émet un appui « à côté » (Échap, voile) — et ce qui reçoit le focus initial.
// Sans second bouton, c'est TOUJOURS `confirm` (rien d'autre n'existe). Avec un second
// bouton, c'est `dismissAction` qui tranche (`cancel` par défaut, comportement historique
// inchangé) : cf. le commentaire de la prop plus haut.
const safeEmit = computed(() => (hasCancel.value ? props.dismissAction : 'confirm'))

// Restitution du focus au déclencheur à la fermeture (dette audit UX 16/07, composable
// partagé) — appelée AVANT le watch de focus-initial ci-dessous : l'ordre de création des
// watchers est leur ordre d'exécution, la capture d'ouverture doit donc passer en premier
// (sinon elle enregistrerait le bouton DANS la carte au lieu du déclencheur).
useDialogFocusReturn(() => props.open)

// Focus sur l'option SÛRE désignée par `safeEmit` (Annuler par défaut, si un second bouton
// existe ; le bouton unique sinon ; « J'ai compris » pour un appelant qui a inversé
// `dismissAction`, cf. son commentaire plus haut). `aria-modal` rend le fond inerte pour le
// lecteur d'écran mais ne déplace PAS le focus clavier : sans ça, le focus resterait sur
// l'élément qui a ouvert le dialogue, désormais derrière le voile, et le prochain Tab
// repartirait de là.
watch(
  () => props.open,
  async (open) => {
    if (open) {
      await nextTick()
      ;(safeEmit.value === 'cancel' ? cancelBtn : confirmBtn).value?.focus()
    }
  },
  { immediate: true },
)

function onKey(e) {
  if (e.key === 'Escape' && props.dismissOnScrim) emit(safeEmit.value)
}
// Piège déjà rencontré sur YarnConsumptionDialog/ColorPickerDialog : sans
// { immediate: true }, un composant monté déjà ouvert n'attache jamais l'écouteur Échap.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) document.addEventListener('keydown', onKey)
    else document.removeEventListener('keydown', onKey)
  },
  { immediate: true },
)
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <!-- `open &&` devant chaque émission : pendant le fondu de sortie, la carte reste
       cliquable ; un double-tap émettait deux fois (CorrectionView reculait de deux écrans). -->
  <Transition name="fade">
    <div v-if="open" class="cfd" :class="{ 'cfd--centered': centered }">
      <div class="cfd__scrim" @click="open && dismissOnScrim && emit(safeEmit)"></div>
      <div
        class="cfd__card"
        :class="{ 'cfd__card--centered': centered }"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        @keydown="trapTabFocus"
      >
        <h2 :id="titleId" class="cfd__title">{{ title }}</h2>
        <p class="cfd__msg">{{ message }}</p>
        <div class="cfd__actions">
          <button v-if="hasCancel" ref="cancelBtn" class="btn" data-test="confirm-cancel" @click="open && emit('cancel')">{{ cancelLabel }}</button>
          <button
            ref="confirmBtn"
            class="btn"
            :class="danger ? 'cfd__go--danger' : 'btn--primary'"
            data-test="confirm-ok"
            @click="open && emit('confirm')"
          >
            {{ confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* Feuille du bas — motif de `YarnConsumptionDialog` (`.ycn`) et charte §2.10.
   Le voile est un élément à part, et sa couleur est écrite en dur : c'est la
   convention du projet, aucun token n'existe pour lui. */
.cfd { position: fixed; inset: 0; z-index: 80; display: flex; align-items: flex-end; justify-content: center; }
.cfd__scrim { position: absolute; inset: 0; background: rgba(58, 46, 40, 0.42); }
.cfd__card {
  position: relative;
  width: 100%;
  max-width: 480px;
  background: var(--bg);
  border-radius: var(--r-lg) var(--r-lg) 0 0;
  box-shadow: var(--e-3);
  padding: var(--sp-4) max(var(--sp-4), var(--sa-left)) max(var(--sp-4), var(--sa-bottom));
}
.cfd__title { font-family: var(--font-display); font-size: 20px; margin: 0; color: var(--ink); }
.cfd__msg { margin: var(--sp-3) 0 var(--sp-5); color: var(--ink-70); font-size: 14px; line-height: 1.5; }
.cfd__actions { display: flex; gap: var(--sp-3); }
.cfd__actions .btn { flex: 1; min-height: 44px; }
/* fond --danger : solide, ne suit PAS la teinte → texte clair statique --on-solid
   (var(--on-accent) devient sombre dans la bande chaude claire : 2,23:1 ici, illisible) */
.cfd__go--danger { background: var(--danger); color: var(--on-solid); border-color: transparent; }

/* Variante centrée (`centered`) — la bienvenue du premier lancement (HomeView.vue), le
   garde-fou de version (App.vue) et l'avertissement d'import (LibraryView.vue) l'activent ;
   tous les autres appelants restent en feuille du bas (cf. le commentaire de la prop
   ci-dessus). Motif repris de `.ofp-overlay`/`.ofp-overlay__panel` (OnboardingFolderPrompt.vue) : le
   voile centre la carte au lieu de l'ancrer en bas, et porte lui-même les marges de zone
   sûre (encoche en haut, barre système en bas) pour que la carte n'y passe jamais dessous.
   Les 4 coins s'arrondissent puisque la carte ne touche plus aucun bord. */
.cfd--centered { align-items: center; padding: max(var(--sp-4), var(--sa-top)) var(--sp-4) max(var(--sp-4), var(--sa-bottom)); }
/* `max-height`/`overflow-y` : même filet que `.ycn__card`/`.ydet__card`/`.wg__card`. Un
   texte long (l'allemand notamment) ne doit jamais pousser la carte sous l'encoche ou la
   barre système — elle défile en interne plutôt que de déborder de la zone sûre. */
.cfd__card--centered { border-radius: var(--r-lg); padding: var(--sp-4); max-height: 82vh; overflow-y: auto; }

.fade-enter-active, .fade-leave-active { transition: opacity var(--motion-fast); }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
