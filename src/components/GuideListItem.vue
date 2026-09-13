<script setup>
// Un item de liste du guide, avec sa sous-liste éventuelle (le guide imbrique jusqu'à 2
// niveaux — cf. parse-guide-markdown.js). Composant RÉCURSIF : Vue résout automatiquement
// `<GuideListItem>` dans son propre template via le nom de fichier du composant monofichier,
// aucun enregistrement explicite n'est nécessaire.
import GuideSpans from '@/components/GuideSpans.vue'

defineProps({
  // { spans, children: {ordered, items} | null }
  item: { type: Object, required: true },
})
</script>

<template>
  <li class="gli">
    <GuideSpans :spans="item.spans" />
    <component :is="item.children.ordered ? 'ol' : 'ul'" v-if="item.children" class="gli__nested">
      <GuideListItem v-for="(child, i) in item.children.items" :key="i" :item="child" />
    </component>
  </li>
</template>

<style scoped>
.gli {
  margin-bottom: var(--sp-2);
}
.gli__nested {
  margin-top: var(--sp-1);
  padding-left: 1.1em;
}
</style>
