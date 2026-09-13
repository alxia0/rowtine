<script setup>
// Rend un tableau de portions {text, bold, italic} produit par
// src/content/guide/parse-guide-markdown.js — jamais de `v-html` (le texte a beau être
// écrit par nous, pas une entrée utilisateur, la conversion en blocs typés à la génération
// existe justement pour ne pas avoir à en injecter). Réutilisé par GuideView.vue et
// GuideListItem.vue : paragraphes, titres, légendes d'image, cellules de tableau et items de
// liste partagent tous la même mise en forme en ligne (gras/italique).
import { useI18n } from 'vue-i18n'
import { withAppName } from '@/utils/app-name-token'

defineProps({
  spans: { type: Array, required: true },
})

const { t } = useI18n()

// Le marqueur `{app}` (piège n°6 du plan : le nom de l'app n'est pas définitif) est préservé
// tel quel par le parseur — substitué ici, à l'affichage, comme partout ailleurs dans les
// contenus longs (privacy-policy.fr.js, release-notes.fr.js).
function text(span) {
  return withAppName(span.text, t('app.name'))
}
</script>

<template>
  <template v-for="(span, i) in spans" :key="i">
    <strong v-if="span.bold">{{ text(span) }}</strong>
    <em v-else-if="span.italic">{{ text(span) }}</em>
    <template v-else>{{ text(span) }}</template>
  </template>
</template>
