<script setup>
// Guide utilisateur, atteint
// depuis l'À propos. Le Markdown reste la source de vérité : ce composant ne
// fait que RENDRE les blocs déjà typés par parse-guide-markdown.js
// (src/generated/guide-content.<langue>.json), jamais de `v-html`.
//
// Sections repliables (<details>/<summary> natifs, même motif que
// ThirdPartyLicensesView.vue) : le guide fait ~800 lignes, une page d'un bloc serait
// pénible à lire au pouce sur téléphone. Un sommaire en haut ouvre directement la section
// visée et défile jusqu'à elle.
//
// Langue : le contenu suit la locale de l'app, avec repli (src/content/guide/index.js).
// Le guide a authentiquement connu une période où seul le français existait (avant
// les traductions des autres langues) — le bandeau de repli ci-dessous avertissait alors d'un repli
// RÉEL, jamais un écran muet sur ce point. Depuis ces traductions,
// les quatre langues sont couvertes : le repli n'a plus d'occasion de se produire en
// pratique, mais le mécanisme (et son bandeau) restent comme filet pour une 5e langue future
// — même mécanisme, même doctrine que src/content/privacy-policy.js.
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
import AppIcon from '@/components/AppIcon.vue'
import GuideSpans from '@/components/GuideSpans.vue'
import GuideListItem from '@/components/GuideListItem.vue'
import BackToTop from '@/components/BackToTop.vue'
import { resolveGuideContent } from '@/content/guide'
import { guideImagesFor } from '@/content/guide/images'
import { useEffectiveTheme } from '@/theme/useEffectiveTheme'
import { LANGUAGES } from '@/constants/languages'
import { withAppName } from '@/utils/app-name-token'
import { useLightboxStore } from '@/stores/lightbox'
import { guideUrlFor } from '@/constants/app-links'
import { measureStickyTopHeight, RESPIRATION_SOUS_BANDEAUX } from '@/utils/sticky-top'
// `scrollBehavior()` (et pas un `behavior: 'smooth'` en dur) : la règle CSS de `tokens.css`
// ne gouverne pas une valeur passée en argument JS, et un saut de section est l'affordance
// de navigation principale de cet écran. Le piège est documenté au long dans le module.
import { scrollBehavior } from '@/utils/scroll-behavior'
import { useStartTour } from '@/composables/useStartTour'

const { t, locale } = useI18n()
const { startTour } = useStartTour()

const guide = computed(() => resolveGuideContent(locale.value))
// Adresse du guide EN LIGNE (celui qui se télécharge, sur le site) pour la LANGUE ACTIVE de
// l'interface — pas forcément la même que `guide.value.lang`, qui peut retomber sur l'anglais
// si le contenu embarqué manque encore une traduction (cf. resolveGuideContent ci-dessus).
// Les deux restent volontairement indépendants : la page du site suit la langue demandée par
// l'utilisatrice, `guideUrlFor` gère elle-même le repli si cette langue n'existe pas côté site
// (12/08/2026).
const guideOnSiteUrl = computed(() => guideUrlFor(locale.value))
// Les captures suivent la langue du CONTENU affiché (pas forcément celle de l'app) : si le
// français s'affiche en repli, ses propres captures françaises l'accompagnent — cohérent
// avec des légendes qui décrivent cette langue-là. Dès qu'une nouvelle langue de
// guide est ajoutée, son propre jeu de captures (déjà généré) s'aligne automatiquement.
//
// Les captures suivent DEUX axes : la langue du CONTENU affiché (voir ci-dessus) et le thème
// RÉELLEMENT rendu. Sans le second, une utilisatrice en mode sombre lisait un guide illustré
// exclusivement d'écrans clairs.
const themeEffectif = useEffectiveTheme()
const images = computed(() => guideImagesFor(guide.value.lang, themeEffectif.value))

// Nom natif de la langue réellement affichée (« Français », pas « French ») : les libellés
// de LANGUAGES ne sont volontairement PAS des clés i18n (cf. constants/languages.js) — une
// germanophone doit reconnaître sa propre langue par son nom, pas l'inverse ici.
const fallbackLanguageLabel = computed(() => LANGUAGES.find((l) => l.code === guide.value.lang)?.label ?? guide.value.lang)

function appText(raw) {
  return withAppName(raw, t('app.name'))
}

// Un tableau du guide devient une liste de paires terme/description (<dl>), jamais une
// <table> HTML — illisible au pouce en colonnes larges sur téléphone. `header`/`rows` gardent
// TOUTES les colonnes (le parseur ne jette plus rien au-delà de 2 — revue du 02/08) : à 2
// colonnes, le rendu reste la paire term/desc d'origine ; au-delà, chaque cellule devient sa
// propre paire « libellé de colonne : valeur », regroupée par ligne — aucune colonne
// n'est perdue, quel que soit le nombre de colonnes du Markdown source.
function termsPairs(block) {
  if (block.header.length === 2) {
    return block.rows.map((row) => [{ term: row[0] ?? [], desc: row[1] ?? [] }])
  }
  return block.rows.map((row) => row.map((cell, i) => ({ term: block.header[i] ?? [], desc: cell })))
}

const detailsEls = {}
function registerDetails(id, el) {
  if (el) detailsEls[id] = el
}

// Rend VRAI si la section existait et qu'on a défilé jusqu'à elle, FAUX sinon — l'appelant
// `onMounted` en a besoin (voir plus bas : c'est lui qui doit alors poser la position
// d'arrivée, le routeur s'étant effacé). Le sommaire, lui, ignore cette valeur.
function openSection(id) {
  const el = detailsEls[id]
  if (!el) return false
  el.open = true
  // DÉGAGER LES BANDEAUX COLLANTS (correctif du 19/08/2026). `block: 'start'` cale le haut du
  // <details> sur le haut de la FENÊTRE, or AppHeader est `position: sticky; top: 0` et
  // OPAQUE (fond `--bg`) : sans marge, le titre de la section arrive exactement dessous,
  // invisible — l'utilisatrice verrait le corps d'une section dont le titre est masqué.
  // Mesuré : sans la ligne ci-dessous, le titre se pose à 1 px pour un bandeau haut de 76 px.
  // `scroll-margin-top` est le mécanisme natif prévu pour ça, et il est honoré par
  // `scrollIntoView` (ce qui n'est PAS le cas d'un décalage passé au routeur : son
  // `getElementPosition` ne fait que de l'arithmétique de rectangles).
  // Mesuré à chaque appel, jamais figé : la hauteur du bandeau dépend de la safe-area du haut
  // (encoche, orientation) — même raison et même mécanisme que keyboard-avoidance.js, dont
  // une constante « 76 » en dur avait déjà menti une fois (retour d'usage du 22/07).
  el.style.scrollMarginTop = `${measureStickyTopHeight() + RESPIRATION_SOUS_BANDEAUX}px`
  el.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
  return true
}

// OUVERTURE DIRECTE SUR UNE SECTION (19/08/2026) : `/guide?section=section-4`.
// L'avertissement d'import de la Bibliothèque et le bloc de réussite de l'écran d'import y
// mènent tous les deux, par leur bouton « Comment corriger ».
//
// PAS d'`await nextTick()` ici, contrairement à un premier réflexe (un raisonnement FAUX
// l'imposait au départ — corrigé après une mutation
// qui ne faisait rougir aucun test : voir tests/unit/guide-section-cible.spec.js). Vue
// GARANTIT que les refs de template sont déjà posées quand `onMounted` s'exécute (doc
// officielle Vue 3 : « refs are only guaranteed to hold the elements after the component has
// been mounted, hence in onMounted hooks the ref should already have a value ») — et
// `registerDetails` (le `:ref` du `<details>` juste en dessous, dans le template) est appelé
// SYNCHRONEMENT pendant le rendu, avant que ce hook ne soit invoqué. `detailsEls` est donc
// déjà complet ici : une attente supplémentaire n'aurait aucun effet, seulement du code mort.
// ⚠️ Ce paragraphe ne parle QUE des refs. Il a longtemps pu se lire comme « donc l'ouverture
// sur une section fonctionne » : c'était faux, et le § suivant dit pourquoi.
//
// 🔴 LE DÉFILEMENT, LUI, EXIGEAIT UNE CORRECTION AILLEURS (Nexus 7, 19/08/2026). La section
// s'ouvrait bien, mais l'écran restait TOUT EN HAUT : le `scrollIntoView` ci-dessus partait,
// puis vue-router l'écrasait avec le `{ top: 0 }` de son `scrollBehavior` — qu'il n'appelle
// qu'APRÈS le montage (`nextTick().then(() => scrollBehavior(...)).then(scrollToPosition)`,
// lu dans node_modules/vue-router/dist/vue-router.js). Mesuré, pas déduit : un journal des
// appels sous Playwright montre `scrollIntoView(DETAILS[section-4])` PUIS
// `scrollTo({ top: 0 })` émis depuis le module du routeur. D'où l'exception posée dans
// src/router/index.js, qui rend la main à cet écran quand `?section=` est présent.
//
// ⚠️ CONTRAT AVEC LE ROUTEUR : quand il s'efface, CE hook devient responsable de la
// position d'arrivée dans les DEUX cas. Un identifiant inconnu ne doit donc plus « ne rien
// faire » : sans le `scrollTo` ci-dessous, l'écran hériterait du scrollY de l'écran quitté —
// exactement le défaut que le `{ top: 0 }` du routeur corrige partout ailleurs (retour d'usage
// du 22/07). Aucun paramètre du tout, en revanche, ne change rien : le routeur garde alors
// la main, comme avant ce changement.
// ⚠️ ET IL LA GARDE AUSSI AU RETOUR ARRIÈRE, `?section=` ou pas : une position sauvegardée
// passe avant l'exception (src/router/index.js, précédence fixée par un test). C'est voulu —
// revenir sur le guide doit rendre la page là où la lectrice l'avait laissée, pas la
// repositionner sur la section de l'URL. Le `scrollIntoView` ci-dessous part quand même, et
// c'est le routeur qui l'écrase alors : le comportement obtenu est le bon, par le mécanisme
// même que ce correctif documente.
const route = useRoute()
onMounted(() => {
  const cible = route.query.section
  if (typeof cible !== 'string' || !cible) return
  if (!openSection(cible)) window.scrollTo({ top: 0 })
})

// Figures agrandissables au toucher (11/08) : RÉEMPLOI de la visionneuse
// zoomable des travaux « galeries » du 09/08 — <PhotoLightbox> est montée UNE SEULE FOIS dans
// App.vue et s'ouvre par le store partagé, comme le font déjà StepImages, PatternView,
// ProjectDetailView et PatternGallery. Rien à monter ni à modifier ici.
//
// Pourquoi c'est nécessaire : les figures sont plafonnées à 320 px de large (voir la CSS en
// bas de fichier — ce plafond RESTE, c'est l'affichage en ligne dans le fil du texte). Les
// captures larges ajoutées ici (tablette en paysage, une année entière de calendrier)
// y seraient vues au tiers de leur taille : un texte de 13 px tomberait à 4 px.
const lightbox = useLightboxStore()

// PÉRIMÈTRE DU TABLEAU PASSÉ À `show()` : les figures de LA SECTION, jamais les 20 du guide.
// Décidé ici, le choix était ouvert. Dans la visionneuse, un balayage horizontal passe à
// l'image suivante du tableau : le périmètre EST le fil de lecture proposé.
//   • Les sections sont des <details> REPLIÉS, une seule ouverte en pratique. Un tableau
//     « tout le guide » ferait donc balayer vers des captures d'une section que la lectrice
//     n'a pas ouverte — hors contexte, et sans la légende qui les explique (la visionneuse
//     n'affiche pas les légendes du guide).
//   • ⚠️ Un <details> fermé garde ses <img> DANS LE DOM (documenté dans tests/e2e/
//     guide.spec.js) : « toutes les figures » ne voudrait même pas dire « celles qu'elle
//     voit » — l'ensemble serait le même, ouvert ou fermé.
//   • Effet assumé : une section à figure unique ouvre la visionneuse sans chevrons
//     (`hasMany` est faux). C'est le comportement voulu, pas un manque.
//
// ⚠️ La liste et l'index viennent du MÊME passage filtré. `show()` fait `.filter(Boolean)`
// sur ce qu'on lui donne : une figure dont le nom ne résout à aucune URL (`images[block.src]`
// vaut alors `undefined`) serait retirée EN SILENCE et décalerait toutes les positions
// suivantes d'un cran — la lectrice ouvrirait la mauvaise capture. Ce trou n'est pas
// théorique ici : le contenu du guide cite cinq nouvelles captures AVANT que les
// fichiers .webp existent. D'où `posParBloc`, qui donne la position d'un bloc image DANS LA
// LISTE FILTRÉE (et rien du tout si ce bloc n'a pas d'image résolue : pas de bouton alors,
// on retombe sur l'affichage non interactif d'avant).
const figuresParSection = computed(() => {
  const parSection = {}
  for (const section of guide.value.sections) {
    const list = []
    const posParBloc = {}
    section.blocks.forEach((block, i) => {
      if (block.type !== 'image') return
      const url = images.value[block.src]
      if (!url) return
      posParBloc[i] = list.length
      list.push(url)
    })
    parSection[section.id] = { list, posParBloc }
  }
  return parSection
})

function positionFigure(sectionId, blockIndex) {
  return figuresParSection.value[sectionId]?.posParBloc[blockIndex] ?? null
}

function ouvrirFigure(sectionId, blockIndex) {
  const figures = figuresParSection.value[sectionId]
  const pos = positionFigure(sectionId, blockIndex)
  if (!figures || pos === null) return
  lightbox.show(figures.list, pos)
}
</script>

<template>
<div>
  <AppHeader :title="t('about.guide')" back />
  <main class="screen">
    <div v-if="guide.fallback" class="notice" role="status">
      <AppIcon name="warning" :size="18" class="notice__icon" />
      <p class="notice__text">{{ t('guide.notTranslatedYet', { lang: fallbackLanguageLabel }) }}</p>
    </div>

    <!-- Vers la version EN LIGNE du guide (celle qui se télécharge sur le site) — demandée
         (retour d'usage, 12/08/2026), en premier sous l'en-tête,
         avant le sommaire. Motif ÉTABLI (`target="_blank"` + `rel="noopener"`), identique à
         SettingsView.vue:344-350 et AboutView.vue:92-99 : Capacitor voit un hôte étranger à
         l'app et lance le navigateur système, la page de l'app n'est jamais remplacée.

         Repère « sort de l'app » (12/08) : icône `externalLink` du registre AppIcon,
         accolée au texte comme le `↗` littéral de PatternView.vue (même motif de lecture,
         « libellé + marque de sortie »), mais via le système d'icônes plutôt qu'un glyphe nu
         (règle du projet). Décorative : ni `label`, donc `aria-hidden="true"` posé par
         AppIcon.vue lui-même — le nom accessible de la rangée reste SEULEMENT
         `guide.downloadOnSite`, porté par le texte. `currentColor` (icône) hérite de la
         couleur de texte du lien (`--brand-deep`, déjà calibrée ≥ 4.5:1 dans les deux thèmes,
         cf. tokens.css) : aucune couleur en dur. -->
    <a
      class="link-row"
      data-test="guide-link-website"
      :href="guideOnSiteUrl"
      target="_blank"
      rel="noopener"
    >
      {{ t('guide.downloadOnSite') }}
      <AppIcon name="externalLink" :size="14" class="link-row__icon" />
    </a>

    <nav class="toc" :aria-label="t('guide.toc')">
      <p class="toc__title">{{ t('guide.toc') }}</p>
      <button
        v-for="section in guide.sections"
        :key="section.id"
        type="button"
        class="toc__item"
        @click="openSection(section.id)"
      >
        <GuideSpans :spans="section.title" />
      </button>
    </nav>

    <details
      v-for="section in guide.sections"
      :key="section.id"
      class="section"
      :ref="(el) => registerDetails(section.id, el)"
      :data-section-id="section.id"
    >
      <!-- `data-section-id` existe POUR LE TEST (tests/unit/guide-section-cible.spec.js) : c'est
           le seul moyen d'affirmer QUELLE section s'est ouverte, et pas seulement qu'une section
           s'est ouverte. Ce n'est pas du balisage mort — ne pas le retirer à un futur ménage. -->
      <summary class="section__summary">
        <h2 class="section__title"><GuideSpans :spans="section.title" /></h2>
        <AppIcon name="chevronDown" :size="18" class="section__chevron" />
      </summary>

      <div class="section__body">
        <template v-for="(block, i) in section.blocks" :key="i">
          <h3 v-if="block.type === 'subsection'" class="subtitle">
            <GuideSpans :spans="block.title" />
          </h3>

          <p v-else-if="block.type === 'paragraph'" class="paragraph">
            <GuideSpans :spans="block.spans" />
          </p>

          <!-- Une figure résolue devient un vrai BOUTON (rôle + libellé accessibles, même
               motif exact que StepImages.vue) : l'agrandissement est une action, pas une
               image décorative sur laquelle on aurait posé un `@click`. Repli non
               interactif si le nom d'image ne résout à rien (cf. `posParBloc` plus haut) :
               une figure sans capture ne promet pas un agrandissement qui n'existe pas. -->
          <figure v-else-if="block.type === 'image'" class="figure">
            <button
              v-if="positionFigure(section.id, i) !== null"
              type="button"
              class="figure__btn"
              :aria-label="t('guide.figureOpen')"
              @click="ouvrirFigure(section.id, i)"
            >
              <img :src="images[block.src]" :alt="appText(block.alt)" loading="lazy" />
            </button>
            <img v-else :src="images[block.src]" :alt="appText(block.alt)" loading="lazy" />
            <figcaption v-if="block.caption" class="figure__caption">
              <GuideSpans :spans="block.caption" />
            </figcaption>
          </figure>

          <component :is="block.ordered ? 'ol' : 'ul'" v-else-if="block.type === 'list'" class="list">
            <GuideListItem v-for="(item, ii) in block.items" :key="ii" :item="item" />
          </component>

          <dl v-else-if="block.type === 'terms'" class="terms">
            <template v-for="(row, ri) in termsPairs(block)" :key="ri">
              <div class="terms__row">
                <template v-for="(pair, pi) in row" :key="pi">
                  <dt class="terms__term"><GuideSpans :spans="pair.term" /></dt>
                  <dd class="terms__desc"><GuideSpans :spans="pair.desc" /></dd>
                </template>
              </div>
            </template>
          </dl>
        </template>

        <!-- Relance de la visite guidée (lot « visite guidée », 23/09/2026), à la fin de
             la PREMIÈRE section seulement (« {app} en 4 étapes »), pas une par section,
             une seule suffit à retrouver le chemin. Même bouton secondaire et même clé de
             libellé que le bloc « Aide » des Réglages (SettingsView.vue). -->
        <button
          v-if="section.id === 'section-0'"
          type="button"
          class="btn btn--block section__replay"
          data-test="guide-replay-tour"
          @click="startTour"
        >
          {{ t('settings.help.replayTour') }}
        </button>
      </div>
    </details>

    <BackToTop />
  </main>
</div>
</template>

<style scoped>
.notice {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  background: var(--tile);
  border: 1px solid var(--warning);
  border-radius: var(--r-md);
  box-shadow: var(--clay-sm);
  padding: var(--sp-3);
  margin-bottom: var(--sp-4);
}

/* Rangée « Télécharger le guide sur le site » : reprend le TRAITEMENT DE TUILE de `.notice`/
   `.toc` juste au-dessus/en-dessous (fond, bord, coin, ombre), pas le `.link-row` nu
   d'AboutView/SettingsView — là-bas c'est une ligne DANS une carte `.block`, ici c'est la
   toute première chose sous l'en-tête et rien ne l'enveloppe : une ligne posée seule aurait
   l'air collée à l'écran plutôt que d'en faire partie. */
.link-row {
  display: block;
  background: var(--tile);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  box-shadow: var(--clay-sm);
  padding: var(--sp-3) var(--sp-4);
  margin-bottom: var(--sp-4);
  color: var(--brand-deep);
  font-weight: 600;
  font-size: 14.5px;
  text-decoration: none;
}
.link-row__icon {
  margin-left: 5px;
  vertical-align: -0.15em;
}
.notice__icon {
  color: var(--warning);
  flex-shrink: 0;
  margin-top: 2px;
}
.notice__text {
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--ink);
  margin: 0;
}

.toc {
  background: var(--tile);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  box-shadow: var(--clay-sm);
  padding: var(--sp-3) var(--sp-4);
  margin-bottom: var(--sp-4);
  display: flex;
  flex-direction: column;
}
.toc__title {
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: var(--ink-55);
  margin: 0 0 var(--sp-2);
}
.toc__item {
  text-align: left;
  border: none;
  background: transparent;
  font: inherit;
  color: var(--brand-deep);
  font-weight: 600;
  font-size: 14.5px;
  padding: 9px 0;
  border-bottom: 1px solid var(--line-soft);
  cursor: pointer;
}
.toc__item:last-child {
  border-bottom: none;
}

.section {
  background: var(--tile);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  box-shadow: var(--clay-sm);
  margin-bottom: var(--sp-3);
  padding: 0 var(--sp-4);
}
.section__summary {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-3) 0;
  cursor: pointer;
  list-style: none;
  color: var(--ink);
}
.section__summary::-webkit-details-marker {
  display: none;
}
.section__title {
  flex: 1;
  margin: 0; /* <h2> par défaut : reset des marges du navigateur, la ligne du <summary> les gère */
  font-weight: 700;
  font-size: 15.5px;
}
.section__chevron {
  flex-shrink: 0;
  color: var(--ink-55);
  transition: transform var(--motion-base, 0.15s);
}
.section[open] .section__chevron {
  transform: rotate(180deg);
}
.section__body {
  padding-bottom: var(--sp-4);
}
/* Bouton de relance de la visite guidée (section-0 seulement, cf. script) : le dernier
   bloc du contenu (paragraphe, liste…) porte déjà une marge basse (`var(--sp-3)`), une
   marge haute supplémentaire l'en détache un peu plus, comme un bouton d'action plutôt
   qu'un bloc de texte de plus. */
.section__replay {
  margin-top: var(--sp-2);
}

.subtitle {
  font-size: 15px;
  margin: var(--sp-3) 0 var(--sp-2);
}
.paragraph {
  font-size: 14.5px;
  line-height: 1.55;
  color: var(--ink);
  margin: 0 0 var(--sp-3);
}
.figure {
  margin: 0 0 var(--sp-3);
}
/* Le bouton d'agrandissement reprend la MISE EN PAGE que portait l'<img> seule (largeur
   fluide, plafond 320 px, centrage) : un <button> est `inline-block` et se rétrécit sur son
   contenu, si bien qu'une `width: 100%` laissée à la seule <img> se mesurerait sur ce bloc
   rétréci au lieu de la colonne de texte. Le plafond de 320 px reste ainsi EFFECTIF sur la
   vignette en ligne (c'est l'agrandissement plein écran qui répond au besoin de lisibilité,
   pas un affichage plus grand dans le fil du texte) et la figure garde exactement la même
   apparence qu'avant, cliquable en plus. */
.figure__btn {
  display: block;
  width: 100%;
  max-width: 320px;
  margin: 0 auto;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
}
.figure img {
  display: block;
  width: 100%;
  max-width: 320px;
  margin: 0 auto;
  border-radius: var(--r-sm);
  border: 1px solid var(--line);
}
.figure__caption {
  font-size: 12.5px;
  font-style: italic;
  color: var(--ink-55);
  text-align: center;
  margin-top: var(--sp-1);
}
.list {
  margin: 0 0 var(--sp-3);
  padding-left: 1.1em;
  color: var(--ink);
  font-size: 14.5px;
  line-height: 1.5;
}
.terms {
  margin: 0 0 var(--sp-3);
}
/* Regroupe les paires d'une même ligne (utile à plus de 2 colonnes, où une ligne source
   devient plusieurs paires term/desc à la suite) : un filet sépare une ligne de la suivante,
   invisible pour le cas courant à 2 colonnes (une seule paire par ligne). */
.terms__row + .terms__row {
  margin-top: var(--sp-2);
  padding-top: var(--sp-2);
  border-top: 1px solid var(--line-soft);
}
.terms__term {
  font-weight: 700;
  font-size: 14px;
  color: var(--ink);
  margin-top: var(--sp-2);
}
.terms__desc {
  margin: 2px 0 0;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--ink-70);
}
</style>
