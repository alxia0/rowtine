<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { NOTICE } from '@/constants/notice-queue'
import { useNoticeSlot } from '@/composables/useNoticeSlot'

// L'ASTUCE DE NAVIGATION (les travaux sur les pop-ups du premier lancement, 10/08/2026).
//
// Elle vivait sur l'accueil, où elle expliquait comment REVENIR à quelqu'un qui venait
// d'arriver et n'avait encore rien ouvert. Elle s'est d'abord montrée à la première fiche
// ouverte (projet, patron ou laine) parce que c'était le premier moment où « revenir en
// arrière » voulait dire quelque chose — ce placement a depuis bougé une seconde fois, cf.
// la décision du 19/08 plus bas : il ne reste vrai QUE pour la fiche projet.
//
// Le composant est AUTONOME : il porte la lecture du drapeau, l'affichage et
// l'acquittement, et se pose en une ligne, sans props. Les trois vues qui l'accueillent
// n'ont donc rien à savoir de lui, et la logique n'existe qu'à un seul endroit.
//
// Le drapeau reste `swipeHintSeen`, qui existait déjà : une installation en service l'a à
// vrai et ne reverra donc pas l'astuce dans sa version enrichie. C'est voulu (décision produit,
// 10/08) — rouvrir une pop-up chez une utilisatrice à qui l'app est familière
// serait plus intrusif qu'utile.
//
// DÉCISION DU 19/08/2026 — L'ASTUCE VIT SUR LES LISTES, PAS SUR LA FICHE PATRON. Mot pour mot : « l'astuce de
// balayage de l'écran ne doit apparaître que la première fois qu'on ouvre un projet, qu'on
// va dans la bibliothèque de patrons ou qu'on va dans le stock de laine, elle n'a rien à
// voir avec l'étape d'import d'un patron. » Le texte même de l'astuce le dit déjà : « […]
// quand une bande d'onglets ou de catégories dépasse de l'écran — dans un projet, dans la
// bibliothèque —, fais-la glisser du doigt » — il nomme lui-même « un projet » et « la
// bibliothèque », jamais « un patron ». Elle est donc désormais posée par `LibraryView` et
// `StashView` (écrans de liste, nouveaux points de montage) et par `ProjectDetailView`
// (fiche projet, inchangée) ; elle a quitté `PatternView` pour de bon. Un correctif antérieur
// lui avait fait céder la place sur cet écran, seul, devant le bandeau d'avertissement d'import, via
// une prop `suppressed` — cette prop est retirée ici : l'astuce n'étant plus montée sur
// `PatternView`, elle ne pouvait plus jamais valoir `true`. La garder aurait été le défaut
// que la revue a déjà fait retirer une fois ailleurs sur ce composant (cf.
// l'ex-`onBeforeUnmount`, plus bas) : du code qu'aucun chemin n'atteint, gardé « au cas où ».
const { t } = useI18n()
const settings = useSettingsStore()
const candidate = ref(false)

const wants = computed(() => candidate.value)

// Au démontage (navigation qui coïncide avec le retrait d'un message plus fort, par
// exemple), rien à faire ici EXPRÈS : c'est `scope.stop()`, que Vue appelle
// SYNCHRONIQUEMENT juste après les crochets `onBeforeUnmount`, qui coupe le `watch`
// ci-dessous AVANT tout flush — aucun job en attente ne peut plus s'exécuter.
//
// ⚠️ CE MÉCANISME NE COUVRE QUE LE DÉMONTAGE, ET IL NE SUFFIT PAS À LUI SEUL. La rédaction
// d'origine (« c'est ce mécanisme-là, et lui seul, qui empêche le drapeau de s'écrire sur
// une astuce jamais peinte ») était FAUSSE, et la revue du 19/08 en a
// mesuré le contre-exemple : sur une instance VIVANTE, `scope.stop()` ne tourne pas. Le
// bouton « Comment corriger » de l'avertissement d'import effaçait alors son drapeau
// (rang 6) AVANT de naviguer ; la file promouvait aussitôt l'astuce (rang 7) sur une
// Bibliothèque encore montée, et le `watch` ci-dessous écrivait `swipeHintSeen` sur une
// pop-up que personne n'aurait jamais vue — la seconde ceinture `&& wants.value` n'y
// pouvait rien non plus, `wants` étant encore vrai. La garantie complète tient donc à DEUX
// choses, pas une :
//   • ICI, `scope.stop()`, pour tout ce qui passe par un démontage ;
//   • CHEZ L'APPELANT, ne jamais libérer un rang plus fort tant que l'écran qu'on quitte est
//     encore monté — corrigé dans `LibraryView.vue` (`caveatToGuide` navigue d'abord et
//     efface le drapeau ensuite), gardé par
//     `tests/unit/library-caveat-vers-guide-astuce.spec.js`.
// « G5 ter » (tests/unit/first-detail-tip-bandeau-import.spec.js) constate le
// RÉSULTAT de ce mécanisme (rien n'est écrit en base, la file oublie le demandeur après un
// démontage pendant l'attente) — il ne construit pas la situation où un job du `watch`
// serait déjà planifié avant le démontage, et ne prouve donc pas le mécanisme lui-même
// (revue du 19/08 : la citation d'origine surclassait sa preuve). Le mécanisme est vrai —
// confirmé contre les sources de Vue 3.5.41 — c'était la façon de le citer qui était trop
// forte.
// Un `onBeforeUnmount` local avait été posé ici à tort le 19/08 : mesuré par mutation, il
// ne changeait rien (le retrait de `useNoticeSlot` est de toute façon inconditionnel), et
// son commentaire annonçait un mécanisme qui n'existe pas — retiré à la revue du 19/08.
const hasSlot = useNoticeSlot(NOTICE.SWIPE_HINT, wants)

onMounted(async () => {
  // Même filet que HomeView : le garde de route charge déjà les réglages avant qu'on
  // n'arrive sur une fiche, mais un montage direct du composant (tests, ou tout futur
  // point d'entrée qui court-circuiterait le garde) doit fonctionner aussi.
  if (!settings.loaded) await settings.load()
  if (settings.swipeHintSeen) return
  candidate.value = true
})

// LE DRAPEAU S'ÉCRIT QUAND L'ASTUCE EST RÉELLEMENT À L'ÉCRAN, jamais avant. C'est la même
// doctrine qu'au 10/08 (une astuce MONTRÉE est une astuce vue, quelle que soit la façon dont
// on s'en va ensuite — le geste qu'elle enseigne quitte l'écran sans passer par `dismiss`),
// appliquée au bon instant.
// `&& wants.value` est la seconde ceinture, gardée pour couvrir un entrelacement que
// `scope.stop()` seul ne bloque pas : sur une instance VIVANTE (pas de démontage), le plus
// fort se retire, `hasSlot` bascule à vrai, PUIS `candidate` repasse à faux dans le même
// battement — le callback peut alors partir avec `affichee = true` alors que la file
// referme la porte au flush suivant, avant toute peinture réelle. Une astuce jamais peinte
// ne doit jamais être marquée vue.
// ⚠️ Depuis que `suppressed` a disparu (19/08), `wants` est TEXTUELLEMENT
// `candidate` (cf. plus haut) : cette ceinture ne couvre plus qu'UN SEUL entrelacement, pas
// deux — la mention d'un second (l'ex-`suppressed` qui remontait) serait désormais fausse,
// elle est retirée. `&& wants.value` reste néanmoins l'écriture à garder plutôt que
// `&& candidate.value` en dur : la variable reste juste, et une réapparition future d'une
// seconde condition dans `wants` (un nouveau `suppressed`, par exemple) redeviendrait
// couverte sans toucher cette ligne.
// ⚠️ Aucun test ne couvre ce garde-fou : à ce jour, aucun chemin d'appel réel ne pose
// `wants` à faux pendant que la file promeut `SWIPE_HINT` sur une instance vivante —
// confirmé par mutation (retirer `&& wants.value` ne fait rougir personne).
// C'est de la défense en profondeur pour un chemin futur, pas le correctif d'un bug
// observé (à la différence de l'ex-`onBeforeUnmount` retiré ci-dessus, qui lui était
// mesurablement sans effet).
watch(hasSlot, async (affichee) => {
  if (affichee && wants.value) await settings.markSwipeHintSeen()
})

// Redondant avec l'écriture ci-dessus dans le cas nominal (le drapeau est déjà à `true`
// depuis l'affichage, via le `watch`) — gardé pour l'idempotence et parce que la fermeture
// par bouton reste, elle, un geste que l'utilisatrice PEUT ne jamais faire (cf. commentaire
// du 10/08 ci-dessus) : rien ne doit dépendre de cet appel-ci pour que le drapeau soit posé.
async function dismiss() {
  candidate.value = false
  await settings.markSwipeHintSeen()
}
</script>

<template>
  <ConfirmDialog
    :open="hasSlot"
    :title="t('onboarding.tipTitle')"
    :message="t('onboarding.swipeHint')"
    :confirm-label="t('common.gotIt')"
    @confirm="dismiss"
  />
</template>
