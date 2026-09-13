<!--
  Animation d'attente pendant l'analyse d'un fichier importé — vient S'AJOUTER à la barre de
  progression d'ImportProgress.vue, elle ne remplace rien : avant la barre de progression,
  cet écran affichait une icône horloge et du texte, jamais de rond qui tourne (aucun spinner
  n'existe nulle part dans l'app, vérifié par un balayage de src/ — affirmation contraire
  corrigée après revue, elle recopiait sans vérifier une note antérieure).
  Même langage de trait maison que EmptyStateArt.vue et le registre d'icônes (src/utils/icons.js) :
  fill=none, stroke=currentColor, épaisseur 1,7, bouts et jointures arrondis. Volontairement
  sobre : pas de personnage, pas de visage — la même pelote et le même fil que EmptyStateArt,
  seule matière retenue pour la future mascotte, plus l'outil de la technique en cours.

  Épaisseur de trait COMPENSÉE, pas fixe : `stroke-width` est calculé (voir `strokeWidth`
  ci-dessous) pour que l'épaisseur RENDUE reste ~1,36 px quelle que soit `size` — celle du
  rendu par défaut (96 px, viewBox 120 → 1,7 × 96/120), la valeur que ce commentaire revendique
  partager avec EmptyStateArt/le registre d'icônes. Sans cette compensation, un appelant qui
  choisit une taille plus petite (ex. ImportProgress.vue à 56 px) obtient un trait ~42 % plus
  fin que celui-ci — défaut réel trouvé en revue (les travaux de finitions UX), pas théorique :
  mesuré sur le rendu (0,79 px à 56 px contre 1,36 px à 96 px avant correctif).

  Deux variantes RÉELLEMENT différentes (pas juste une classe CSS qui ne changerait rien au
  rendu) :
  - tricot (data-tool="needles") : deux aiguilles qui se CROISENT en X (géométrie de repos non
    parallèle — corrigé après un retour d'usage : les deux segments d'origine étaient
    PARALLÈLES entre eux malgré le commentaire qui les disait « croisées », et l'ancienne
    animation les faisait translater ensemble dans la même direction, ce qui ne ressemblait à
    rien de connu). Chaque aiguille pivote maintenant sur SON PROPRE point de pivot (son
    manche, à l'opposé de sa pointe), en rotation OPPOSÉE à l'autre et de faible amplitude :
    les deux pointes se rapprochent (se croisent davantage) puis s'écartent (se décroisent),
    comme le geste réel où la pointe de l'aiguille droite vient piquer la maille portée par
    l'aiguille gauche.
  - crochet (data-tool="hook") : une tige DROITE (rectiligne — plus la courbe sur toute la
    longueur d'avant : même correctif, un retour d'usage a signalé que le crochet ne
    ressemblait pas assez à un vrai crochet, courbé au lieu d'être droit) terminée par un
    petit bec recourbé (une encoche courte en forme de hameçon, volontairement OUVERTE —
    jamais refermée en boucle complète, pour ne pas se lire comme un œil, piège déjà signalé
    sur ce dessin). La tige pivote légèrement autour du manche comme un geste de crochet,
    avec une maille qui se referme à son bec.
  Dans les deux cas, la pelote et le fil qui se déroule restent identiques.

  Décoratif : aria-hidden sur le <svg>, aucun texte — le composant appelant porte déjà
  l'annonce de progression (cf. ImportProgress.vue).

  prefers-reduced-motion : le dessin se FIGE sur sa pose de repos (l'état 0 % de chaque
  keyframe — aiguilles/crochet au repos, point/maille pleins), il ne disparaît pas — même
  logique que NavProgress.vue (override local en `animation: none`, ne pas compter sur le
  raccourcissement global de tokens.css qui laisserait l'animation tourner en boucle très
  vite au lieu de s'arrêter). Spécificité des sélecteurs alignée avec les règles d'animation
  ci-dessous : voir le commentaire dans <style>.
-->
<script setup>
import { computed } from 'vue'

const props = defineProps({
  // 'knitting' | 'crochet' — toute autre valeur (technique inconnue, absente) retombe
  // sur le tricot, jamais sur un rendu vide.
  technique: { type: String, default: 'knitting' },
  size: { type: Number, default: 96 },
})

const isCrochet = computed(() => props.technique === 'crochet')
// 96 px = la taille par défaut de CE composant, celle du rendu documenté ci-dessus
// (~1,36 px de trait rendu). `stroke-width` est recalculé pour toute autre `size` afin de
// PRÉSERVER cette même épaisseur rendue (au lieu de la laisser varier avec la taille, ce que
// ferait un stroke-width fixe via le simple redimensionnement du viewBox).
const strokeWidth = computed(() => (1.7 * 96) / props.size)
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 120 120"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="knitting-loader"
    :class="isCrochet ? 'knitting-loader--crochet' : 'knitting-loader--knitting'"
    aria-hidden="true"
    focusable="false"
  >
    <!-- la pelote (identique aux deux variantes) -->
    <g class="knitting-loader__ball">
      <circle cx="40" cy="82" r="20" />
      <path d="M24 74c7 4 21 10 28 14" />
      <path d="M29 64c4 10 15 24 20 31" />
      <path d="M53 70c-7 8-21 18-27 24" />
    </g>
    <!-- le fil qui se déroule vers l'outil -->
    <path class="knitting-loader__thread" d="M56 66c8-3 14-8 18-15" />

    <g v-if="!isCrochet" data-tool="needles" class="knitting-loader__tool">
      <!-- aiguille gauche : manche en bas-gauche (53,96), pointe en haut-droite (100,44) —
           pivote sur son propre manche, indépendamment de l'autre aiguille. Angle ASYMÉTRIQUE
           avec l'aiguille droite (pas un miroir) et croisement aux ~3/4 de la hauteur des deux
           tiges (vers la pointe, pas au milieu) — corrigé en revue : une pose à 85°
           parfaitement symétrique se lisait comme le glyphe universel « fermer/erreur », pas
           comme des aiguilles. -->
      <line class="knitting-loader__needle-a" x1="53" y1="96" x2="100" y2="44" />
      <!-- aiguille droite : manche en bas-droite (84,102), pointe en haut-gauche (90,37) —
           les deux segments se CROISENT réellement (pas parallèles, et pas au même angle que
           l'aiguille gauche) dans leur pose de repos -->
      <line class="knitting-loader__needle-b" x1="84" y1="102" x2="90" y2="37" />
      <!-- le point qui se forme entre les deux, décalé SOUS le croisement (pas dessus : posé
           juste sur les tiges, un petit arc plein se lisait comme un nœud/boucle en plus de
           la croix, corrigé en revue par un rendu réel à 56 px) -->
      <path class="knitting-loader__stitch" d="M78 62c2 4 6 6 10 5" />
    </g>
    <g v-else data-tool="hook" class="knitting-loader__tool knitting-loader__hook">
      <!-- manche + tige DROITE (rectiligne, pas de courbe sur la longueur) -->
      <path d="M60 98L97 57" />
      <!-- le bec : UNE SEULE courbe (un seul "c"), volontairement OUVERTE — l'écart entre le
           point de départ (bout de la tige) et le point d'arrivée doit rester GRAND devant
           l'épaisseur de trait RENDUE, pas juste mathématiquement non nul : une première
           version (écart ~7,6 unités) ne se refermait pas sur le papier, mais à 56 px, avec
           l'épaisseur compensée et les bouts arrondis, cet écart disparaissait à l'œil — elle
           se lisait comme un « p » minuscule, un anneau quasi fermé (retour de relecture du
           31/07, vérifié sur un rendu réel, pas sur la seule absence de courbe sur la tige).
           Écart actuel ~14,9 unités, protégé par un test (knitting-loader.spec.js) qui compare
           cet écart à l'épaisseur de trait réellement rendue à 56 px. -->
      <path d="M97 57c9 0 11 7 5 14" />
      <!-- la maille qui se referme au bec, décalée BIEN À L'ÉCART du bec (pas juste hors de la
           tige) — un premier repositionnement trop proche du bec recréait, avec le bec, un
           groupement qui se lisait comme un « 3 » ou un « 8 » ; déplacée plus bas, sous le bec
           et sous la tige, avec une marge vérifiée sur un rendu réel à 56 px -->
      <path class="knitting-loader__stitch" d="M96 78c4-2 9-1 10 3c1 4-3 7-7 6" />
    </g>
  </svg>
</template>

<style scoped>
.knitting-loader {
  display: block;
  color: var(--ink-55);
}

/* Tricot : les deux aiguilles pivotent chacune sur SON PROPRE manche, en rotation OPPOSÉE
   l'une de l'autre et de faible amplitude — leurs pointes se rapprochent (se croisent
   davantage) puis s'écartent (se décroisent), comme le geste réel de piquer une maille.
   Remplace l'ancienne translation parallèle des deux aiguilles (retour d'usage :
   « elles pourraient plutôt se croiser et décroiser comme le geste qu'on fait en tricotant »). */
.knitting-loader--knitting .knitting-loader__needle-a {
  transform-origin: 53px 96px;
  animation: knitting-needle-a 1.6s ease-in-out infinite;
}
.knitting-loader--knitting .knitting-loader__needle-b {
  transform-origin: 84px 102px;
  animation: knitting-needle-b 1.6s ease-in-out infinite;
}
.knitting-loader--knitting .knitting-loader__stitch {
  transform-origin: 83px 65px;
  animation: knitting-stitch 1.6s ease-in-out infinite;
}
@keyframes knitting-needle-a {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(-6deg); }
}
@keyframes knitting-needle-b {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(6deg); }
}
@keyframes knitting-stitch {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(0.82); }
}

/* Crochet : le crochet pivote sur le manche, la maille se referme à son rythme. */
.knitting-loader--crochet .knitting-loader__hook {
  transform-origin: 62px 97px;
  animation: crochet-hook 1.4s ease-in-out infinite;
}
.knitting-loader--crochet .knitting-loader__stitch {
  transform-origin: 101px 82px;
  animation: crochet-stitch 1.4s ease-in-out infinite;
}
@keyframes crochet-hook {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(-9deg); }
}
@keyframes crochet-stitch {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(0.78); }
}

/* Le fil respire doucement dans les deux variantes. */
.knitting-loader__thread {
  animation: knitting-thread 1.6s ease-in-out infinite;
  transform-origin: 56px 66px;
}
@keyframes knitting-thread {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

/* Le dessin se FIGE sur sa pose de repos (celle du 0 %) — il ne disparaît pas.
   Spécificité alignée sur les règles d'animation ci-dessus (.knitting-loader--knitting/
   --crochet .knitting-loader__xxx, deux classes) : un sélecteur à une seule classe ici
   perdrait face à elles et laisserait tokens.css (animation-duration: 0.001ms) faire
   tourner la boucle en accéléré au lieu de l'arrêter.

   ⚠️ CE QUI FAIT VRAIMENT FONCTIONNER CE GEL, ET POURQUOI C'EST FRAGILE : la règle globale
   de tokens.css porte `animation-duration: 0.001ms !important`, qui bat N'IMPORTE QUELLE
   spécificité (un !important gagne toujours face à un non-!important, quel que soit le
   sélecteur). Ce n'est PAS notre spécificité qui neutralise cette règle globale — c'est que
   le raccourci `animation: none` ci-dessous fixe `animation-name: none`, une propriété que
   tokens.css ne touche pas du tout. Si `animation: none` est un jour remplacé ici par
   `animation-duration: 0s` ou par `animation-play-state: paused`, le gel disparaît EN
   SILENCE (la boucle se remet à tourner, très vite, au lieu de se figer) : jsdom n'évalue
   pas les media queries, donc AUCUN test de ce dépôt ne le détecterait. Toujours vérifier
   au navigateur réel (`getComputedStyle(el).animationName === 'none'` sous
   `prefers-reduced-motion: reduce`) avant de toucher à cette règle. */
@media (prefers-reduced-motion: reduce) {
  .knitting-loader .knitting-loader__needle-a,
  .knitting-loader .knitting-loader__needle-b,
  .knitting-loader .knitting-loader__hook,
  .knitting-loader .knitting-loader__stitch,
  .knitting-loader .knitting-loader__thread {
    animation: none;
  }
}
</style>
