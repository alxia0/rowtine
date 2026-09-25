// @vitest-environment jsdom
// Unitaire — ouvrir le guide directement sur une section (19/08/2026, §4.4).
// La pop-up d'avertissement d'import et le bloc de réussite de l'import y mènent tous deux.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { GUIDE_SECTION_BIBLIOTHEQUE } from '@/constants/guide-sections'
import { LANGUAGES } from '@/constants/languages'
import { resolveGuideContent } from '@/content/guide'
import { createTestI18n } from './helpers/i18n-router'

const nav = vi.hoisted(() => ({
  route: { name: 'guide', params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({
  useRoute: () => nav.route,
  useRouter: () => nav.router,
}))

import GuideView from '@/views/GuideView.vue'

const i18n = createTestI18n()

beforeEach(() => {
  setActivePinia(createPinia())
  nav.route.query = {}
})

async function monterGuide() {
  const w = mount(GuideView, { global: { plugins: [i18n] }, attachTo: document.body })
  await flushPromises()
  return w
}

// Un mot par langue, propre à LA SECTION BIBLIOTHÈQUE — vérifié à la main dans les 4 fichiers
// générés (`src/generated/guide-content.<langue>.json`, section `section-4`) avant d'écrire
// cette table, pas recopié d'une source tierce :
//   fr → "4. Ta bibliothèque de patrons"     en → "4. Your pattern library"
//   de → "4. Deine Anleitungen"              es → "4. Tu biblioteca de patrones"
// L'allemand n'a AUCUN cognat de « bibliothèque » (« Anleitungen » = « instructions/notices »),
// donc un mot commun aux 4 langues n'existe pas — chaque langue a le sien.
// ⚠️ CE TEST PEUT AUSSI ROUGIR SUR UNE SIMPLE RETRADUCTION DU TITRE, sans qu'aucune section
// n'ait bougé (un titre allemand qui repasserait à « Bibliothek », par exemple). Dans ce
// cas, c'est CETTE TABLE qu'il faut mettre à jour — surtout pas `guide-sections.js`, dont
// la constante reste juste : la cible n'a pas changé de place, seul son nom a changé de
// mots. (Engagement pris en revue, et tenu lors d'une revue ultérieure.)
const MOT_BIBLIOTHEQUE = { fr: 'bibliothèque', en: 'library', de: 'anleitungen', es: 'biblioteca' }

describe('guide — section cible', () => {
  it('G12 — la section visée est bien « Ta bibliothèque de patrons », dans les 4 langues', () => {
    // C'EST LE GARDE-FOU DE L'IDENTIFIANT POSITIONNEL. `section-4` n'est pas un nom, c'est
    // un rang : insérer une section avant elle déplacerait silencieusement la cible.
    //
    // Le rang seul (« 4. ») ne suffit PAS : le guide est numéroté en séquence stricte, donc
    // insérer une section avant renumérote toute la suite — la section usurpatrice en
    // position 4 s'appelle ELLE AUSSI « 4. quelque chose ». Un test qui ne vérifierait que
    // `startsWith('4.')` resterait vert PAR CONSTRUCTION face à ce glissement (mesuré : voir
    // la mutation « section insérée », qui simule exactement ce cas dans les 4 langues et
    // fait rougir ce test précisément grâce au mot-clé ci-dessous, jamais grâce au rang seul).
    // D'où `MOT_BIBLIOTHEQUE`, une table dédiée avec un mot par langue (ci-dessus) : le bouton
    // « Comment corriger » ouvrirait sinon la mauvaise page sans un mot, dans TOUTE langue non
    // couverte — pas seulement le français.
    for (const lang of LANGUAGES.map((l) => l.code)) {
      const guide = resolveGuideContent(lang)
      const section = guide.sections.find((s) => s.id === GUIDE_SECTION_BIBLIOTHEQUE)

      // PRÉCONDITION : la section EXISTE dans cette langue. Sans elle, un `find` qui rend
      // `undefined` ferait passer un test qui ne compare rien.
      expect(section, `section ${GUIDE_SECTION_BIBLIOTHEQUE} absente en ${lang}`).toBeDefined()

      const titre = section.title.map((s) => s.text).join('')
      expect(titre.trim().startsWith('4.'), `en ${lang} le titre est « ${titre} »`).toBe(true)
      expect(titre.toLowerCase(), `en ${lang} le titre est « ${titre} »`).toContain(MOT_BIBLIOTHEQUE[lang])
    }
  })

  // ⚠️⚠️ CE QUE CE FICHIER NE PEUT PAS VÉRIFIER : LA POSITION DE DÉFILEMENT.
  // Les tests ci-dessous tournent sous jsdom, qui ne calcule AUCUNE mise en page — pas de
  // hauteur, pas de position, pas de fenêtre qui défile. `Element.prototype.scrollIntoView`
  // et `window.scrollTo` n'y existent même pas : ce sont des bouchons vides posés par
  // tests/unit/setup.js. On peut donc affirmer QU'ON A DEMANDÉ un défilement (G13/G14
  // ci-dessous), jamais qu'il a EU LIEU ni où il s'est arrêté.
  // Ce trou n'est pas théorique : jusqu'au 19/08/2026, G9 était vert alors que, sur une
  // Nexus 7, la page ne défilait PAS jusqu'à la section (le routeur ramenait aussitôt en
  // haut) — la promesse « le guide s'ouvre SUR une section » n'était tenue qu'à moitié.
  // ⇒ La position réellement atteinte se vérifie dans un vrai moteur de rendu :
  //    tests/e2e/guide-section-cible.spec.js (titre entier dans la fenêtre, dégagé du
  //    bandeau collant, contenu au-dessus de la ligne de flottaison, et position qui tient).
  it('G9 — /guide?section=<id> ouvre la section visée (SANS rien dire du défilement, cf. note ci-dessus)', async () => {
    nav.route.query = { section: GUIDE_SECTION_BIBLIOTHEQUE }
    const w = await monterGuide()

    const details = w.findAll('details')
    // PRÉCONDITION : les sections sont bien rendues, et il y en a plus d'une — sinon
    // « une section est ouverte » ne prouverait rien.
    expect(details.length).toBeGreaterThan(1)

    const ouvertes = details.filter((d) => d.element.open)
    expect(ouvertes).toHaveLength(1)
    expect(ouvertes[0].attributes('data-section-id')).toBe(GUIDE_SECTION_BIBLIOTHEQUE)
  })

  it('G10 — un identifiant inconnu n ouvre rien et ne lève rien', async () => {
    // Capture locale (pas dans un beforeEach de portée fichier) : SEUL ce test a besoin
    // d'espionner la console, et un vrai avertissement Vue émis pendant l'un des 3 AUTRES
    // tests de ce fichier ne doit jamais être avalé en silence par une capture posée pour
    // celui-ci.
    const rejetsNonGeres = []
    const captureRejet = (err) => rejetsNonGeres.push(err)
    process.on('unhandledRejection', captureRejet)
    const espionErreur = vi.spyOn(console, 'error').mockImplementation(() => {})
    const espionAvert = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      nav.route.query = { section: 'section-inexistante' }
      const w = await monterGuide()
      // Laisse Node achever sa vérification des rejets non gérés (elle n'a lieu qu'après une
      // pleine passe de la boucle d'événements, pas seulement les microtâches — un
      // `flushPromises()` dans `monterGuide` n'y suffit pas).
      await new Promise((resolve) => setTimeout(resolve, 0))

      const details = w.findAll('details')
      expect(details.length).toBeGreaterThan(1) // précondition : le guide est bien rendu
      expect(details.filter((d) => d.element.open)).toHaveLength(0)

      // « ne lève rien », pas seulement « n'ouvre rien » : sans les 3 assertions qui suivent,
      // un `openSection` qui PLANTE sur un id inconnu (au lieu de faire un `return` propre)
      // laisserait ce test vert quand même — aucune section ne s'ouvre non plus dans ce cas,
      // pour la MAUVAISE raison.
      //
      // ⚠️ Ces 3 assertions sont DORMANTES pour la mutation qui fait aujourd'hui rougir ce
      // test (retirer le `if (!el) return` d'`openSection`) : avec le hook `onMounted`
      // SYNCHRONE actuel, l'exception remonte par un 3e canal — Vue la relance depuis le
      // `mount()` lui-même, que Vitest attribue directement à ce test (`TypeError: Cannot set
      // properties of undefined`), AVANT même d'atteindre la ligne `rejetsNonGeres` ci-dessous.
      // Elles restent posées pour 2 autres formes déjà observées pendant ce lot (hook async
      // d'une version antérieure du code : rejet non intercepté ; erreur routée par le
      // `handleError` de dev de Vue : `console.error`/`console.warn`) — un lecteur ne doit pas
      // croire qu'elles sont ce qui fait rougir G10 aujourd'hui.
      expect(rejetsNonGeres, `rejet(s) non géré(s) : ${rejetsNonGeres.map(String)}`).toEqual([])
      expect(espionErreur, 'console.error appelé pendant le montage').not.toHaveBeenCalled()
      expect(espionAvert, 'console.warn appelé pendant le montage').not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', captureRejet)
      espionErreur.mockRestore()
      espionAvert.mockRestore()
    }
  })

  // CONTRAT AVEC LE ROUTEUR (correctif du 19/08/2026). Quand `?section=` est présent,
  // `src/router/index.js` rend `false` : il ne défile plus lui-même, et c'est GuideView qui
  // pose la position d'arrivée. Les deux branches de ce contrat sont vérifiées ici — ce que
  // jsdom PEUT faire (qui a été appelé, avec quoi), par opposition à la position atteinte.
  it('G13 — section connue : on défile vers SON <details>, et on ne remet pas en haut', async () => {
    const cibles = []
    const espionSiv = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (...args) {
      cibles.push({ el: this, args })
    })
    const espionScrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    try {
      nav.route.query = { section: GUIDE_SECTION_BIBLIOTHEQUE }
      const w = await monterGuide()

      // PRÉCONDITION : le guide est bien rendu et la section visée existe — sinon
      // « on a défilé vers elle » serait vide de sens.
      expect(w.findAll('details').length).toBeGreaterThan(1)
      expect(w.find(`details[data-section-id="${GUIDE_SECTION_BIBLIOTHEQUE}"]`).exists()).toBe(true)

      expect(cibles).toHaveLength(1)
      expect(cibles[0].el.getAttribute('data-section-id')).toBe(GUIDE_SECTION_BIBLIOTHEQUE)
      expect(cibles[0].args[0]).toMatchObject({ block: 'start' })
      // Remettre en haut ICI annulerait le défilement qu'on vient de demander : c'est
      // précisément le défaut du 19/08, dans sa version « GuideView se tire dessus ».
      expect(espionScrollTo).not.toHaveBeenCalled()
    } finally {
      espionSiv.mockRestore()
      espionScrollTo.mockRestore()
    }
  })

  it('G14 — identifiant inconnu : personne ne défile vers rien, mais on remet en haut', async () => {
    // Sans ce `scrollTo`, l'écran hériterait du scrollY de l'écran quitté — le routeur
    // s'étant effacé, plus personne ne remettrait en haut (défaut du 22/07, par une porte
    // neuve). C'est l'assertion qui tient le contrat côté GuideView.
    const espionSiv = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
    const espionScrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    try {
      nav.route.query = { section: 'section-inexistante' }
      const w = await monterGuide()
      expect(w.findAll('details').length).toBeGreaterThan(1) // précondition : le guide est rendu
      expect(w.find('details[data-section-id="section-inexistante"]').exists()).toBe(false)

      expect(espionSiv).not.toHaveBeenCalled()
      expect(espionScrollTo).toHaveBeenCalledWith({ top: 0 })
    } finally {
      espionSiv.mockRestore()
      espionScrollTo.mockRestore()
    }
  })

  it('sans paramètre, aucune section n est ouverte — comportement d avant, inchangé', async () => {
    const espionSiv = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
    const espionScrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    try {
      const w = await monterGuide()
      const details = w.findAll('details')
      expect(details.length).toBeGreaterThan(1)
      expect(details.filter((d) => d.element.open)).toHaveLength(0)
      // Aucun paramètre du tout : le routeur GARDE la main (son `{ top: 0 }` s'applique).
      // GuideView qui défilerait quand même lui disputerait la position d'arrivée.
      expect(espionSiv).not.toHaveBeenCalled()
      expect(espionScrollTo).not.toHaveBeenCalled()
    } finally {
      espionSiv.mockRestore()
      espionScrollTo.mockRestore()
    }
  })
})
