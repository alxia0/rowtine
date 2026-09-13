<!--
  Illustration + mise en page PROVISOIRES de tout écran vide de l'app — remplacées par la
  mascotte. Point de remplacement
  UNIQUE : ce fichier porte à la fois le dessin ET la mise en page (conteneur, texte, indice
  secondaire optionnel) — voir « pourquoi » ci-dessous.

  « Grande pelote + brin qui s'échappe », dans le langage de trait maison de l'app
  (fill=none, stroke=currentColor, épaisseur 1,7, bouts arrondis — cf. src/utils/icons.js,
  icône `pelote`). Volontairement sobre : pas de personnage, pas d'yeux, pas de visage —
  juste la pelote et son fil, seule matière qu'on garde pour la vraie mascotte à venir.
  Décorative : aria-hidden, discrète (--ink-25), pas le héros de l'écran.

  Mise en page (correctif revue finale P2, 17/07) : StashView et StatsView dupliquaient
  CHACUN `.empty-state`/`.empty-state__text` dans leur <style scoped> — deux définitions
  livrées la même nuit avaient divergé (poids de texte, largeur de ligne) et les deux écrans
  vides ne se ressemblaient plus. La mise en page vit maintenant ICI, dans le seul composant
  qui porte déjà la responsabilité « à quoi ressemble un écran vide » — pas dans
  src/styles/tokens.css (qui est partagé par toute l'app et resterait, lui, à modifier
  séparément le jour où la mascotte arrive : ça disperserait la responsabilité que ce
  fichier est censé concentrer).

  API : slot par défaut = texte principal (obligatoire, dit quoi faire) ; slot `hint` =
  texte secondaire optionnel (ex. StatsView, qui distingue « constat » et « quoi faire »).
  Texte en poids NORMAL et `max-width: 32ch` (définition retenue : celle de StashView, la
  plus simple et la plus générale — le gras de StatsView ne hiérarchisait qu'un besoin
  propre à CET écran, pas une règle commune aux écrans vides).
-->
<script setup>
defineProps({
  size: { type: [Number, String], default: 120 },
})
</script>

<template>
  <div class="empty-state">
    <svg
      :width="size"
      :height="size"
      viewBox="0 0 120 120"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="empty-state__art"
      aria-hidden="true"
      focusable="false"
    >
      <!-- la pelote -->
      <circle cx="54" cy="72" r="28" />
      <path d="M34 62c10 6 30 14 40 20" />
      <path d="M40 50c6 14 22 34 28 44" />
      <path d="M72 58c-10 12-30 26-38 34" />
      <!-- le brin qui s'échappe, en spirale ouverte (pas de boucle fermée : pas d'œil) -->
      <path d="M76 50c10-8 20-6 24-16c3-7-2-14-10-12" />
    </svg>
    <p class="empty-state__text"><slot /></p>
    <p v-if="$slots.hint" class="empty-state__hint"><slot name="hint" /></p>
  </div>
</template>

<style scoped>
.empty-state { display: flex; flex-direction: column; align-items: center; text-align: center; gap: var(--sp-3); margin-top: var(--sp-6); padding: var(--sp-4); }
.empty-state__art { color: var(--ink-25); }
.empty-state__text { color: var(--ink-55); font-size: 14px; max-width: 32ch; }
.empty-state__hint { color: var(--ink-55); font-size: 13.5px; max-width: 32ch; }
</style>
