// Écran Guide utilisateur (lot 2 « écran À propos et guide in-app »). Le contenu
// vient du fichier GÉNÉRÉ (src/generated/guide-content.<langue>.json, cf.
// scripts/gen-guide-content.mjs et parse-guide-markdown.js) — ce test vérifie que l'écran le
// rend fidèlement, substitue le marqueur {app}, et affiche un repli EXPLICITE (jamais un
// écran muet) pour toute langue dont le guide manquerait.
//
// Les quatre traductions du guide sont livrées depuis le lot 3 : les quatre
// langues de LANGUAGES (constants/languages.js) ont donc chacune leur propre contenu, sans
// jamais passer par le repli. Le 2e bloc ci-dessous le prouve pour les trois langues gagnées
// par ce lot ; le 3e bloc vérifie que le MÉCANISME de repli lui-même reste opérant, avec une
// locale volontairement inexistante ('xx') plutôt qu'une des quatre locales réelles — sinon
// ce test attesterait d'un comportement qu'aucune utilisatrice ne peut plus déclencher.
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { useSettingsStore } from '@/stores/settings'
import { useLightboxStore } from '@/stores/lightbox'
import i18n from '@/i18n'
import { guideUrlFor } from '@/constants/app-links'
import guideFr from '@/generated/guide-content.fr.json'
import guideEn from '@/generated/guide-content.en.json'
import guideDe from '@/generated/guide-content.de.json'
import guideEs from '@/generated/guide-content.es.json'

// Depuis le lot du 19/08/2026 (« le guide s'ouvre sur une section »), GuideView.vue appelle
// `useRoute()` au montage pour lire `route.query.section` (tests/unit/guide-section-cible.spec.js
// couvre ce comportement en détail). Ce fichier-ci ne teste PAS l'ouverture ciblée : il a juste
// besoin d'une route qui existe, sans paramètre `section` — sinon `useRoute()` rend `undefined`
// (aucun routeur n'est installé dans `mountGuide` ci-dessous) et `route.query.section` lève une
// exception non interceptée à chaque montage (mesuré : 17 rejets non gérés, suite plantée).
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }))

import GuideView from '@/views/GuideView.vue'

function mountGuide(locale = 'fr') {
  i18n.global.locale.value = locale
  return mount(GuideView, {
    global: { plugins: [createTestingPinia({ stubActions: false }), i18n], stubs: { AppHeader: true } },
  })
}

describe('GuideView — contenu français (langue native du guide)', () => {
  it('affiche exactement les sections du contenu généré, sans bandeau de repli', () => {
    const wrapper = mountGuide('fr')
    expect(wrapper.findAll('.section')).toHaveLength(guideFr.sections.length)
    expect(wrapper.find('.notice').exists()).toBe(false)
  })

  it('le sommaire liste une entrée par section', () => {
    const wrapper = mountGuide('fr')
    expect(wrapper.findAll('.toc__item')).toHaveLength(guideFr.sections.length)
  })

  it('substitue le marqueur {app} par le nom réel de l’app (jamais en dur)', () => {
    const wrapper = mountGuide('fr')
    expect(wrapper.text()).not.toContain('{app}')
    expect(wrapper.text()).toContain(i18n.global.messages.value.fr.app.name)
  })

  it('rend le tableau du guide en paires terme/description (<dl>), pas en <table>', () => {
    const wrapper = mountGuide('fr')
    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.findAll('dl.terms').length).toBeGreaterThan(0)
  })

  it('rend une <img> par bloc image du contenu généré', () => {
    const wrapper = mountGuide('fr')
    const imageBlocks = guideFr.sections.flatMap((s) => s.blocks.filter((b) => b.type === 'image'))
    expect(wrapper.findAll('figure.figure img')).toHaveLength(imageBlocks.length)
  })
})

describe.each([
  ['anglais', 'en', () => guideEn],
  ['allemand', 'de', () => guideDe],
  ['espagnol', 'es', () => guideEs],
])('GuideView — contenu %s (traduit)', (_label, locale, getGuide) => {
  it('affiche exactement les sections du contenu généré, sans bandeau de repli', () => {
    const wrapper = mountGuide(locale)
    expect(wrapper.findAll('.section')).toHaveLength(getGuide().sections.length)
    expect(wrapper.find('.notice').exists()).toBe(false)
  })
})

describe('GuideView — locale sans contenu du tout : le repli reste opérant (filet 5e langue)', () => {
  it("affiche un bandeau de repli visible pour une langue qui n'existe pas", () => {
    const wrapper = mountGuide('xx')
    expect(wrapper.find('.notice').exists()).toBe(true)
    expect(wrapper.find('.notice').text().length).toBeGreaterThan(0)
  })

  it('affiche quand même le contenu (repli anglais) plutôt qu’un écran vide', () => {
    const wrapper = mountGuide('xx')
    expect(wrapper.findAll('.section')).toHaveLength(guideEn.sections.length)
  })
})

// Figures agrandissables (lot du 11/08, §6) : la visionneuse partagée s'ouvre sur la
// figure touchée, avec pour périmètre LES FIGURES DE SA SECTION (décision documentée dans
// GuideView.vue). Les attentes sont dérivées du CONTENU GÉNÉRÉ, jamais relues sur le
// composant — sinon le test ne ferait que répéter l'implémentation.
//
// ⚠️ Les DEUX comptes ci-dessous supposent que CHAQUE nom d'image du contenu généré résout
// vers un fichier réel (un bouton par bloc image). C'est vrai aujourd'hui. Le contenu du guide
// va citer cinq nouvelles captures AVANT que les .webp existent : pendant cette fenêtre, ces
// comptes tomberont, et ce sera l'état intermédiaire attendu — pas une régression, et pas un
// chiffre à « ajuster » en silence. Le comportement des figures sans capture est tenu par
// tests/unit/guide-figure-image-manquante.spec.js, qui reste vrai dans les deux états.
function figuresParSectionDuJson(guide) {
  return guide.sections.map((s) => s.blocks.filter((b) => b.type === 'image'))
}

describe('GuideView — les figures s’agrandissent au toucher', () => {
  it('un tap sur la 2e figure d’une section ouvre la visionneuse SUR CETTE figure, avec les seules figures de la section', async () => {
    const parSection = figuresParSectionDuJson(guideFr)
    // Première section du guide portant au moins 2 figures : sans cela, un index de clic
    // valant 1 n'existerait pas et la mutation « index fixe à 0 » resterait invisible.
    const iSection = parSection.findIndex((imgs) => imgs.length >= 2)
    expect(iSection).toBeGreaterThanOrEqual(0)
    const attendues = parSection[iSection]
    const totalGuide = parSection.flat().length
    // Garde de discrimination : si la section portait TOUTES les figures du guide, l'assertion
    // de périmètre ci-dessous ne prouverait plus rien.
    expect(attendues.length).toBeLessThan(totalGuide)

    const wrapper = mountGuide('fr')
    const lightbox = useLightboxStore()

    const section = wrapper.findAll('.section')[iSection]
    const boutons = section.findAll('.figure__btn')
    expect(boutons).toHaveLength(attendues.length)

    const srcCliquee = boutons[1].find('img').attributes('src')
    await boutons[1].trigger('click')

    expect(lightbox.open).toBe(true)
    expect(lightbox.index).toBe(1) // la figure TOUCHÉE, pas la première de la section
    expect(lightbox.current).toBe(srcCliquee)
    expect(lightbox.photos).toHaveLength(attendues.length) // périmètre = la section
    expect(lightbox.photos).toEqual(boutons.map((b) => b.find('img').attributes('src')))
  })

  it('chaque figure est un bouton avec un libellé accessible traduit (rôle + nom, pas une image cliquable muette)', () => {
    const wrapper = mountGuide('fr')
    const boutons = wrapper.findAll('.figure__btn')
    const total = figuresParSectionDuJson(guideFr).flat().length
    expect(boutons).toHaveLength(total)
    for (const b of boutons) {
      expect(b.element.tagName).toBe('BUTTON')
      expect(b.attributes('type')).toBe('button')
      expect(b.attributes('aria-label')).toBe(i18n.global.t('guide.figureOpen'))
    }
  })
})

// Lien « Télécharger le guide sur le site » (12/08/2026) :
// tout en haut de l'écran, AVANT le sommaire, la première chose vue sous l'en-tête. Motif
// ÉTABLI (`target="_blank"` + `rel="noopener"`, comme SettingsView.vue et AboutView.vue) —
// Capacitor voit un hôte étranger à l'app et lance le navigateur système, la page de l'app
// n'est jamais remplacée.
describe('GuideView — lien vers le guide sur le site', () => {
  it("pointe vers l'adresse de la langue active, avec target/rel corrects", () => {
    const wrapper = mountGuide('fr')
    const row = wrapper.find('[data-test="guide-link-website"]')
    expect(row.exists()).toBe(true)
    expect(row.attributes('href')).toBe(guideUrlFor('fr'))
    expect(row.attributes('href')).toBe('https://rowtine.app/fr/guide/')
    expect(row.attributes('target')).toBe('_blank')
    expect(row.attributes('rel')).toBe('noopener')
  })

  it("suit la langue active — l'adresse change avec la locale", () => {
    const wrapper = mountGuide('de')
    const row = wrapper.find('[data-test="guide-link-website"]')
    expect(row.attributes('href')).toBe('https://rowtine.app/de/guide/')
  })

  // Preuve d'ordre DANS LE DOM : la rangée est placée « AVANT le bloc <nav class="toc"> ».
  // On compare des POSITIONS (pas seulement « les deux existent »), sinon déplacer la rangée
  // après le sommaire laisserait ce test vert — « row exists AND toc exists »
  // survit à un déplacement. Ancré sur `.toc` (pas « premier enfant de main » : sous la
  // locale 'xx', le bandeau de repli `.notice` précède aussi la rangée).
  it("précède le sommaire dans l'ordre du DOM", () => {
    const wrapper = mountGuide('fr')
    const children = Array.from(wrapper.find('main').element.children)
    const rowIndex = children.findIndex((el) => el.matches('[data-test="guide-link-website"]'))
    const tocIndex = children.findIndex((el) => el.matches('.toc'))
    expect(rowIndex).toBeGreaterThanOrEqual(0)
    expect(tocIndex).toBeGreaterThanOrEqual(0)
    expect(rowIndex).toBeLessThan(tocIndex)
  })

  // Repère « sort de l'app » (du 12/08) : une icône décorative, jamais annoncée à part
  // par un lecteur d'écran. Ancré sur `.app-icon` (rendu réel de AppIcon.vue), pas sur le
  // texte du SVG — une régression qui retirerait l'icône ou lui donnerait un `label` (donc un
  // rôle `img` annoncé séparément) doit faire échouer ce test.
  it("porte un repère visuel décoratif (icône) qui ne change pas le nom accessible de la rangée", () => {
    const wrapper = mountGuide('fr')
    const row = wrapper.find('[data-test="guide-link-website"]')
    const icon = row.find('.app-icon')
    expect(icon.exists()).toBe(true)
    expect(icon.attributes('aria-hidden')).toBe('true')
    expect(icon.attributes('role')).toBeUndefined()
    expect(icon.attributes('aria-label')).toBeUndefined()
    // Le nom accessible du lien reste SEULEMENT son libellé traduit (l'icône ne s'y ajoute
    // pas) : ni crochets ni glyphe résiduel autour du texte.
    expect(row.text().trim()).toBe(i18n.global.t('guide.downloadOnSite'))
  })
})

describe('GuideView — les captures suivent le thème de l’app (lot « mode sombre », 08/08)', () => {
  it('bascule les images de claires à sombres quand le réglage change, DANS LE DOM', async () => {
    const wrapper = mountGuide('fr')
    const settings = useSettingsStore()

    settings.theme = 'light'
    await wrapper.vm.$nextTick()
    const avant = wrapper.findAll('figure.figure img').map((i) => i.attributes('src'))
    expect(avant.length).toBeGreaterThan(0)

    settings.theme = 'dark'
    await wrapper.vm.$nextTick()
    const apres = wrapper.findAll('figure.figure img').map((i) => i.attributes('src'))

    expect(apres).toHaveLength(avant.length)
    const inchangees = apres.filter((src, i) => src === avant[i])
    expect(inchangees, `images restées identiques après la bascule : ${JSON.stringify(inchangees)}`).toEqual([])
  })
})
