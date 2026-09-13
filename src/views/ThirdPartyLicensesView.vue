<script setup>
import { useI18n } from 'vue-i18n'
import AppHeader from '@/components/AppHeader.vue'
import AppIcon from '@/components/AppIcon.vue'
import BackToTop from '@/components/BackToTop.vue'
// Généré (src/generated/third-party-licenses.json) depuis les dépendances de production
// réellement installées — cf. scripts/gen-third-party-licenses.mjs.
// NE PAS ÉDITER À LA MAIN : `yarn licenses:gen` (mode écriture) le régénère ; le hook
// `prebuild` de package.json vérifie seulement qu'il est à jour (`--check`) et fait ÉCHOUER
// le build sinon, sans jamais l'écraser tout seul (revue du 02/08 : un `yarn build`
// silencieux ne doit pas salir un fichier suivi par git pendant qu'une autre session
// travaille sur le même dépôt).
import licenses from '@/generated/third-party-licenses.json'

const { t } = useI18n()
</script>

<template>
<div>
  <AppHeader :title="t('about.licenses')" back />
  <main class="screen">
    <p class="intro">{{ t('about.licensesIntro', { app: t('app.name') }) }}</p>

    <!-- <details>/<summary> natifs : accessibles et pliés par défaut sans code JS ni
         composant maison — adapté à une liste de 211 entrées (mesure du 02/08) qu'une
         utilisatrice ne consultera quasiment jamais en entier. -->
    <details v-for="pkg in licenses" :key="`${pkg.name}@${pkg.version}`" class="pkg">
      <summary class="pkg__summary">
        <span class="pkg__name">{{ pkg.name }}</span>
        <span class="pkg__meta">{{ pkg.version }} · {{ pkg.license }}</span>
        <!-- Affordance de dépli (revue du 02/08) : `display: flex` sur <summary> masque le
             triangle natif sans rien mettre à sa place — rien n'indiquait qu'un appui
             dépliait la ligne. Motif copié de CorrectionHelp.vue (`.help__chevron`), même
             icône, même rotation à l'ouverture. -->
        <AppIcon name="chevronDown" :size="16" class="pkg__chevron" />
      </summary>
      <a v-if="pkg.repository" class="pkg__repo" :href="pkg.repository" target="_blank" rel="noopener">
        {{ t('about.licensesRepository') }}
      </a>
      <pre class="pkg__text">{{ pkg.licenseText }}</pre>
    </details>
  </main>
  <!-- Écran à défilement de page (document) : pas de cible, même câblage que les autres
       écrans longs (stock, fiche patron, fiche projet, dépenses, guide). Revue du
       02/08 : 211 blocs dépliables, 484 Ko de texte dans le DOM — seul écran long
       du projet qui en était encore dépourvu. -->
  <BackToTop />
</div>
</template>

<style scoped>
.intro {
  font-size: 14.5px;
  line-height: 1.5;
  color: var(--ink);
  margin-bottom: var(--sp-4);
}
.pkg {
  background: var(--tile);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  margin-bottom: var(--sp-2);
  padding: var(--sp-1) var(--sp-3);
}
.pkg__summary {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  padding: var(--sp-2) 0;
  cursor: pointer;
  font-weight: 600;
  color: var(--ink);
  list-style: none;
}
.pkg__summary::-webkit-details-marker {
  display: none;
}
.pkg__name {
  flex: 1;
}
.pkg__chevron {
  align-self: center;
  flex-shrink: 0;
  color: var(--ink-55);
  transition: transform var(--motion-base, 0.15s);
}
.pkg[open] .pkg__chevron {
  transform: rotate(180deg);
}
.pkg__meta {
  flex-shrink: 0;
  color: var(--ink-55);
  font-weight: 400;
  font-size: 12.5px;
}
.pkg__repo {
  display: inline-block;
  color: var(--brand-deep);
  font-weight: 600;
  font-size: 13px;
  margin-bottom: var(--sp-2);
}
.pkg__text {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink-55);
  background: var(--bg);
  border-radius: var(--r-sm);
  padding: var(--sp-2);
  margin: 0 0 var(--sp-2);
  max-height: 260px;
  overflow-y: auto;
}
</style>
