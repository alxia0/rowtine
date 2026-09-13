<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AppHeader from '@/components/AppHeader.vue'
import { resolvePrivacyPolicy } from '@/content/privacy-policy'
import { withAppName } from '@/utils/app-name-token'

const { t, locale } = useI18n()

// Langue : suit la locale de l'app, avec repli (src/content/privacy-policy.js) — même
// mécanisme que le guide utilisateur, sans bandeau de repli visible ici (cf.
// commentaire de tête de ce module pour la raison : contrairement au guide, cette politique
// naît directement avec ses quatre langues, le repli n'a jamais eu d'occasion réelle de
// servir).
const policy = computed(() => resolvePrivacyPolicy(locale.value))

// Le contenu porte le marqueur `{app}`, pas le nom en clair : substitué
// ici, à l'affichage, depuis la même source unique que le reste de l'écran (`app.name`).
function text(block) {
  return withAppName(block.text, t('app.name'))
}
</script>

<template>
<div>
  <AppHeader :title="t('about.privacy')" back />
  <main class="screen">
    <section class="block">
      <!-- `<template v-for>` et non `<div v-for>` : un `<div>` par bloc rendait CHAQUE `<h2>`
           premier enfant de SON PROPRE conteneur, donc `.block__title:first-child`
           s'appliquait à TOUS les titres au lieu du seul premier — mesuré en revue (02/08) :
           margin-top: 0px partout, sections collées au paragraphe précédent. Avec
           `<template>`, les `<h2>`/`<p>` sont des enfants DIRECTS de `.block` : `:first-child`
           redevient un vrai « premier élément de la section ». -->
      <template v-for="(block, i) in policy.blocks" :key="i">
        <h2 v-if="block.type === 'h2'" class="block__title">{{ text(block) }}</h2>
        <p v-else class="paragraph">{{ text(block) }}</p>
      </template>
      <p class="updated">{{ t('about.privacyUpdated', { date: policy.updated }) }}</p>
    </section>
  </main>
</div>
</template>

<style scoped>
.block {
  background: var(--tile);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: var(--sp-4);
  margin-bottom: var(--sp-4);
  box-shadow: var(--clay-sm);
}
.block__title {
  font-size: 16px;
  margin-top: var(--sp-4);
  margin-bottom: var(--sp-2);
}
.block__title:first-child {
  margin-top: 0;
}
.paragraph {
  font-size: 14.5px;
  line-height: 1.5;
  color: var(--ink);
  margin-bottom: var(--sp-2);
}
.updated {
  margin-top: var(--sp-4);
  padding-top: var(--sp-3);
  border-top: 1px solid var(--line-soft);
  color: var(--ink-55);
  font-size: 12.5px;
}
</style>
