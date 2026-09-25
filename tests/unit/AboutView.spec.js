// @vitest-environment jsdom
// Écran À propos. Couvre les points les plus fragiles des exigences :
//   - le nom de l'app n'est JAMAIS écrit en dur (120 occurrences existent déjà ailleurs,
//     un renommage est un chantier à part) ;
//   - version/build viennent de la source unique (package.json, cf.
//     app-version-single-source.spec.js) ;
//   - contact reste INVISIBLE tant que `CONTACT_EMAIL` est vide (une utilisatrice ne doit
//     jamais voir un bloc « Contact : » vide) — renseignée depuis le 05/08 et se rend donc ;
//     site suit désormais la langue de l'app (`websiteUrlFor`, depuis le 12/08/2026) et n'a plus
//     de garde puisque cette fonction ne rend jamais d'adresse vide ;
//   - le lien « guide » pointe vers la route `/guide` construite plus tard (GuideView.vue) —
//     ce n'est plus l'état « Bientôt disponible » de HomeView.vue, remplacé depuis.
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import i18n from '@/i18n'
import AboutView from '@/views/AboutView.vue'
import AppHeader from '@/components/AppHeader.vue'
import { APP_VERSION, APP_BUILD, APP_CREATOR } from '@/constants/app-info'
import { CONTACT_EMAIL, websiteUrlFor } from '@/constants/app-links'
import { RELEASE_NOTES_FR } from '@/content/release-notes.fr'
import { RELEASE_NOTES_EN } from '@/content/release-notes.en'
import { RELEASE_NOTES_DE } from '@/content/release-notes.de'
import { RELEASE_NOTES_ES } from '@/content/release-notes.es'
import { withAppName } from '@/utils/app-name-token'
import { createTestRouter } from './helpers/i18n-router'

function makeRouter() {
  return createTestRouter([
    { path: '/', name: 'home', component: { template: '<div/>' } },
    { path: '/guide', name: 'guide', component: { template: '<div/>' } },
    { path: '/about/privacy', name: 'about-privacy', component: { template: '<div/>' } },
    { path: '/about/licenses', name: 'about-licenses', component: { template: '<div/>' } },
  ])
}

async function mountAbout(locale = 'fr') {
  i18n.global.locale.value = locale
  const router = makeRouter()
  router.push('/')
  await router.isReady()
  return mount(AboutView, {
    global: { plugins: [router, i18n], stubs: { AppHeader: true } },
  })
}

// Le nom en dur n'est PAS testé ici (grep 1 fichier) : c'est le rôle de
// tests/unit/app-name-single-source.spec.js, qui balaie TOUT le périmètre ajouté par ce lot
// (i18n + contenu long + les 3 vues, dont celle-ci) — une revue a montré qu'un test à un
// seul fichier ne peut pas soutenir une affirmation qui porte sur tout un lot.
describe('AboutView — nom de l’app', () => {
  it("affiche le nom de l'app lu depuis la clé i18n app.name", async () => {
    const wrapper = await mountAbout()
    expect(wrapper.text()).toContain(i18n.global.messages.value.fr.app.name)
  })
})

describe('AboutView — version, build, créateur', () => {
  it('affiche la version et le build issus de la source unique', async () => {
    const wrapper = await mountAbout()
    const versionText = wrapper.get('[data-test="about-version"]').text()
    expect(versionText).toContain(APP_VERSION)
    expect(versionText).toContain(String(APP_BUILD))
  })

  it('affiche le nom du créateur', async () => {
    const wrapper = await mountAbout()
    expect(wrapper.text()).toContain(APP_CREATOR)
  })

  // L'assertion ci-dessus ne peut PAS échouer sur un changement de créateur : elle compare
  // l'écran à la constante qu'il affiche, donc les deux bougent ensemble. Le nom attendu est
  // donc écrit en toutes lettres ici — c'est le seul endroit du dépôt qui morde si quelqu'un
  // remet l'ancien nom provisoire (corrigé le 09/08/2026 sur retour terrain).
  it("affiche « Alexia O. » — le nom réel, pas l'ancien nom provisoire", async () => {
    const wrapper = await mountAbout()
    expect(APP_CREATOR).toBe('Alexia O.')
    expect(wrapper.get('.hero__creator').text()).toContain('Alexia O.')
  })
})

describe('AboutView — logo', () => {
  // Retour terrain, 09/08 : l'écran affichait encore le pictogramme « pelote » du registre
  // d'icônes alors que l'app a un logo depuis le 09/08 (le hérisson, cf. tools/icones/).
  it("montre le logo de l'app, et pas un pictogramme du registre", async () => {
    const wrapper = await mountAbout()
    const logo = wrapper.get('[data-test="about-logo"]')
    expect(logo.element.tagName).toBe('IMG')
    expect(logo.attributes('src')).toBe('/logo/rowtine-192.webp')
    // Muet pour les lecteurs d'écran : le nom de l'app est juste en dessous en clair.
    expect(logo.attributes('alt')).toBe('')
    expect(wrapper.findComponent({ name: 'AppIcon' }).exists()).toBe(false)
  })

  // Un `src` cassé ne se voit PAS au montage : jsdom ne charge aucune image, et Vite ne
  // vérifie pas les chemins absolus de public/ (ils sont servis tels quels). Sans cette
  // assertion-ci, le test au-dessus passerait avec un fichier inexistant.
  it('le fichier pointé existe bien dans public/', async () => {
    // Le chemin testé est LU sur le composant, pas recopié : sinon un `src` faux dans
    // AboutView.vue laisserait ce test au vert.
    const wrapper = await mountAbout()
    const src = wrapper.get('[data-test="about-logo"]').attributes('src')
    expect(src.startsWith('/')).toBe(true) // sinon `public/` + src ne veut rien dire
    // Ancré sur le répertoire de travail (racine du dépôt sous Vitest), PAS sur
    // `import.meta.url` : en environnement jsdom celui-ci est une URL http:// servie par
    // Vite, et `existsSync` répond alors false quel que soit l'état du disque — le test
    // aurait échoué en permanence, y compris fichier présent (constaté ici même).
    // Le témoin sur package.json rend cette hypothèse VÉRIFIÉE : si un jour la racine
    // change, c'est lui qui casse, avec un message qui dit pourquoi.
    expect(existsSync(resolve('package.json'))).toBe(true)
    expect(existsSync(resolve(`public${src}`))).toBe(true)
  })
})

describe('AboutView — contact et site', () => {
  // ⚠️ 10/08/2026 — CETTE RANGÉE DOIT RESTER UN `mailto:`. Elle a été basculée vers les tickets
  // GitHub le matin même, puis REMISE le jour même : mesuré sur un Pixel 7, un lien github.com
  // ouvert depuis un téléphone où l'app GitHub est installée affiche « Sign in to GitHub.com »,
  // navigateur compris. `curl` recevait pourtant la page publique en 200 — seule la mesure sur
  // appareil l'a vu.
  //
  // C'est la SEULE porte de l'app qui ne demande aucun compte : une tricoteuse qui ne code pas
  // doit pouvoir écrire. Le dépôt vit sous « Suggérer une amélioration » (SettingsView), dont
  // le public est plus susceptible d'avoir un compte.
  //
  // L'assertion `not.toContain('github')` n'est pas décorative : elle fait rougir la
  // ré-application, un jour, de la bascule qui a déjà été tentée et annulée une fois.
  it('rend la rangée « Nous contacter » en `mailto:` — PAS vers le dépôt (annulé le 10/08)', async () => {
    const wrapper = await mountAbout()
    const row = wrapper.find('[data-test="about-link-contact"]')
    expect(row.exists()).toBe(true)
    expect(row.attributes('href')).toBe(`mailto:${CONTACT_EMAIL}`)
    expect(row.attributes('href')).not.toContain('github')
  })

  // 12/08/2026 — le SITE suit désormais la langue de l'APP, pas celle du navigateur (exigence
  // « adresse du site suit la langue de l'app ») : même mécanisme que
  // `guideOnSiteUrl` de GuideView.vue. Plus de `v-if` sur cette rangée (voir AboutView.vue) :
  // `websiteUrlFor` retombe toujours sur l'anglais et ne rend donc jamais une adresse vide.
  it('rend la rangée « Site web » vers l\'adresse de la langue active', async () => {
    const wrapper = await mountAbout('fr')
    const row = wrapper.find('[data-test="about-link-website"]')
    expect(row.exists()).toBe(true)
    expect(row.attributes('href')).toBe(websiteUrlFor('fr'))
    expect(row.attributes('href')).toBe('https://rowtine.app/fr/')
    expect(row.attributes('target')).toBe('_blank')
    expect(row.attributes('rel')).toBe('noopener')
  })

  // Preuve que l'adresse SUIT la langue (pas seulement qu'elle existe) : sans ce test, un
  // retour silencieux à une adresse fixe passerait inaperçu — même piège que celui documenté
  // pour APP_CREATOR plus haut dans ce fichier.
  it("suit la langue active — l'adresse change avec la locale (allemand)", async () => {
    const wrapper = await mountAbout('de')
    const row = wrapper.find('[data-test="about-link-website"]')
    expect(row.attributes('href')).toBe('https://rowtine.app/de/')
  })
})

describe('AboutView — pas de flèche retour (destination du burger, pas un écran de détail)', () => {
  it('ne passe pas `back` à AppHeader, contrairement à ses sous-écrans', async () => {
    const wrapper = await mountAbout()
    expect(wrapper.getComponent(AppHeader).props('back')).toBe(false)
  })
})

describe('AboutView — liens internes', () => {
  it('pointe vers /about/privacy et /about/licenses', async () => {
    const wrapper = await mountAbout()
    expect(wrapper.get('[data-test="about-link-privacy"]').attributes('href')).toBe('/about/privacy')
    expect(wrapper.get('[data-test="about-link-licenses"]').attributes('href')).toBe('/about/licenses')
  })

  it('ne porte PLUS le lien vers le guide : il a déménagé dans le menu ☰ (12/08)', async () => {
    // Retourné, pas supprimé. Ce test affirmait l'inverse jusqu'au 12/08 ; l'effacer
    // aurait laissé passer sans bruit un guide présent à DEUX endroits — le contraire du
    // déplacement demandé. La porte d'entrée unique est désormais AppHeader.vue, couvert
    // par tests/unit/AppHeader-menu.spec.js.
    const wrapper = await mountAbout()
    expect(wrapper.find('[data-test="about-link-guide"]').exists()).toBe(false)
  })
})

// Revue du 02/08 : le journal des nouveautés se rendait en français SANS
// CONDITION aux quatre langues (aucun résolveur, contrairement à la politique de
// confidentialité) — une hispanophone lisait « Novedades de esta versión » suivi d'une phrase
// française. Corrigé par src/content/release-notes.js (même mécanisme que
// resolvePrivacyPolicy). Ces tests couvrent les quatre langues, comme
// PrivacyPolicyView.spec.js le fait pour la politique de confidentialité.
const APP_NAME_ABOUT = i18n.global.messages.value.fr.app.name

describe.each([
  ['français', 'fr', () => RELEASE_NOTES_FR],
  ['anglais', 'en', () => RELEASE_NOTES_EN],
  ['allemand', 'de', () => RELEASE_NOTES_DE],
  ['espagnol', 'es', () => RELEASE_NOTES_ES],
])('AboutView — journal des nouveautés %s', (_label, locale, getNotes) => {
  it('affiche le contenu traduit de la langue active, marqueur {app} substitué', async () => {
    const wrapper = await mountAbout(locale)
    for (const entry of getNotes()) {
      expect(wrapper.text()).toContain(entry.version)
      for (const noteText of entry.notes) {
        expect(wrapper.text()).toContain(withAppName(noteText, APP_NAME_ABOUT))
      }
    }
    expect(wrapper.text()).not.toContain('{app}')
  })
})
