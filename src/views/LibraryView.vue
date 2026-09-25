<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AppHeader from '@/components/AppHeader.vue'
import BackToTop from '@/components/BackToTop.vue'
import ThumbImage from '@/components/ThumbImage.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import FirstDetailTip from '@/components/FirstDetailTip.vue'
import { usePatternsStore } from '@/stores/patterns'
import { useTrashStore } from '@/stores/trash'
import { useProjectsStore } from '@/stores/projects'
import { useSoftDelete } from '@/composables/useSoftDelete'
import { useScrollFade } from '@/composables/useScrollFade'
import { PATTERN_CATEGORIES, patternCategoryLabel } from '@/constants/catalog'
import { countByCategory } from '@/utils/pattern-counts'
import { sizeLabelText } from '@/utils/reader'
import { patternCoverOf } from '@/utils/pattern-cover'
import AppIcon from '@/components/AppIcon.vue'
import { useImportHandoff } from '@/stores/import-handoff'
import { PDF_ACCEPT, ROWTINE_ACCEPT } from '@/utils/import-kind'
import { EXAMPLE_PATTERN } from '@/constants/empty-samples'
import { useSettingsStore } from '@/stores/settings'
import { NOTICE } from '@/constants/notice-queue'
import { useNoticeSlot } from '@/composables/useNoticeSlot'
import { trapTabFocus, useDialogFocusReturn } from '@/composables/useFocusTrap'
import { GUIDE_SECTION_BIBLIOTHEQUE } from '@/constants/guide-sections'

const router = useRouter()
const { t } = useI18n()
const patternsStore = usePatternsStore()
const trashStore = useTrashStore()
const projectsStore = useProjectsStore()
const softDelete = useSoftDelete()
const handoff = useImportHandoff()

const pendingDelete = ref(null) // { id, linkedCount } — patron en attente de confirmation

// Audit UX 17/07 (P2) : les 3 boutons d'ajout (import PDF / import IA / manuel),
// empilés, poussaient la liste très bas. Décision produit : un seul bouton « Ajouter un
// patron » (icône plus, pas de « + » littéral), qui ouvre une feuille du bas à 3 choix
// (motif YarnConsumptionDialog/.ycn).
const addSheetOpen = ref(false)
const addSheetCloseBtn = ref(null)
// Piège au Tab + restitution au déclencheur à la fermeture de la feuille (dette audit UX
// 16/07, composable partagé) — appelé AVANT le watch de focus-initial ci-dessous (l'ordre
// de création des watchers est leur ordre d'exécution : la capture d'ouverture passe
// d'abord, avant que le focus n'entre dans la feuille).
useDialogFocusReturn(addSheetOpen)

function closeAddSheet() {
  addSheetOpen.value = false
}
function onAddSheetKey(e) {
  if (e.key === 'Escape') closeAddSheet()
}
watch(
  addSheetOpen,
  async (isOpen) => {
    if (isOpen) {
      document.addEventListener('keydown', onAddSheetKey)
      await nextTick()
      addSheetCloseBtn.value?.focus()
    } else {
      document.removeEventListener('keydown', onAddSheetKey)
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => document.removeEventListener('keydown', onAddSheetKey))

// Import direct : le tap sur le label (dans la feuille) ouvre le sélecteur natif (geste
// utilisateur requis) ; au choix du fichier, on le pose dans le relais et on file à l'écran
// d'import. Annuler le sélecteur (aucun fichier) ne navigue pas.
//
// Deux portes (décision du 23/09, qui lève la porte de service cachée du 08/08) : l'import PDF,
// et l'import au format de l'app (.rowtine ou .zip), passé à l'écran d'import par
// `?format=rowtine`. L'écran reconnaît le fichier à son contenu (cf. utils/import-kind.js).
function onImportFile(e, format) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  closeAddSheet()
  handoff.set(file)
  router.push(format ? { name: 'import-local', query: { format } } : { name: 'import-local' })
}

// AVERTISSEMENT « UN PATRON IMPORTÉ SE RELIT » (19/08/2026).
//
// Il se montre UNE FOIS, à la première visite de la Bibliothèque, et jamais plus. Il est le
// dernier de la file : il ne se justifie qu'une fois arrivée ici, donc plus tard que la
// porte du dossier, la décision de sauvegarde et la bienvenue.
//
// ⚠️ LE DRAPEAU NE S'EFFACE QU'À L'ACQUITTEMENT, jamais à la demande. Si un message plus
// fort occupe l'écran, ou si l'utilisatrice quitte la Bibliothèque avant d'avoir vu la
// pop-up, celle-ci revient à la visite suivante. L'effacer plus tôt la ferait disparaître
// sans jamais avoir été lue — perte silencieuse, exactement ce que ce mécanisme combat.
//
// ⚠️ Ce n'est PAS le rappel permanent retiré le 17/08 (gardé
// par tests/unit/library-import-notice.spec.js) : celui-là vivait en permanence sous le
// bouton d'import. Celui-ci se montre une fois, puis disparaît pour toujours.
const settings = useSettingsStore()
const caveatHasSlot = useNoticeSlot(NOTICE.IMPORT_CAVEAT, () => settings.importCaveatDue)

async function dismissCaveat() {
  await settings.clearImportCaveatDue()
}

// ⚠️ ON NAVIGUE D'ABORD, ON EFFACE LE DRAPEAU ENSUITE — l'ordre inverse (celui livré par la
// corrigé à la revue du 19/08) BRÛLAIT l'astuce de balayage. Le
// mécanisme, mesuré : à la première visite, l'avertissement (rang 6) et l'astuce (rang 7)
// sont demandeurs ENSEMBLE. Effacer le drapeau libère le rang 6 alors que la Bibliothèque
// est ENCORE MONTÉE — la file promeut aussitôt l'astuce, dont le `watch` écrit
// `swipeHintSeen` en mémoire et en base, sur une pop-up que personne n'a jamais vue puisque
// la navigation part dans le même battement. L'astuce ne revenait plus JAMAIS, sur aucun
// écran.
//
// `await router.push(...)` : la route confirmée est posée de façon réactive, ce qui met en
// file le rendu de la `<RouterView/>` AVANT que la promesse de `push` ne se résolve — le
// démontage de la Bibliothèque a donc lieu avant la reprise ci-dessous. Ce démontage retire
// les DEUX demandeurs de la file (`useNoticeSlot`), et `scope.stop()` coupe le `watch` de
// l'astuce : effacer le drapeau après ne peut plus rien promouvoir.
//
// ⚠️ Ce que le garde-fou prouve exactement : le RÉSULTAT, pas le chronomètre. Il constate que
// `swipeHintSeen` reste faux — ce qui serait impossible si l'effacement était arrivé avant le
// démontage, puisque la file aurait alors promu l'astuce sur un écran vivant. Il ne mesure pas
// l'instant du démontage par rapport à celui de l'effacement, et ne prouve donc pas
// l'ordonnancement décrit ci-dessus autrement que par sa conséquence observable.
// Prouvé par `tests/unit/library-caveat-vers-guide-astuce.spec.js`, qui monte un VRAI
// routeur — le routeur mocké de `library-import-caveat.spec.js` ne démonte rien et ne
// pouvait pas voir ce défaut.
//
// ⚠️ Effacer APRÈS ne fragilise pas « G9 » (le drapeau d'import survit à un démontage SANS
// acquittement) : ici l'acquittement a bien eu lieu, par un clic délibéré, et l'écriture part
// quand même — elle ne dépend pas du composant démonté, seulement du magasin des réglages,
// qui, lui, survit à la navigation.
async function caveatToGuide() {
  await router.push({ name: 'guide', query: { section: GUIDE_SECTION_BIBLIOTHEQUE } })
  await settings.clearImportCaveatDue()
}

onMounted(async () => {
  // Le garde de route charge déjà les réglages avant d'entrer ici en usage réel ; ce filet
  // couvre le montage direct du composant (tests, ou tout futur point d'entrée qui
  // court-circuiterait le garde). Même motif que HomeView.
  if (!settings.loaded) await settings.load()
  if (!patternsStore.loaded) patternsStore.load()
})

const catFilter = ref('')
const filtered = computed(() => {
  const base = patternsStore.libraryPatterns
  return catFilter.value ? base.filter((p) => p.category === catFilter.value) : base
})

// Compteurs affichés sur les pastilles. La base DOIT être `libraryPatterns` — la même que
// `filtered` ci-dessus, qui exclut les instances rattachées à un projet. Toute autre base
// ferait annoncer « (5) » à une pastille qui n'ouvre que 3 fiches.
const counts = computed(() => countByCategory(patternsStore.libraryPatterns))

// Indice de défilement (T8, réutilisé tel quel — même motif que les onglets de la fiche
// projet) : la bande de chips défile déjà (`overflow-x: auto`) mais sa barre de scroll est
// masquée volontairement (`scrollbar-width: none`) — rien ne dit donc que les dernières
// catégories, coupées à droite, sont atteignables. `chipsFadeActive` n'est vrai que si ça
// déborde RÉELLEMENT (voir useScrollFade) : pas de dégradé permanent qui mentirait.
const chipsEl = ref(null)
// Destructuré à la source (pas `const chipsFade = useScrollFade(...)`) : `chipsFade.active`
// dans le template n'aurait PAS été déballé (le ref imbriqué dans un objet simple non
// réactif reste un objet Ref — toujours truthy dans un `:class`), et la classe ne serait
// jamais retombée. Même piège que documenté dans ProjectDetailView.vue (T8).
const { active: chipsFadeActive } = useScrollFade(chipsEl)

const categoryLabel = (p) => patternCategoryLabel(p, t)

function startManual() {
  closeAddSheet()
  router.push({ name: 'pattern-new' })
}
// Un patron utilisé par des projets, c'est une action LOURDE : on prévient (charte §3).
// Sans projet lié, on garde le geste immédiat + « Annuler » (charte §2.11).
async function remove(id) {
  const linked = await projectsStore.usingPattern(id)
  if (linked.length) {
    pendingDelete.value = { id, linkedCount: linked.length }
    return
  }
  await doRemove(id)
}

async function doRemove(id) {
  // Retrait et mise en corbeille dans une même transaction (cf. trash.js `moveToTrash`).
  const trashId = await trashStore.moveToTrash('pattern', id)
  await patternsStore.load()
  if (trashId == null) return
  await softDelete('pattern', null, { message: t('pattern.deleted'), reload: patternsStore.load, trashId })
}

async function confirmDelete() {
  const id = pendingDelete.value?.id
  pendingDelete.value = null
  if (id != null) await doRemove(id)
}
function open(id) {
  router.push({ name: 'pattern', params: { id } })
}
</script>

<template>
<div>
  <AppHeader :title="t('nav.library')" />
  <main class="screen">
    <div class="chips" ref="chipsEl" :class="{ 'chips--fade': chipsFadeActive }">
      <button class="chip" :class="{ 'chip--on': catFilter === '' }" @click="catFilter = ''">{{ t('pattern.all') }} ({{ counts.total }})</button>
      <button
        v-for="c in PATTERN_CATEGORIES"
        :key="c"
        class="chip"
        :class="{ 'chip--on': catFilter === c }"
        @click="catFilter = c"
      >
        {{ t(`pattern.categories.${c}`) }} ({{ counts.byCategory[c] }})
      </button>
    </div>

    <button type="button" class="btn btn--primary btn--block mt" @click="addSheetOpen = true">
      <AppIcon name="plus" :size="17" /> {{ t('pattern.add') }}
    </button>

    <div class="list">
      <div v-for="p in filtered" :key="p.id" class="pcard">
        <ThumbImage class="pcard__thumb" :src="patternCoverOf(p)" kind="pattern" :seed="p.name" :alt="p.name" />
        <button class="pcard__main" @click="open(p.id)">
          <span class="pcard__name">{{ p.name }}</span>
          <span class="pcard__meta">{{ t(`technique.${p.type}`) }}<template v-if="p.category"> · {{ categoryLabel(p) }}</template><template v-if="p.sizes && p.sizes.length"> · {{ p.sizes.map((s) => sizeLabelText(s, t)).join(', ') }}</template></span>
        </button>
        <button class="pcard__del" :aria-label="t('common.delete')" @click="remove(p.id)"><AppIcon name="close" :size="15" /></button>
      </div>
    </div>
    <template v-if="!filtered.length">
      <div v-if="patternsStore.libraryPatterns.length === 0" class="empty-wrap">
        <div class="pcard pcard--example" aria-hidden="true">
          <div class="pcard__thumb pcard__thumb--ex"></div>
          <div class="pcard__main pcard__main--ex">
            <span class="pcard__name">{{ t('pattern.emptyExampleName') }}</span>
            <span class="pcard__meta">{{ t('technique.knitting') }} · {{ EXAMPLE_PATTERN.sizes.join(', ') }}</span>
          </div>
          <span class="ex-badge">{{ t('common.example') }}</span>
        </div>
        <p class="empty-hint">{{ t('pattern.emptyExampleHint') }}</p>
      </div>
      <p v-else class="muted">{{ t('pattern.empty') }}</p>
    </template>

    <ConfirmDialog
      :open="pendingDelete != null"
      :title="t('pattern.deleteLinkedTitle')"
      :message="t('pattern.deleteLinkedMsg', { n: pendingDelete?.linkedCount || 0 }, pendingDelete?.linkedCount || 0)"
      :confirm-label="t('pattern.deleteAnyway')"
      :cancel-label="t('common.cancel')"
      danger
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />

    <!-- Feuille « Ajouter un patron » — motif YarnConsumptionDialog/.ycn (voile séparé,
         carte role=dialog, coins hauts arrondis, safe-area). Le <label> PDF DOIT rester
         un enfant direct de sa carte, avec son <input> non déplacé : c'est le geste
         utilisateur direct qui ouvre le sélecteur natif (cf. commentaire du piège). -->
    <Transition name="fade">
      <div v-if="addSheetOpen" class="pas">
        <div class="pas__scrim" @click="closeAddSheet"></div>
        <div class="pas__card" role="dialog" aria-modal="true" aria-labelledby="pas-title" @keydown="trapTabFocus">
          <header class="pas__head">
            <h2 id="pas-title" class="pas__title">{{ t('pattern.add') }}</h2>
            <button
              ref="addSheetCloseBtn"
              class="pas__close"
              type="button"
              :aria-label="t('common.close')"
              @click="closeAddSheet"
            >
              <AppIcon name="close" :size="18" />
            </button>
          </header>
          <div class="pas__options">
            <label class="pas__opt lib-import">
              <AppIcon name="import" :size="20" />
              <span class="pas__opt-body">
                {{ t('pattern.importPdf') }}
                <!-- Le rappel « fichiers non reconnus » qui vivait ici (en petit, sous le
                     libellé) est retiré (17/08) : le cas réel est couvert par le
                     bloc « Import risqué » de l'écran d'import (LocalPdfImportView.vue), qui
                     dit la même chose au bon moment — quand ça arrive vraiment, pas en
                     permanence sous un bouton. -->
              </span>
              <input type="file" :accept="PDF_ACCEPT" class="lib-import__input lib-import__input--pdf" @change="onImportFile($event)" />
            </label>
            <label class="pas__opt lib-import">
              <AppIcon name="book" :size="20" />
              <span class="pas__opt-body">{{ t('pattern.importRowtine') }}</span>
              <input
                type="file"
                :accept="ROWTINE_ACCEPT"
                class="lib-import__input lib-import__input--rowtine"
                @change="onImportFile($event, 'rowtine')"
              />
            </label>
            <button type="button" class="pas__opt" @click="startManual">
              <AppIcon name="edit" :size="20" /> {{ t('pattern.addManual') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </main>
  <!-- Écran à défilement de page (document) : pas de cible, même câblage que les 4 autres
       écrans longs (stock, fiche patron, fiche projet, dépenses). -->
  <BackToTop />

  <!-- Astuce de navigation (décision produit du 19/08/2026, mot pour mot :
       « … qu'on va dans la bibliothèque de patrons … elle n'a rien à voir avec l'étape
       d'import d'un patron »). Nouveau point de montage : l'astuce vivait auparavant sur
       la fiche patron (PatternView), qui l'a perdue — la Bibliothèque la gagne désormais, comme le
       dit son propre texte (« … une bande d'onglets ou de catégories dépasse de l'écran —
       dans un projet, dans la bibliothèque »). Posée dès la visite de l'écran, sans
       condition : elle décide seule si elle a le droit de s'afficher. -->
  <FirstDetailTip />

  <!-- Avertissement d'import, une seule fois (19/08/2026). Le bouton « Annuler » de
       ConfirmDialog porte ici le renvoi vers le guide : c'est la voie secondaire, celle
       qu'on prend quand on veut en savoir plus, et l'unique bouton principal reste
       l'acquittement.
       `dismiss-action="confirm"` (décision produit du 19/08/2026, revue,
       mot pour mot : « un appui à côté doit juste fermer ») : Échap et un clic sur le
       voile ferment la pop-up comme « J'ai compris » (acquittement, PAS de navigation),
       et le focus initial se pose sur ce bouton sûr — jamais sur « Comment corriger »,
       qui NAVIGUE et ne doit s'activer que sur un clic délibéré. -->
  <ConfirmDialog
    :open="caveatHasSlot"
    centered
    dismiss-action="confirm"
    :title="t('importCaveat.title')"
    :message="t('importCaveat.body')"
    :cancel-label="t('importCaveat.howToFix')"
    :confirm-label="t('common.gotIt')"
    @confirm="dismissCaveat"
    @cancel="caveatToGuide"
  />
</div>
</template>

<style scoped>
.lib-import { cursor: pointer; }
/* input masqué mais focusable (WCAG 2.1.1) : le label stylé est le bouton visible. */
.lib-import__input { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); border: 0; }
.lib-import:focus-within { outline: 2px solid var(--brand-deep); outline-offset: 2px; border-radius: var(--r-md); }

/* Feuille « Ajouter un patron » — motif de `YarnConsumptionDialog` (`.ycn`) et charte
   §2.10. Le voile est un élément à part, et sa couleur est écrite en dur : c'est la
   convention du projet, aucun token n'existe pour lui. */
.pas { position: fixed; inset: 0; z-index: 80; display: flex; align-items: flex-end; justify-content: center; }
.pas__scrim { position: absolute; inset: 0; background: rgba(58, 46, 40, 0.42); }
.pas__card {
  position: relative;
  width: 100%;
  max-width: var(--w-dialog);
  background: var(--bg);
  border-radius: var(--r-lg) var(--r-lg) 0 0;
  box-shadow: var(--e-3);
  padding: var(--sp-4) max(var(--sp-4), var(--sa-left)) max(var(--sp-4), var(--sa-bottom));
}
.pas__head { display: flex; align-items: center; gap: var(--sp-2); }
.pas__title { flex: 1; font-family: var(--font-display); font-size: 20px; margin: 0; color: var(--ink); }
.pas__close { flex-shrink: 0; width: 44px; height: 44px; border: 1px solid var(--line); background: var(--tile); color: var(--ink); border-radius: var(--r-md); box-shadow: var(--clay-sm); }
.pas__options { display: flex; flex-direction: column; gap: var(--sp-2); margin-top: var(--sp-3); }
.pas__opt {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  width: 100%;
  min-height: 56px;
  background: var(--tile);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: var(--sp-3);
  box-shadow: var(--clay-sm);
  font-weight: 600;
  font-size: 15px;
  color: var(--ink);
  text-align: left;
  cursor: pointer;
}
/* Option « Importer un PDF » : libellé uniquement (un seul nœud de texte depuis le
   retrait du rappel, 17/08 — plus besoin d'empiler deux lignes). */
.pas__opt-body { display: flex; min-width: 0; }
.fade-enter-active, .fade-leave-active { transition: opacity var(--motion-fast); }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* Bande à une seule rangée qui défile (audit UX 17/07) : les 10 chips (« Tous » +
   9 catégories) occupaient 4 rangées en `flex-wrap: wrap` avant la liste de patrons — une
   hauteur variable selon la largeur d'écran. Même remède que `.tabs` (T8, cf.
   ProjectDetailView.vue) : rangée unique défilante, barre de scroll native masquée. */
.chips { display: flex; flex-wrap: nowrap; gap: var(--sp-2); margin-bottom: var(--sp-2); overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; padding-bottom: 2px; }
.chips::-webkit-scrollbar { display: none; }
/* Indice de défilement (T8, réutilisé) : posé UNIQUEMENT quand ça déborde réellement
   (useScrollFade), jamais en CSS pur inconditionnel — un dégradé permanent sur une bande
   qui tient à l'écran mentirait. `mask-image` fait varier l'alpha réel des chips près du
   bord droit : ça laisse transparaître le fond quel qu'il soit, donc ZÉRO couleur/token de
   fond à coder en dur (contrairement à un overlay `background: linear-gradient(...)`). */
.chips--fade {
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent 100%);
  mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent 100%);
}
/* Chips = vrais boutons : cible tactile minimale du projet (44 px, cf. CorrectionView) —
   hauteur pilotée par `min-height`, centrage flex, padding vertical nul pour garder la
   pilule équilibrée. Sans repasser la bande sur deux rangées (règle `.chips` ci-dessus). */
.chip { flex-shrink: 0; white-space: nowrap; border: 1px solid var(--line); background: var(--bg); color: var(--ink-55); font-weight: 600; font-size: 13px; padding: 0 13px; border-radius: var(--r-pill); min-height: 44px; display: inline-flex; align-items: center; }
.chip--on { background: var(--brand); border-color: var(--brand); color: var(--on-accent); }
.mt { margin-top: var(--sp-2); }
.list { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr)); gap: var(--sp-2); margin-top: var(--sp-4); }
.pcard { display: flex; align-items: center; background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--sp-3) var(--sp-4); box-shadow: var(--clay-sm); }
.pcard__main { flex: 1; border: none; background: transparent; text-align: left; }
.pcard__name { display: block; font-family: var(--font-display); font-weight: 600; font-size: 16px; color: var(--ink); }
.pcard__meta { color: var(--ink-55); font-size: 13px; }
.pcard__del { display: flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; flex-shrink: 0; border: none; background: transparent; color: var(--ink-55); font-size: 14px; }
.pcard__thumb { width: 44px; height: 44px; margin-right: var(--sp-3); }
.muted { color: var(--ink-55); margin-top: var(--sp-4); }

/* Carte exemple éphémère — bibliothèque de patrons entièrement vide. Motif partagé
   avec StashView ; classes répliquées ici en CSS scopé (pas de collision voulue). */
.empty-wrap { margin-top: var(--sp-4); }
/* Pas d'opacity globale : elle composite le texte muté (--ink-55) sous le seuil AA
   de contraste (axe color-contrast). L'affordance « exemple » passe par le badge +
   la bordure pointillée + l'accroche dessous, pas par une atténuation. */
.pcard--example { pointer-events: none; }
.pcard__thumb--ex { width: 44px; height: 44px; margin-right: var(--sp-3); border-radius: var(--r-sm); border: 1px solid var(--line); background: var(--tile); }
.pcard__main--ex { flex: 1; }
.ex-badge { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: var(--ink-55); border: 1px dashed var(--line); border-radius: var(--r-pill); padding: 1px 8px; }
.empty-hint { color: var(--ink-55); font-size: 14px; text-align: center; max-width: 34ch; margin: var(--sp-3) auto 0; }
</style>
