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
  maxConsumptionFor,
  reservedByOthers,
  adjustProjectConsumption,
  isProjectVegan,
  roundSkeins,
} from '@/utils/yarn-usage'

describe('roundSkeins', () => {
  it('arrondit à deux décimales, sans traîne binaire', () => {
    expect(roundSkeins(0.1 + 0.2)).toBe(0.3)
  })
})

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
  it('soustraction à dixièmes sans traîne binaire (1,1 - 0,2)', () => {
    const y = { quantity: 1.1, reservations: { 2: 0.2 } }
    expect(availableForProject(y, 1)).toBe(0.9)
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
  it('réserve une demi et une deux et demi pelotes : la fraction est conservée', () => {
    const y = { quantity: 5, reservations: {} }
    expect(setProjectReservation(y, 1, 0.5)).toEqual({ 1: 0.5 })
    expect(setProjectReservation(y, 1, 2.5)).toEqual({ 1: 2.5 })
  })
  it('borne au disponible décimal (autre projet à 2 sur un total de 2,5 → 0,5 dispo)', () => {
    const y = { quantity: 2.5, reservations: { 2: 2 } }
    expect(setProjectReservation(y, 1, 99)).toEqual({ 2: 2, 1: 0.5 })
  })
  it('dispo issu d une soustraction à traîne binaire (1,1 - 0,2) : arrondi à 0,9 pile', () => {
    const y = { quantity: 1.1, reservations: { 2: 0.2 } }
    expect(setProjectReservation(y, 1, 99)).toEqual({ 2: 0.2, 1: 0.9 })
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
  it('somme à dixièmes sans traîne binaire (0,1 + 0,7 = 0,8 pile) : deux projets terminés → utilisée', () => {
    const y = { quantity: 0.8, reservations: { 1: 0.1, 2: 0.7 } }
    expect(yarnUsageState(y, { 1: done, 2: done })).toEqual({ state: 'used', used: 0.8, total: 0.8 })
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
  it('stock décimal : la fraction de pelote n est jamais perdue', () => {
    const yarn = { quantity: 2.5, reservations: { 7: 2 }, consumed: {} }
    expect(consumeProjectReservation(yarn, 7, 2).quantity).toBe(0.5)
    expect(consumeProjectReservation(yarn, 7, 0).quantity).toBe(2.5)
  })
  it('rien tricoté (0) → tout retourne au stock, aucune trace', () => {
    expect(consumeProjectReservation(base(), 1, 0)).toEqual({ quantity: 5, reservations: {}, consumed: {} })
  })
  it('used au-dessus du réservé : accepté jusqu au stock (réservé 3, stock 10, used 5)', () => {
    const y = { quantity: 10, reservations: { 1: 3 }, consumed: {} }
    expect(consumeProjectReservation(y, 1, 5)).toEqual({ quantity: 5, reservations: {}, consumed: { 1: 5 } })
  })
  it('borne au stock : on ne consomme jamais plus que ce qui existe (réservé 3, stock 4, used 9)', () => {
    const y = { quantity: 4, reservations: { 1: 3 }, consumed: {} }
    expect(consumeProjectReservation(y, 1, 9)).toEqual({ quantity: 0, reservations: {}, consumed: { 1: 4 } })
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
  it('consomme 2,5 sur 3 réservées : trace décimale, reliquat décimal', () => {
    const y = { quantity: 5, reservations: { 1: 3 }, consumed: {} }
    expect(consumeProjectReservation(y, 1, 2.5)).toEqual({ quantity: 2.5, reservations: {}, consumed: { 1: 2.5 } })
  })
  it('consomme 2,1 sur 2,3 : 0,2 pile, sans traîne binaire (2.3 - 2.1)', () => {
    const y = { quantity: 2.3, reservations: { 1: 2.3 }, consumed: {} }
    expect(consumeProjectReservation(y, 1, 2.1).quantity).toBe(0.2)
  })
  // Régression (revue finale) : le plafond était le stock TOTAL, donc A pouvait prendre les
  // pelotes réservées par B. Le stock tombait sous ce que B réservait encore, et la clôture de
  // B était ensuite tronquée à 0 sans aucune trace. Le plafond est ce qui est DISPONIBLE pour
  // ce projet : sa propre réservation plus le stock libre.
  it('stock 5, A réserve 2, B réserve 3 : A ne peut pas prendre les pelotes de B (plafond 2)', () => {
    const y = { quantity: 5, reservations: { 1: 2, 2: 3 }, consumed: {} }
    const apresA = consumeProjectReservation(y, 1, 5)
    expect(apresA).toEqual({ quantity: 3, reservations: { 2: 3 }, consumed: { 1: 2 } })
    // B garde de quoi clore : ses 3 pelotes existent encore, et sa trace est écrite.
    expect(consumeProjectReservation({ ...y, ...apresA }, 2, 3)).toEqual({ quantity: 0, reservations: {}, consumed: { 1: 2, 2: 3 } })
  })
  it('stock libre en plus de la réservation : plafond = réservation + libre (réservé 2, autre 3, stock 7 → 4)', () => {
    const y = { quantity: 7, reservations: { 1: 2, 2: 3 }, consumed: {} }
    expect(consumeProjectReservation(y, 1, 9)).toEqual({ quantity: 3, reservations: { 2: 3 }, consumed: { 1: 4 } })
  })
})

describe('maxConsumptionFor', () => {
  it('déjà tricoté + stock restant', () => {
    expect(maxConsumptionFor({ quantity: 4, consumed: { 1: 5 } }, 1)).toBe(9)
  })
  it('aucune trace pour ce projet : le stock seul', () => {
    expect(maxConsumptionFor({ quantity: 4, consumed: { 2: 5 } }, 1)).toBe(4)
  })
  it('pas de traîne binaire', () => {
    expect(maxConsumptionFor({ quantity: 0.2, consumed: { 1: 0.1 } }, 1)).toBe(0.3)
  })
  // Même régression que consumeProjectReservation : après coup, A ne prend pas non plus les
  // pelotes que B réserve encore.
  it('A a tricoté 2, il reste 3 pelotes toutes réservées par B : plafond 2, pas 5', () => {
    expect(maxConsumptionFor({ quantity: 3, reservations: { 2: 3 }, consumed: { 1: 2 } }, 1)).toBe(2)
  })
  it('stock libre en plus des réservations des autres : déjà tricoté + libre', () => {
    expect(maxConsumptionFor({ quantity: 4, reservations: { 2: 1 }, consumed: { 1: 2 } }, 1)).toBe(5)
  })
  // La réservation propre du projet est du stock déjà « à lui » : le compter en plus dans le
  // plafond le faisait doubler (5 en stock, 2 réservées, 3 tricotées : 6 et non 3 + 5 = 8).
  it('réservation propre déduite du plafond : quantity 5, réservé 2, tricoté 3 donne 6', () => {
    expect(maxConsumptionFor({ quantity: 5, reservations: { 1: 2 }, consumed: { 1: 3 } }, 1)).toBe(6)
  })
  it('sans réservation propre : inchangé, 8', () => {
    expect(maxConsumptionFor({ quantity: 5, consumed: { 1: 3 } }, 1)).toBe(8)
  })
  it('réservation d\'un autre projet : plafond déjà en place, 6', () => {
    expect(maxConsumptionFor({ quantity: 5, reservations: { 2: 2 }, consumed: { 1: 3 } }, 1)).toBe(6)
  })
  it('réservation propre supérieure au disponible : plancher 0, pas de plafond négatif', () => {
    expect(maxConsumptionFor({ quantity: 2, reservations: { 1: 2, 2: 1 }, consumed: { 1: 3 } }, 1)).toBe(3)
  })
})

describe('reservedByOthers', () => {
  it('somme des réservations des autres projets', () => {
    expect(reservedByOthers({ reservations: { 1: 2, 2: 1.5 } }, 1)).toBe(1.5)
  })
  it('projet absent : toutes les réservations comptent', () => {
    expect(reservedByOthers({ reservations: { 1: 2, 2: 1.5 } }, 9)).toBe(3.5)
  })
  it('aucune réservation : 0', () => {
    expect(reservedByOthers({ quantity: 4 }, 1)).toBe(0)
  })
  it('pas de traîne binaire', () => {
    expect(reservedByOthers({ reservations: { 2: 0.1, 3: 0.2 } }, 1)).toBe(0.3)
  })
})

describe('adjustProjectConsumption', () => {
  const y = (over = {}) => ({ quantity: 7, reservations: {}, consumed: { 1: 3 }, ...over })
  it('hausse 3 → 5 (stock 7) : quantity 5, consumed 5', () => {
    expect(adjustProjectConsumption(y(), 1, 5)).toEqual({ quantity: 5, consumed: { 1: 5 } })
  })
  it('baisse 5 → 2 : 3 pelotes rendues au stock', () => {
    expect(adjustProjectConsumption(y({ quantity: 1, consumed: { 1: 5 } }), 1, 2)).toEqual({ quantity: 4, consumed: { 1: 2 } })
  })
  it('hausse au-delà (5 → 20, stock 4) : bornée à 9', () => {
    expect(adjustProjectConsumption(y({ quantity: 4, consumed: { 1: 5 } }), 1, 20)).toEqual({ quantity: 0, consumed: { 1: 9 } })
  })
  it('nouveau 0 : la clé est retirée de consumed', () => {
    const r = adjustProjectConsumption(y(), 1, 0)
    expect(r).toEqual({ quantity: 10, consumed: {} })
    expect(r.consumed).not.toHaveProperty('1')
  })
  it('négatif : traité comme 0', () => {
    expect(adjustProjectConsumption(y(), 1, -4)).toEqual({ quantity: 10, consumed: {} })
  })
  it('ne touche jamais aux autres projets', () => {
    const r = adjustProjectConsumption(y({ consumed: { 1: 3, 2: 1.5 } }), 1, 5)
    expect(r.consumed).toEqual({ 1: 5, 2: 1.5 })
  })
  it('ancien 0,1 + écart 0,2 : pas de 0.30000000000000004', () => {
    const r = adjustProjectConsumption({ quantity: 1, consumed: { 1: 0.1 } }, 1, 0.3)
    expect(r.consumed[1]).toBe(0.3)
    expect(r.quantity).toBe(0.8)
  })
  it('appliquer deux fois la même valeur = une fois', () => {
    const start = y()
    const once = adjustProjectConsumption(start, 1, 5)
    const twice = adjustProjectConsumption({ ...start, ...once }, 1, 5)
    expect(twice).toEqual(once)
  })
  it('laine à stock 0 avec trace, baisse : stock rendu, plus « Utilisée »', () => {
    const start = { quantity: 0, reservations: {}, consumed: { 1: 5 } }
    const r = adjustProjectConsumption(start, 1, 2)
    expect(r.quantity).toBe(3)
    expect(yarnUsageState({ ...start, ...r }, {}).state).not.toBe('used')
  })
  it('newUsed NaN : patch identique à l’état actuel', () => {
    expect(adjustProjectConsumption(y(), 1, NaN)).toEqual({ quantity: 7, consumed: { 1: 3 } })
    expect(adjustProjectConsumption(y(), 1, 'abc')).toEqual({ quantity: 7, consumed: { 1: 3 } })
  })
  it('ne mute pas la laine d’origine', () => {
    const start = y()
    adjustProjectConsumption(start, 1, 5)
    expect(start).toEqual(y())
  })
  it('stock 3 entièrement réservé par B : A (2 tricotées) ne monte pas au-delà de 2, le stock de B reste entier', () => {
    const start = { quantity: 3, reservations: { 2: 3 }, consumed: { 1: 2 } }
    expect(adjustProjectConsumption(start, 1, 5)).toEqual({ quantity: 3, consumed: { 1: 2 } })
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
  // Protège : terminer une allocation ne touche pas aux échantillons, et la laine épuisée garde sa fiche.
  it('terminer l’allocation ne touche pas aux échantillons', () => {
    const swatch = { id: 's1' }
    const yarn = { quantity: 1, reservations: { 1: 1 }, consumed: {}, swatches: [swatch] }
    expect(consumeProjectReservation(yarn, 1, 1)).not.toHaveProperty('swatches')
    expect(yarnUsageState({ ...yarn, quantity: 0, consumed: { 1: 1 } }, {})).toEqual({ state: 'used', used: 0, total: 0 })
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
