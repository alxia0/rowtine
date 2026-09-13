import { describe, it, expect } from 'vitest'
import {
  normalizeYarnReservations,
  reservationsOf,
  reservedTotal,
  yarnAvailable,
  availableForProject,
  setProjectReservation,
  yarnUsageState,
  consumedOf,
  consumeProjectReservation,
  isProjectVegan,
} from '@/utils/yarn-usage'

describe('normalizeYarnReservations — migration ancien modèle', () => {
  it('ancien format réservé → map { projet: qté } + trace de consommation vide', () => {
    expect(normalizeYarnReservations({ quantity: 5, reservedFor: 7, reservedQty: 2 })).toEqual({ reservations: { 7: 2 }, consumed: {} })
  })
  it('ancien format sans reservedQty → toutes les pelotes', () => {
    expect(normalizeYarnReservations({ quantity: 5, reservedFor: 7 })).toEqual({ reservations: { 7: 5 }, consumed: {} })
  })
  it('ancien format libre → map vide', () => {
    expect(normalizeYarnReservations({ quantity: 5, reservedFor: null })).toEqual({ reservations: {}, consumed: {} })
  })
  it('déjà migré (reservations ET consumed) → null (idempotent, rien à faire)', () => {
    expect(normalizeYarnReservations({ quantity: 5, reservations: { 7: 2 }, consumed: {} })).toBe(null)
    expect(normalizeYarnReservations({ quantity: 5, reservations: {}, consumed: {} })).toBe(null)
  })
  it('le piège : laine migrée par la version précédente (reservations SANS consumed) → re-migrée une fois pour gagner consumed, sans toucher reservations', () => {
    expect(normalizeYarnReservations({ quantity: 5, reservations: { 7: 2 } })).toEqual({ consumed: {} })
  })
  it('reservedQty négatif → lien conservé, quantité repliée sur le total', () => {
    expect(normalizeYarnReservations({ quantity: 5, reservedFor: 7, reservedQty: -1 })).toEqual({ reservations: { 7: 5 }, consumed: {} })
  })
  it('reservedQty à 0 explicite → lien conservé, quantité repliée sur le total', () => {
    expect(normalizeYarnReservations({ quantity: 5, reservedFor: 7, reservedQty: 0 })).toEqual({ reservations: { 7: 5 }, consumed: {} })
  })
  it('reservedQty illisible et quantity absente → lien conservé avec 1', () => {
    expect(normalizeYarnReservations({ reservedFor: 7, reservedQty: 'x' })).toEqual({ reservations: { 7: 1 }, consumed: {} })
  })
  it('quantity négative → jamais de quantité négative', () => {
    expect(normalizeYarnReservations({ quantity: -3, reservedFor: 7 })).toEqual({ reservations: { 7: 1 }, consumed: {} })
  })
})

describe('reservationsOf / reservedTotal / yarnAvailable', () => {
  it('lit le nouveau format et nettoie les entrées invalides', () => {
    expect(reservationsOf({ reservations: { 1: 2, 2: 0, 3: -1, x: 4 } })).toEqual({ 1: 2 })
  })
  it('tolère l’ancien format en lecture', () => {
    expect(reservationsOf({ quantity: 5, reservedFor: 7, reservedQty: 2 })).toEqual({ 7: 2 })
  })
  it('total réservé et disponible', () => {
    const y = { quantity: 5, reservations: { 1: 2, 2: 1 } }
    expect(reservedTotal(y)).toBe(3)
    expect(yarnAvailable(y)).toBe(2)
    expect(yarnAvailable({ quantity: 2, reservations: { 1: 5 } })).toBe(0) // jamais négatif
  })
})

describe('availableForProject', () => {
  it('exclut la propre allocation du projet (elle est en cours d’édition)', () => {
    const y = { quantity: 5, reservations: { 1: 2, 2: 1 } }
    expect(availableForProject(y, 1)).toBe(4) // 5 - (autres = 1)
    expect(availableForProject(y, 2)).toBe(3) // 5 - (autres = 2)
    expect(availableForProject(y, 9)).toBe(2) // projet non lié : 5 - 3
  })
})

describe('setProjectReservation', () => {
  it('n’écrase JAMAIS l’allocation des autres projets', () => {
    const y = { quantity: 5, reservations: { 1: 2, 2: 1 } }
    expect(setProjectReservation(y, 1, 3)).toEqual({ 1: 3, 2: 1 })
  })
  it('qty null → retire seulement l’allocation de ce projet', () => {
    const y = { quantity: 5, reservations: { 1: 2, 2: 1 } }
    expect(setProjectReservation(y, 1, null)).toEqual({ 2: 1 })
  })
  it('ajoute un projet sans toucher l’existant', () => {
    const y = { quantity: 5, reservations: { 1: 2 } }
    expect(setProjectReservation(y, 3, 2)).toEqual({ 1: 2, 3: 2 })
  })
  it('borne au disponible pour ce projet (les autres réservations bloquent)', () => {
    const y = { quantity: 5, reservations: { 2: 4 } }
    expect(setProjectReservation(y, 1, 99)).toEqual({ 2: 4, 1: 1 }) // dispo pour 1 = 5-4 = 1
  })
  it('ne mute pas la laine d’origine', () => {
    const y = { quantity: 5, reservations: { 1: 2 } }
    setProjectReservation(y, 1, 4)
    expect(y.reservations).toEqual({ 1: 2 })
  })
  it('dispo à 0 (tout pris par les autres) → aucune allocation inventée', () => {
    const y = { quantity: 5, reservations: { 2: 5 } }
    expect(setProjectReservation(y, 1, 3)).toEqual({ 2: 5 }) // et surtout PAS { 1: 3, 2: 5 } = 8 pelotes sur 5
  })
  it('dispo à 0 → une allocation existante de ce projet est retirée, pas conservée gonflée', () => {
    const y = { quantity: 5, reservations: { 1: 2, 2: 5 } } // sur-réservé (donnée abîmée)
    expect(setProjectReservation(y, 1, 2)).toEqual({ 2: 5 })
  })
  it('la somme des réservations ne dépasse jamais le total', () => {
    const y = { quantity: 5, reservations: { 2: 4 } }
    const next = setProjectReservation(y, 1, 99)
    expect(Object.values(next).reduce((a, n) => a + n, 0)).toBeLessThanOrEqual(5)
  })
  it('pid absent/invalide → aucune allocation fantôme (projet 0)', () => {
    const y = { quantity: 5, reservations: { 1: 2 } }
    expect(setProjectReservation(y, null, 2)).toEqual({ 1: 2 })
    expect(setProjectReservation(y, '', 2)).toEqual({ 1: 2 })
    expect(setProjectReservation(y, 0, 2)).toEqual({ 1: 2 })
  })
})

describe('yarnUsageState', () => {
  const done = { status: 'done' }
  const wip = { status: 'wip' }
  it('aucune réservation → libre', () => {
    expect(yarnUsageState({ quantity: 5, reservations: {} }, {})).toEqual({ state: 'free', used: 0, total: 5 })
  })
  it('projet en cours, partiel → réservée x/N', () => {
    expect(yarnUsageState({ quantity: 5, reservations: { 1: 2 } }, { 1: wip })).toEqual({ state: 'reserved', used: 2, total: 5 })
  })
  it('projet en cours, tout alloué → réservée', () => {
    expect(yarnUsageState({ quantity: 5, reservations: { 1: 5 } }, { 1: wip })).toEqual({ state: 'reserved', used: 5, total: 5 })
  })
  it('tous les projets terminés, partiel → utilisée partiellement', () => {
    expect(yarnUsageState({ quantity: 5, reservations: { 1: 2 } }, { 1: done })).toEqual({ state: 'usedPartial', used: 2, total: 5 })
  })
  it('tous les projets terminés, tout alloué → utilisée', () => {
    expect(yarnUsageState({ quantity: 5, reservations: { 1: 3, 2: 2 } }, { 1: done, 2: done })).toEqual({ state: 'used', used: 5, total: 5 })
  })
  it('un seul projet non terminé suffit à rester réservée', () => {
    expect(yarnUsageState({ quantity: 5, reservations: { 1: 3, 2: 2 } }, { 1: done, 2: wip })).toEqual({ state: 'reserved', used: 5, total: 5 })
  })
  it('projet lié introuvable → jamais « terminé », repli réservée, pas de plantage', () => {
    expect(yarnUsageState({ quantity: 5, reservations: { 42: 2 } }, {})).toEqual({ state: 'reserved', used: 2, total: 5 })
  })
  it('sur-réservation : used est borné au total', () => {
    expect(yarnUsageState({ quantity: 2, reservations: { 1: 5 } }, { 1: done })).toEqual({ state: 'used', used: 2, total: 2 })
  })
})

describe('consumedOf', () => {
  it('map nettoyée, tolère l’absence du champ', () => {
    expect(consumedOf({ consumed: { 1: 2, 2: 0, x: 3 } })).toEqual({ 1: 2 })
    expect(consumedOf({})).toEqual({})
  })
})

describe('consumeProjectReservation', () => {
  const base = () => ({ quantity: 5, reservations: { 1: 3 }, consumed: {} })
  it('le cas d une utilisatrice : 3 réservées, 2 tricotées → stock 3, reliquat rendu, trace gardée', () => {
    expect(consumeProjectReservation(base(), 1, 2)).toEqual({ quantity: 3, reservations: {}, consumed: { 1: 2 } })
  })
  it('tout tricoté (défaut si on ferme la question)', () => {
    expect(consumeProjectReservation(base(), 1, 3)).toEqual({ quantity: 2, reservations: {}, consumed: { 1: 3 } })
  })
  it('rien tricoté (0) → tout retourne au stock, aucune trace', () => {
    expect(consumeProjectReservation(base(), 1, 0)).toEqual({ quantity: 5, reservations: {}, consumed: {} })
  })
  it('borne au réservé : on ne consomme jamais plus que ce que le projet tenait', () => {
    expect(consumeProjectReservation(base(), 1, 99)).toEqual({ quantity: 2, reservations: {}, consumed: { 1: 3 } })
  })
  it('used négatif → traité comme 0', () => {
    expect(consumeProjectReservation(base(), 1, -5)).toEqual({ quantity: 5, reservations: {}, consumed: {} })
  })
  it('ne touche pas les allocations des AUTRES projets', () => {
    const y = { quantity: 5, reservations: { 1: 2, 2: 1 }, consumed: {} }
    expect(consumeProjectReservation(y, 1, 2)).toEqual({ quantity: 3, reservations: { 2: 1 }, consumed: { 1: 2 } })
  })
  it('cumule sur une trace existante du même projet', () => {
    const y = { quantity: 5, reservations: { 1: 2 }, consumed: { 1: 1 } }
    expect(consumeProjectReservation(y, 1, 2)).toEqual({ quantity: 3, reservations: {}, consumed: { 1: 3 } })
  })
  it('projet non réservataire → rien à consommer, laine inchangée', () => {
    expect(consumeProjectReservation(base(), 9, 2)).toEqual({ quantity: 5, reservations: { 1: 3 }, consumed: {} })
  })
  it('ne mute pas la laine d’origine', () => {
    const y = base()
    consumeProjectReservation(y, 1, 2)
    expect(y).toEqual({ quantity: 5, reservations: { 1: 3 }, consumed: {} })
  })
})

describe('yarnUsageState — laine épuisée par le tricot', () => {
  it('quantité 0 + trace de consommation → « Utilisée » (décision produit : reste au stock en ×0)', () => {
    expect(yarnUsageState({ quantity: 0, reservations: {}, consumed: { 1: 5 } }, {})).toEqual({ state: 'used', used: 0, total: 0 })
  })
  it('reste des pelotes après consommation → « Libre » (le stock ne montre que ce qu’on possède)', () => {
    expect(yarnUsageState({ quantity: 2, reservations: {}, consumed: { 1: 3 } }, {})).toEqual({ state: 'free', used: 0, total: 2 })
  })
  it('quantité 0 SANS consommation → inchangé (pas de fausse trace)', () => {
    expect(yarnUsageState({ quantity: 0, reservations: {}, consumed: {} }, {})).toEqual({ state: 'free', used: 0, total: 0 })
  })
  it('une réservation active prime sur la trace', () => {
    expect(yarnUsageState({ quantity: 4, reservations: { 2: 2 }, consumed: { 1: 1 } }, { 2: { status: 'wip' } }))
      .toEqual({ state: 'reserved', used: 2, total: 4 })
  })
})

// Icône « projet vegan » (ProjectCard, 06/08/2026) : un projet est vegan si TOUTES
// ses laines rattachées — réservées (reservationsOf) OU consommées (consumedOf) — portent
// le label 'vegan' — un projet qui mélange vegan et mérinos n'est pas vegan (décision
// produit). Le volet « consommées » est nécessaire pour les projets Terminés/Abandonnés :
// consumeProjectReservation RETIRE la réservation au moment de la clôture (elle migre dans
// `consumed`), donc sans lui un pull fini perdrait son icône pile en rejoignant la vitrine
// des ouvrages terminés — l'inverse de ce qui est demandé (décision produit, 06/08).
describe('isProjectVegan', () => {
  it('deux laines rattachées, toutes deux vegan → vrai', () => {
    const yarns = [
      { reservations: { 7: 2 }, labels: ['vegan'] },
      { reservations: { 7: 1 }, labels: ['vegan', 'ethique'] },
    ]
    expect(isProjectVegan(7, yarns)).toBe(true)
  })
  it('deux laines rattachées, une seule vegan → faux (mélange = pas vegan)', () => {
    const yarns = [
      { reservations: { 7: 2 }, labels: ['vegan'] },
      { reservations: { 7: 1 }, labels: ['ethique'] },
    ]
    expect(isProjectVegan(7, yarns)).toBe(false)
  })
  it('aucune laine rattachée à ce projet → faux (on ne sait pas, donc on se tait)', () => {
    const yarns = [{ reservations: { 9: 2 }, labels: ['vegan'] }] // rattachée à un AUTRE projet
    expect(isProjectVegan(7, yarns)).toBe(false)
    expect(isProjectVegan(7, [])).toBe(false)
  })
  it('laine rattachée sans champ `labels` du tout (fiche antérieure au lot des caractéristiques) → faux, sans erreur', () => {
    const yarns = [{ reservations: { 7: 2 } }]
    expect(() => isProjectVegan(7, yarns)).not.toThrow()
    expect(isProjectVegan(7, yarns)).toBe(false)
  })
  it('projet Terminé : laine passée en CONSOMMÉE (plus réservée), vegan → vrai — l’icône reste après clôture', () => {
    const yarns = [{ reservations: {}, consumed: { 7: 2 }, labels: ['vegan'] }]
    expect(isProjectVegan(7, yarns)).toBe(true)
  })
  it('projet Terminé : deux laines consommées, une seule vegan → faux (mélange = pas vegan, même clôturé)', () => {
    const yarns = [
      { reservations: {}, consumed: { 7: 2 }, labels: ['vegan'] },
      { reservations: {}, consumed: { 7: 1 }, labels: ['ethique'] },
    ]
    expect(isProjectVegan(7, yarns)).toBe(false)
  })
})
