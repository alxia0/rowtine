// Sans `scrollBehavior`, vue-router NE remet PAS le défilement à zéro entre deux écrans
// (navigation client-side) : le scrollY d'un écran quitté « scrollé » survit à l'écran
// suivant. Comme AppHeader est `position: sticky` sans espace de respiration au-dessus du
// 1er contenu (ex. NeedleGaugeView, ses toggles Tricot/Crochet juste sous le bandeau), un
// scrollY hérité > 0 fait immédiatement « coller » le bandeau PAR-DESSUS ce contenu dès
// l'arrivée — retour terrain du 22/07 (« le haut est déjà caché sous le titre de l'écran »).
import { describe, it, expect } from 'vitest'
import router from '@/router'
import { GUIDE_SECTION_BIBLIOTHEQUE } from '@/constants/guide-sections'

// ⚠️ Ces trois arguments sont ceux que vue-router passe RÉELLEMENT (une route résolue, une
// route résolue, une position ou `null`). Jusqu'au 19/08/2026 ce fichier passait `undefined`
// pour la destination : la fonction ne la lisait pas encore. Elle la lit désormais (cas du
// guide, plus bas), et un `undefined` ferait échouer ces tests pour une raison qui n'existe
// pas en production. On donne donc de vraies destinations.
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

// Correctif du 19/08/2026 — le guide ouvert sur une section défilait tout seul, puis le
// `{ top: 0 }` ci-dessus le ramenait en haut (vue-router appelle `scrollBehavior` APRÈS le
// montage, cf. le commentaire de src/router/index.js). Le routeur doit donc rendre la main.
//
// ⚠️ CES TESTS NE PROUVENT PAS QUE L'ÉCRAN DÉFILE. Ils ne vérifient que le contrat de cette
// fonction (« qui décide de la position d'arrivée »). La position RÉELLEMENT atteinte se
// mesure dans un vrai navigateur : tests/e2e/guide-section-cible.spec.js.
describe('router — scrollBehavior laisse la main au guide ouvert sur une section', () => {
  it('/guide?section=<id> : ne défile pas lui-même (`false`), GuideView s en charge', () => {
    const to = versEcran('guide', { section: GUIDE_SECTION_BIBLIOTHEQUE })
    expect(router.options.scrollBehavior(to, versEcran('library'), null)).toBe(false)
  })

  it('… SAUF au retour arrière : une position sauvegardée passe AVANT l exception du guide', () => {
    // CAS CROISÉ, et il fixe une PRÉCÉDENCE : les deux conditions de `scrollBehavior` se
    // recouvrent ici, et les intervertir ne fait rougir aucun autre test de ce fichier
    // (mesuré). Le comportement voulu est celui du navigateur : revenir en arrière sur le
    // guide doit rendre la page là où on l'avait laissée, pas la repositionner sur la
    // section de l'URL — sinon un aller-retour effacerait le défilement de la lectrice.
    // ⚠️ Le commentaire de src/router/index.js dépend de cette précédence : c'est SEULEMENT
    // sans position sauvegardée que GuideView devient responsable de la position d'arrivée.
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

// Extension du 31/08/2026 — le lecteur ouvert sur une section (`/project/:id/read` et
// `/pattern/:id/read` portant `?section=<id>`) souffre du MÊME défaut que le guide d'alors :
// ReaderView défile LUI-MÊME (montage en nextTick ; sommaire goToSection après router.push),
// mais le `{ top: 0 }` du routeur — exécuté après le montage en microtask nextTick —
// écrasait ces défilements : les liens du sommaire ne défilaient pas.
// Le `scrollBehavior` rend donc la main comme pour
// le guide ; le repli « section devenue introuvable » reste dans ReaderView.
//
// ⚠️ Ce bloc RENVERSE le test qui fermait ce fichier (« un AUTRE écran portant un `section`
// (le lecteur) garde le comportement commun » → `{ top: 0 }`) : ce contrat d'alors est
// précisément ce que le correctif du 31/08 corrige. L'exception reste Bornée à guide + lecteur :
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
