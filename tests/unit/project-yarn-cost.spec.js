// Coût des laines imputées à UN projet (lot « coût total du projet », 08/08). Fonction
// PURE : aucune base, aucun composant — c'est tout l'intérêt de la sortir de la vue.
//
// Deux quantités s'additionnent pour une même laine : ce qui est RÉSERVÉ au projet et ce
// qu'il a DÉJÀ TRICOTÉ. Pas de double comptage possible : `consumeProjectReservation`
// retire la réservation au moment où elle devient consommation (yarn-usage.js).
import { describe, it, expect } from 'vitest'
import { projectYarnCost } from '@/utils/purchases'

const PID = 7

describe('projectYarnCost', () => {
  it('1. compte une laine RÉSERVÉE au projet', () => {
    const r = projectYarnCost([{ price: '4,50', reservations: { [PID]: 3 }, consumed: {} }], PID)
    expect(r.amount).toBeCloseTo(13.5, 5)
    expect(r.skeins).toBe(3)
    expect(r.pricedCount).toBe(1)
    expect(r.unknownCount).toBe(0)
  })

  it('2. compte une laine DÉJÀ TRICOTÉE (un projet terminé garde son coût)', () => {
    const r = projectYarnCost([{ price: '4', reservations: {}, consumed: { [PID]: 2 } }], PID)
    expect(r.amount).toBeCloseTo(8, 5)
    expect(r.skeins).toBe(2)
  })

  it('3. additionne réservé ET tricoté sur la MÊME laine, sans laisser fuir une laine d\'un AUTRE projet', () => {
    // Constat de revue (08/08) : aucun test n'exerçait réservé + tricoté + un AUTRE projet
    // dans le même appel — l'isolation entre projets ne tenait que sur le test 4, dont
    // l'assertion de la fiche (ProjectDetailView.spec.js, bloc « coût du projet ») s'est révélée morte.
    const r = projectYarnCost(
      [
        { price: '2', reservations: { [PID]: 1 }, consumed: { [PID]: 4 } },
        { price: '100', reservations: { 99: 2 }, consumed: { 99: 3 } },
      ],
      PID,
    )
    expect(r.amount).toBeCloseTo(10, 5)
    expect(r.skeins).toBe(5)
  })

  it('4. IGNORE une laine réservée par un AUTRE projet', () => {
    // Mutation qui doit faire rougir ce test : retirer le filtrage par projet (sommer tout
    // le stock). Sans lui, une implémentation qui compte tout passerait les tests 1 à 3.
    const r = projectYarnCost([{ price: '100', reservations: { 99: 5 }, consumed: { 42: 2 } }], PID)
    expect(r.amount).toBe(0)
    expect(r.skeins).toBe(0)
    expect(r.pricedCount).toBe(0)
  })

  it('5. prix VIDE : la laine est comptée en pelotes, mais son prix est INCONNU', () => {
    const r = projectYarnCost([{ price: '', reservations: { [PID]: 3 }, consumed: {} }], PID)
    expect(r.amount).toBe(0)
    expect(r.skeins).toBe(3)
    expect(r.unknownCount).toBe(1)
    expect(r.pricedCount).toBe(0)
  })

  it('6. prix « 0 » : un prix DÉCLARÉ, jamais un prix manquant', () => {
    // Mutation qui doit faire rougir ce test : traiter '0' comme une chaîne vide (par
    // exemple via un `if (!parseDecimal(raw))`). C'est l'arbitrage du lot du 07/08 :
    // « j'ai vérifié, c'était offert » n'est pas « je n'ai rien noté ».
    const r = projectYarnCost([{ price: '0', reservations: { [PID]: 3 }, consumed: {} }], PID)
    expect(r.amount).toBe(0)
    expect(r.pricedCount).toBe(1)
    expect(r.unknownCount).toBe(0)
  })

  it('7. lit un prix à VIRGULE française et cumule plusieurs laines', () => {
    const r = projectYarnCost(
      [
        { price: '3,70', reservations: { [PID]: 1 }, consumed: {} },
        { price: '4', reservations: { [PID]: 2 }, consumed: {} },
      ],
      PID,
    )
    // 3,70 + 8 = 11,70 — un `Number('3,70')` rendrait NaN et ferait tomber ce test.
    expect(r.amount).toBeCloseTo(11.7, 5)
    expect(r.skeins).toBe(3)
    expect(r.pricedCount).toBe(2)
  })

  it('8. projectId absent ou invalide : tout à zéro, aucune exception', () => {
    const yarns = [{ price: '5', reservations: { 0: 3 }, consumed: {} }]
    for (const bad of [null, undefined, '', 0, NaN]) {
      const r = projectYarnCost(yarns, bad)
      expect(r).toEqual({ amount: 0, skeins: 0, unknownCount: 0, pricedCount: 0 })
    }
    expect(projectYarnCost(null, PID).skeins).toBe(0)
  })
})
