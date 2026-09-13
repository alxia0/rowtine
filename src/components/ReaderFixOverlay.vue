<script setup>
// Voile de correction (retouche 2026-08-21 après essai
// sur appareil réel) : posé sur UNE carte du lecteur, aux dimensions exactes
// de sa boîte. Deux cibles centrées — « Corriger » (primaire) et « Fermer »
// (icône + libellé). Un appui sur le voile lui-même le retire, et le voile se
// retire aussi tout seul après un court délai d'inactivité.
//
// ⚠️ Le voile MASQUE le texte de la carte. C'est le défaut connu de cette
// variante, accepté à l'arbitrage : au moment où on appuie, on a déjà lu la
// ligne — c'est justement pour ça qu'on appuie. C'est aussi POURQUOI le délai
// de fermeture automatique (ci-dessous) est court : un voile posé par erreur
// cache l'instruction qu'on est en train de tricoter, il ne doit pas traîner.
//
// ⚠️ Tant qu'il est là, il intercepte les appuis : ni la case à cocher ni les
// abréviations de CETTE carte ne sont atteignables. Voulu — un appui sur le
// voile le retire et rend la carte à ses gestes.
//
// ⚠️ `.stop` sur le `@click` du `<div class="rfix">` lui-même, comme sur ses
// deux boutons : le voile est monté DANS une carte qui porte désormais son
// propre `@click="onCardTap(...)"` (ReaderView.vue). Sans `.stop`, un clic sur
// le fond du voile émettrait bien `close` — mais remonterait ensuite au
// gestionnaire de la carte, dans le MÊME cycle synchrone du même clic, qui
// réarmerait `fixTarget.value = step.id` juste après que `close` l'ait mis à
// `null`. Le voile resterait affiché malgré le clic qui devait le retirer.
// Un composant qui émet sur un clic et laisse ce même clic remonter à son
// parent produit précisément cette classe de bug : le voile doit consommer
// son propre geste, exactement comme ses deux boutons le font déjà.
//
// Retour d'essai réel (Nexus 7, 600 px CSS de large en portrait, 2026-08-21) :
// 44 px ne vaut que 7,0 mm au doigt — le plancher absolu, pas le confort — et
// le déclenchement accidentel de « Corriger » est arrivé plus d'une fois.
// Deux ajustements : les DEUX boutons passent à 56 px (8,9 mm), et « Fermer »
// porte désormais son libellé (`t('common.close')`) en plus de l'icône —
// cible élargie, ET nom accessible porté par le texte visible plutôt que par
// un `aria-label` qui le doublerait (WCAG 2.5.3, Label in Name). L'icône reste
// décorative : `AppIcon` sans `label` ne pose ni `role="img"` ni texte.
// « Corriger » garde `min-width: 112px` ; « Fermer » n'a AUCUNE largeur
// minimale imposée, son texte la fixe — rien à mesurer ni à tenir dessus.
//
// Fermeture automatique après inactivité (arbitrage : 3 secondes) : le
// composant est monté et démonté à chaque changement de cible
// (`v-if="fixTarget === step.id"` dans ReaderView.vue), donc le minuteur posé
// dans `onMounted` se réinitialise naturellement quand le voile se déplace
// sur une autre carte — aucune logique de remise à zéro à écrire ici. Un
// appui sur « Corriger » démonte aussi le composant (le parent navigue), ce
// qui annule le minuteur par le même chemin.
//
// ⚠️ WCAG 2.2.1 (Timing Adjustable) — round de correction 1 : une fermeture
// programmée qui retire le focus SOUS la personne qui navigue au clavier ou
// au lecteur d'écran (TalkBack) est un accroc à la norme, d'autant plus visible
// que ce fichier invoque déjà WCAG 2.5.3 plus haut. Le `@focusin` sur `.rfix`
// annule DÉFINITIVEMENT le minuteur dès qu'un élément du voile prend le focus
// (`cancelAutoClose`, pas un report à plus tard) : une fois qu'on navigue au
// clavier dans ce voile, c'est à la personne — et à elle SEULE — de décider
// quand il se ferme, la norme ne laisse pas d'autre lecture.
// Le geste au doigt n'est PAS concerné par ce risque : un appui sur un bouton
// déclenche `fix` ou `close` et démonte le voile dans le même geste, un appui
// sur le fond le ferme aussi — dans les deux cas, on AGIT, on ne se contente
// pas de prendre le focus sans rien faire. Le clavier (Tab) et TalkBack (swipe
// pour explorer), eux, posent le focus sans agir : c'est cette navigation-là
// que la fermeture à 3 s pourrait couper sous les pieds sans l'annulation.
import { onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/AppIcon.vue'

// Nommé plutôt qu'un nombre nu dans l'appel : c'est le délai arbitré, pas une
// valeur de réglage fin.
const AUTO_CLOSE_MS = 3000

const { t } = useI18n()
const emit = defineEmits(['fix', 'close'])

let autoCloseTimer = null
onMounted(() => {
  autoCloseTimer = setTimeout(() => emit('close'), AUTO_CLOSE_MS)
})
onBeforeUnmount(() => {
  // Sans ça, un composant déjà démonté émettrait dans le vide et le minuteur
  // fuirait (il continuerait de courir pour rien, ou pire, réarmerait un état
  // qui n'a plus de sens une fois la carte cible changée).
  clearTimeout(autoCloseTimer)
})
// `null` après annulation : sert de preuve testable (aucun minuteur ne
// traîne) et rend un second `focusin` (on peut retabuler entre les deux
// boutons) sans effet, plutôt que de rappeler `clearTimeout` sur une
// référence déjà périmée.
function cancelAutoClose() {
  clearTimeout(autoCloseTimer)
  autoCloseTimer = null
}
</script>

<template>
  <div class="rfix" @click.stop="$emit('close')" @focusin="cancelAutoClose">
    <!-- `.stop` sur les deux boutons : sans lui, leur clic remonterait au voile
         et déclencherait `close` par-dessus l'action demandée. -->
    <button type="button" class="rfix__do" @click.stop="$emit('fix')">
      {{ t('reader.fixHere') }}
    </button>
    <button type="button" class="rfix__close" @click.stop="$emit('close')">
      <AppIcon name="close" :size="20" />
      {{ t('common.close') }}
    </button>
  </div>
</template>

<style scoped>
/* Position absolue DANS la boîte de la carte (qui porte `position: relative`) :
   la carte garde sa hauteur, les cartes voisines gardent leur place au pixel
   près. C'est la contrainte posée à l'arbitrage, et c'est elle qui a écarté le
   bouton posé sous la carte. */
.rfix {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-3);
  border-radius: inherit;
  /* Dérivé de la surface du thème : le voile suit le clair et le sombre sans
     second jeu de valeurs à tenir à jour. */
  background: color-mix(in srgb, var(--surface) 82%, transparent);
}
.rfix__do {
  min-height: 56px;
  min-width: 112px;
  padding: 0 var(--sp-4);
  border: 0;
  border-radius: var(--r-sm);
  background: var(--brand-grad);
  color: var(--on-accent);
  font: inherit;
  font-weight: 700;
  box-shadow: var(--e-1);
  cursor: pointer;
}
.rfix__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  min-height: 56px;
  padding: 0 var(--sp-4);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  cursor: pointer;
}
</style>
