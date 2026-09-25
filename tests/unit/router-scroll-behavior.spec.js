// @vitest-environment jsdom
// Sans `scrollBehavior`, vue-router ne remet pas le défilement à zéro entre deux écrans : un
// scrollY hérité fait « coller » l'AppHeader sticky PAR-DESSUS le premier contenu de l'écran
// d'arrivée.
import { describe, it, expect } from 'vitest'
import router from '@/router'
import { GUIDE_SECTION_BIBLIOTHEQUE } from '@/constants/guide-sections'

// Ces trois arguments sont ceux que vue-router passe RÉELLEMENT (route, route, position ou
// `null`) : la fonction lit la destination (cas du guide), un `undefined` ferait échouer ces
// tests pour une raison qui n'existe pas en production.
const versEcran = (name, query = {}) => ({ name, query })

describe('router — scrollBehavior remet en haut à chaque navigation', () => {
  it('sans position sauvegardée (navigation avant, pas retour arrière) : remonte en haut', () => {
    expect(router.options.scrollBehavior(versEcran('needle-gauge'), versEcran('home'), null)).toEqual({ top: 0 })
  })

  it('avec une position sauvegardée (retour arrière navigateur) : la restaure au lieu de forcer le haut', () => {
    const saved = { top: 266, left: 0 }
    expect(router.options.scrollBehavior(versEcran('needle-gauge'), versEcran('home'), saved)).toBe(saved)
  })
})

// Le guide ouvert sur une section défile lui-même : le routeur (appelé APRÈS le montage)
// doit rendre la main, sinon son `{ top: 0 }` le ramène en haut.
//
// Ces tests ne prouvent PAS que l'écran défile, seulement le contrat de cette fonction. La
// position réellement atteinte se mesure dans tests/e2e/guide-section-cible.spec.js.
describe('router — scrollBehavior laisse la main au guide ouvert sur une section', () => {
  it('/guide?section=<id> : ne défile pas lui-même (`false`), GuideView s en charge', () => {
    const to = versEcran('guide', { section: GUIDE_SECTION_BIBLIOTHEQUE })
    expect(router.options.scrollBehavior(to, versEcran('library'), null)).toBe(false)
  })

  it('… SAUF au retour arrière : une position sauvegardée passe AVANT l exception du guide', () => {
    // CAS CROISÉ, il fixe une PRÉCÉDENCE qu'aucun autre test de ce fichier ne verrait inversée :
    // revenir en arrière sur le guide rend la page là où on l'avait laissée, pas sur la section de
    // l'URL. Le commentaire de src/router/index.js en dépend : c'est SEULEMENT sans position
    // sauvegardée que GuideView devient responsable de la position d'arrivée.
    const saved = { top: 412, left: 0 }
    const to = versEcran('guide', { section: GUIDE_SECTION_BIBLIOTHEQUE })
    expect(router.options.scrollBehavior(to, versEcran('library'), saved)).toBe(saved)
  })

  it('le guide SANS paramètre garde le comportement commun : remonte en haut', () => {
    expect(router.options.scrollBehavior(versEcran('guide'), versEcran('home'), null)).toEqual({ top: 0 })
  })

  it('un `section` vide ne suffit pas à rendre la main (rien à viser)', () => {
    expect(router.options.scrollBehavior(versEcran('guide', { section: '' }), versEcran('home'), null)).toEqual({
      top: 0,
    })
  })

  it('un `section` répété (?section=a&section=b, donc un tableau) ne rend pas la main non plus', () => {
    // vue-router rend un TABLEAU quand un paramètre apparaît deux fois dans l'URL. GuideView
    // ignore ce cas (`typeof cible !== 'string'`) et ne défile donc nulle part : le routeur
    // doit garder la main, sinon l'écran hériterait du scrollY du précédent.
    const to = versEcran('guide', { section: ['section-4', 'section-5'] })
    expect(router.options.scrollBehavior(to, versEcran('home'), null)).toEqual({ top: 0 })
  })
})

// Le lecteur ouvert sur une section (`?section=<id>` sur `/project/:id/read` et
// `/pattern/:id/read`) défile LUI-MÊME, comme le guide : le routeur rend la main, sinon son
// `{ top: 0 }` écrase les défilements du sommaire. L'exception est bornée à guide + lecteur :
// toute autre route portant un `?section=` qu'elle n'exploite pas garde la remise en haut.
describe('router — scrollBehavior laisse la main au lecteur ouvert sur une section', () => {
  it('project-read?section=<id> : ne défile pas lui-même (`false`), ReaderView s en charge', () => {
    const to = versEcran('project-read', { section: 'abc' })
    expect(router.options.scrollBehavior(to, versEcran('project'), null)).toBe(false)
  })

  it('pattern-read?section=<id> : pareil (même ReaderView, contexte aperçu)', () => {
    const to = versEcran('pattern-read', { section: 'abc' })
    expect(router.options.scrollBehavior(to, versEcran('pattern'), null)).toBe(false)
  })

  it('le lecteur SANS `?section=` garde le comportement commun : remonte en haut', () => {
    expect(router.options.scrollBehavior(versEcran('project-read'), versEcran('project'), null)).toEqual({ top: 0 })
    expect(router.options.scrollBehavior(versEcran('pattern-read'), versEcran('pattern'), null)).toEqual({ top: 0 })
  })

  it('un `section` vide, ou répété (tableau), ne suffit pas à rendre la main', () => {
    expect(router.options.scrollBehavior(versEcran('project-read', { section: '' }), versEcran('project'), null)).toEqual({
      top: 0,
    })
    expect(
      router.options.scrollBehavior(versEcran('pattern-read', { section: ['a', 'b'] }), versEcran('pattern'), null),
    ).toEqual({ top: 0 })
  })

  it('… SAUF au retour arrière : une position sauvegardée passe AVANT l exception du lecteur', () => {
    // Même précédence que pour le guide (cas croisé mesuré plus haut) : revenir sur le
    // lecteur doit rendre la page là où la lectrice l'avait laissée, pas la repositionner
    // sur la section de l'URL. savedPosition reste premier dans l'ordre des conditions.
    const saved = { top: 640, left: 0 }
    const to = versEcran('project-read', { section: 'abc' })
    expect(router.options.scrollBehavior(to, versEcran('project'), saved)).toBe(saved)
  })

  it('une AUTRE route portant un `section` garde le comportement commun', () => {
    // L'exception reste bornée à guide + lecteur : ici l'aperçu patron avec un `?section=`
    // qu'elle n'exploite pas — la remise en haut doit s'appliquer.
    const to = versEcran('pattern', { section: 'abc' })
    expect(router.options.scrollBehavior(to, versEcran('home'), null)).toEqual({ top: 0 })
  })
})
