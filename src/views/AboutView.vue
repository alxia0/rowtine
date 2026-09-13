<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AppHeader from '@/components/AppHeader.vue'
import { APP_VERSION, APP_BUILD, APP_CREATOR } from '@/constants/app-info'
import { CONTACT_EMAIL, websiteUrlFor } from '@/constants/app-links'
import { resolveReleaseNotes } from '@/content/release-notes'
import { withAppName } from '@/utils/app-name-token'

const { t, locale } = useI18n()

// Langue : suit la locale de l'app, avec repli (src/content/release-notes.js) — même
// mécanisme que la politique de confidentialité (PrivacyPolicyView.vue) et le
// guide utilisateur. Revue du 02/08 : avant ce correctif, ce
// journal se rendait en français sans condition aux quatre langues, seul contenu long du
// chantier sans résolveur ni traduction.
const releaseNotes = computed(() => resolveReleaseNotes(locale.value))

// Adresse du SITE pour la langue ACTIVE de l'interface (le site suit la langue de l'app,
// 12/08/2026) — même mécanisme que `guideOnSiteUrl` de GuideView.vue :
// `websiteUrlFor` gère elle-même le repli sur l'anglais si la locale est inconnue, donc ne
// rend jamais une adresse vide.
const websiteUrl = computed(() => websiteUrlFor(locale.value))

// Le journal des nouveautés porte le marqueur `{app}`, pas le nom en clair : substitué
// ici, à l'affichage, depuis la même source unique (`app.name`) — même
// mécanisme que PrivacyPolicyView.vue.
function note(text) {
  return withAppName(text, t('app.name'))
}
</script>

<template>
<div>
  <!-- Pas de `back` : À propos est une destination du burger au même titre qu'Accueil/Stock/
       Bibliothèque/Réglages (AppHeader.vue, tableau `items`), pas un écran de détail atteint
       en creusant depuis un autre écran (contrairement à ses propres sous-écrans, Politique
       de confidentialité et Licences, qui EUX gardent `back`). -->
  <AppHeader :title="t('about.title')" />
  <main class="screen">
    <section class="hero">
      <!-- Le LOGO de l'app, pas une icône du registre (retour d'usage, 09/08) : depuis que le
           hérisson est devenu l'icône du lanceur, l'écran qui présente l'app doit montrer la
           même chose que la tuile posée sur l'écran d'accueil du téléphone. Image statique
           dans public/ (comme /demo et /patterns) et non dans le registre `AppIcon` : celui-ci
           ne porte que des pictogrammes d'interface monochromes, redessinables au trait — un
           rendu 3D en couleurs n'y a pas sa place.
           `alt` vide + aria-hidden : le nom de l'app est juste en dessous en toutes lettres,
           un lecteur d'écran le dirait deux fois. -->
      <img
        class="hero__logo"
        src="/logo/rowtine-192.webp"
        alt=""
        aria-hidden="true"
        width="64"
        height="64"
        data-test="about-logo"
      />
      <!-- Nom de l'app : JAMAIS en dur ici (120 occurrences déjà ailleurs dans src/, un
           renommage est un chantier à part) — lu depuis la même clé
           i18n `app.name` que l'onboarding (OnboardingView.vue), seule source qui existait
           déjà avant cet écran. -->
      <h2 class="hero__name">{{ t('app.name') }}</h2>
      <p class="hero__version" data-test="about-version">
        {{ t('about.version', { version: APP_VERSION, build: APP_BUILD }) }}
      </p>
      <p class="hero__creator">{{ t('about.creator', { name: APP_CREATOR }) }}</p>
    </section>

    <section class="block">
      <router-link class="link-row" data-test="about-link-privacy" :to="{ name: 'about-privacy' }">
        {{ t('about.privacy') }}
      </router-link>
      <router-link class="link-row" data-test="about-link-licenses" :to="{ name: 'about-licenses' }">
        {{ t('about.licenses') }}
      </router-link>
      <!-- « Nous contacter » reste gardée par `v-if` (src/constants/app-links.js) : une
           utilisatrice ne doit jamais voir la rangée sans adresse derrière. `CONTACT_EMAIL`
           est une constante plate qui POURRAIT redevenir vide, la garde reste donc utile.
           « Site web » N'A PLUS ce garde depuis le 12/08/2026 : son adresse est désormais
           calculée par `websiteUrlFor(locale)`, qui retombe toujours sur l'anglais et ne peut
           donc plus rendre de valeur vide — un `v-if` sur une fonction qui rend toujours une
           adresse ne protège plus rien (même constat que la rangée du guide en ligne de
           GuideView.vue, jamais gardée par `v-if` pour la même raison).
           tests/unit/app-links-todo.spec.js gardait un rappel actif tant que l'une des deux
           valeurs manquait (`it.fails`, rapporté comme réussi tant que la valeur restait
           vide) ; les deux sont désormais de vraies vérifications de format. -->
      <!-- « Nous contacter » RESTE le client mail (décision produit, après un aller-retour).
           Le lien avait été basculé vers les tickets GitHub le matin même ;
           MESURÉ SUR APPAREIL dans la foulée : sur un téléphone où l'app GitHub est installée,
           elle intercepte le lien et affiche « Sign in to GitHub.com » — et le navigateur donne
           la même page. `curl` recevait pourtant la page publique en 200 : la vérification en
           ligne de commande ne voyait pas ce que voit l'appareil.
           C'est exactement le défaut reproché à l'adresse Gitea de la veille. Une tricoteuse qui
           ne code pas doit garder une porte qui ne demande pas de compte : c'est celle-ci.
           Le dépôt vit désormais sous « Suggérer une amélioration » (Réglages → Contribuer), qui
           s'adresse à quelqu'un de susceptible d'avoir un compte.
           `v-if` : si l'adresse redevenait vide, mieux vaut aucune rangée qu'un brouillon sans
           destinataire. -->
      <a v-if="CONTACT_EMAIL" class="link-row" data-test="about-link-contact" :href="`mailto:${CONTACT_EMAIL}`">
        {{ t('about.contact') }}
      </a>
      <a
        class="link-row"
        data-test="about-link-website"
        :href="websiteUrl"
        target="_blank"
        rel="noopener"
      >
        {{ t('about.website', { app: t('app.name') }) }}
      </a>
    </section>

    <section class="block">
      <h2 class="block__title">{{ t('about.dataTitle') }}</h2>
      <ul class="data-list">
        <li>{{ t('about.dataPoint1') }}</li>
        <li>{{ t('about.dataPoint2', { app: t('app.name') }) }}</li>
        <li>{{ t('about.dataPoint3') }}</li>
        <li>{{ t('about.dataPoint4') }}</li>
      </ul>
    </section>

    <section class="block">
      <h2 class="block__title">{{ t('about.changelogTitle') }}</h2>
      <div v-for="entry in releaseNotes.notes" :key="entry.version" class="release">
        <p class="release__version">{{ entry.version }}</p>
        <ul>
          <li v-for="(entryNote, i) in entry.notes" :key="i">{{ note(entryNote) }}</li>
        </ul>
      </div>
    </section>
  </main>
</div>
</template>

<style scoped>
.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--sp-1);
  padding: var(--sp-4) 0 var(--sp-5);
  color: var(--ink);
}
/* 64 px affichés pour une image de 192 px : exactement 3x, la densité la plus élevée qu'on
   rencontre (Pixel 7 = 2,625x). L'arrondi de la tuile est DANS l'image (canal alpha), pas en
   CSS : le logo doit être identique à l'icône du lanceur, arrondi compris. */
.hero__logo {
  display: block;
  width: 64px;
  height: 64px;
}
.hero__name {
  font-size: 20px;
  margin-top: var(--sp-1);
}
.hero__version,
.hero__creator {
  color: var(--ink-55);
  font-size: 13.5px;
}
.block {
  background: var(--tile);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: var(--sp-4);
  margin-bottom: var(--sp-4);
  box-shadow: var(--clay-sm);
}
.block__title {
  font-size: 17px;
  margin-bottom: var(--sp-3);
}
.link-row {
  display: block;
  width: 100%;
  border: none;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  padding: 11px 0;
  color: var(--brand-deep);
  font-weight: 600;
  text-decoration: none;
  border-bottom: 1px solid var(--line-soft);
}
.link-row:last-child {
  border-bottom: none;
}
.data-list {
  margin: 0;
  padding-left: 1.1em;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  color: var(--ink);
  font-size: 14.5px;
}
.release + .release {
  margin-top: var(--sp-3);
  padding-top: var(--sp-3);
  border-top: 1px solid var(--line-soft);
}
.release__version {
  font-weight: 700;
  margin-bottom: var(--sp-1);
}
</style>
