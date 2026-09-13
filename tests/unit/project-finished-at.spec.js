// Unitaire — le lien bidirectionnel entre le statut « Terminé » et la date de fin (§7bis).
// Règle en une phrase : UNE VALEUR EXPLICITEMENT SAISIE L'EMPORTE TOUJOURS SUR UNE VALEUR DÉDUITE.
// Les deux fonctions raisonnent sur des TRANSITIONS, pas sur des valeurs : le formulaire
// d'édition envoie TOUJOURS les deux champs, y compris quand aucun des deux n'a bougé.
import { describe, it, expect } from 'vitest'
import { finishedAtPatch, shouldDeriveDone } from '@/utils/project-finished-at'

const AUJOURDHUI = '2026-08-10'

describe('règle 1 — le statut renseigne la date', () => {
  it('ligne 1 : En cours sans date → Terminé ⇒ date = aujourd’hui', () => {
    const before = { status: 'wip', finishedAt: '' }
    expect(finishedAtPatch(before, { status: 'done', finishedAt: '' }, AUJOURDHUI))
      .toEqual({ finishedAt: AUJOURDHUI })
  })

  it('un patch qui ne porte PAS de finishedAt (tuile de l’Accueil, fiche projet) déclenche la règle', () => {
    expect(finishedAtPatch({ status: 'wip', finishedAt: '' }, { status: 'done' }, AUJOURDHUI))
      .toEqual({ finishedAt: AUJOURDHUI })
  })

  it('ligne 3 : Terminé ET date saisie dans le MÊME enregistrement ⇒ la saisie gagne', () => {
    // Sans cette préséance, la date tapée disparaîtrait sous les doigts de l'utilisatrice.
    expect(finishedAtPatch({ status: 'wip', finishedAt: '' }, { status: 'done', finishedAt: '2026-07-15' }, AUJOURDHUI))
      .toBeNull()
  })

  it('ligne 4 : déjà Terminé, date corrigée ⇒ AUCUNE réécriture', () => {
    expect(finishedAtPatch({ status: 'done', finishedAt: '2026-07-15' }, { status: 'done', finishedAt: '2026-07-20' }, AUJOURDHUI))
      .toBeNull()
  })

  it('ligne 5 : Terminé → En cours ⇒ la date est CONSERVÉE (on ne supprime pas de la donnée)', () => {
    expect(finishedAtPatch({ status: 'done', finishedAt: '2026-07-15' }, { status: 'wip', finishedAt: '2026-07-15' }, AUJOURDHUI))
      .toBeNull()
  })

  it('RE-terminer un projet rouvert réécrit la date — c’est la date de la DERNIÈRE clôture', () => {
    // La première version disait « seulement si le champ est vide » : un projet
    // terminé, rouvert, re-terminé aurait gardé la date de sa PREMIÈRE clôture, et la tuile
    // « projets terminés » l'aurait rangé dans la mauvaise fenêtre sans que rien n'alerte.
    expect(finishedAtPatch({ status: 'wip', finishedAt: '2026-07-15' }, { status: 'done', finishedAt: '2026-07-15' }, AUJOURDHUI))
      .toEqual({ finishedAt: AUJOURDHUI })
  })

  it('un patch sans statut (renommage, photos, lastWorkedAt) ne touche à rien', () => {
    expect(finishedAtPatch({ status: 'wip', finishedAt: '' }, { name: 'Châle' }, AUJOURDHUI)).toBeNull()
    expect(finishedAtPatch({ status: 'done', finishedAt: '' }, { lastWorkedAt: 'x' }, AUJOURDHUI)).toBeNull()
  })
})

describe('règle 2 — la date renseignée termine le projet', () => {
  it('ligne 2 : En cours sans date, on saisit le 15/07 ⇒ statut Terminé', () => {
    expect(shouldDeriveDone({ status: 'wip', finishedAt: '' }, { status: 'wip', finishedAt: '2026-07-15' })).toBe(true)
  })

  it('la règle vaut aussi depuis « En pause » et « En attente » (portée assumée, spec §12 point 2)', () => {
    expect(shouldDeriveDone({ status: 'pause', finishedAt: '' }, { status: 'pause', finishedAt: '2026-07-15' })).toBe(true)
    expect(shouldDeriveDone({ status: 'waiting', finishedAt: '' }, { status: 'waiting', finishedAt: '2026-07-15' })).toBe(true)
  })

  it('ligne 6 : EFFACER une date ne « dé-termine » PAS un projet', () => {
    // Sans cela, vider un champ par mégarde rouvrirait un projet clos et le dialogue des
    // pelotes ne serait jamais rejoué.
    expect(shouldDeriveDone({ status: 'done', finishedAt: '2026-07-15' }, { status: 'done', finishedAt: '' })).toBe(false)
  })

  it('une date INCHANGÉE ne termine rien — le formulaire renvoie TOUJOURS les deux champs', () => {
    expect(shouldDeriveDone({ status: 'wip', finishedAt: '2026-07-15' }, { status: 'wip', finishedAt: '2026-07-15' })).toBe(false)
  })

  it('ligne 4 : corriger la date d’un projet DÉJÀ terminé ne déduit rien', () => {
    expect(shouldDeriveDone({ status: 'done', finishedAt: '2026-07-15' }, { status: 'done', finishedAt: '2026-07-20' })).toBe(false)
  })

  it('un projet neuf (aucun état antérieur) créé avec une date est terminé', () => {
    expect(shouldDeriveDone(null, { status: 'wip', finishedAt: '2026-07-15' })).toBe(true)
  })

  it('rouvrir un projet Terminé EN CORRIGEANT sa date dans le même enregistrement laisse le statut à \'wip\' — un statut explicitement changé bat la déduction', () => {
    // Correction (revue ultérieure) : sans la garde `before && patch?.status &&
    // patch.status !== before.status`, ce cas rendait `true` — la pastille « En cours » que
    // l'utilisatrice vient de choisir aurait été écrasée par une déduction « Terminé »,
    // l'inverse exact de la règle en une phrase (une valeur SAISIE l'emporte sur une DÉDUITE).
    expect(shouldDeriveDone({ status: 'done', finishedAt: '2026-07-15' }, { status: 'wip', finishedAt: '2026-07-20' })).toBe(false)
  })

  it('rouvrir un projet Terminé SANS toucher à la date laisse aussi \'wip\' (déjà garanti par le premier garde — date inchangée, pas la nouvelle garde de statut)', () => {
    expect(shouldDeriveDone({ status: 'done', finishedAt: '2026-07-15' }, { status: 'wip', finishedAt: '2026-07-15' })).toBe(false)
  })
})

describe('règle 1 à la CRÉATION — le quatrième chemin', () => {
  it('un projet créé d’emblée en Terminé, sans date, est daté d’aujourd’hui', () => {
    // `create()` ne passe pas par `update()` : sans ce cas, un projet créé en Terminé
    // n'aurait aucune date de fin et serait invisible dans la tuile « projets terminés ».
    expect(finishedAtPatch(null, { status: 'done', finishedAt: '' }, AUJOURDHUI))
      .toEqual({ finishedAt: AUJOURDHUI })
  })

  it('un projet créé en Terminé AVEC une date garde la date saisie', () => {
    expect(finishedAtPatch(null, { status: 'done', finishedAt: '2026-07-15' }, AUJOURDHUI)).toBeNull()
  })

  it('un projet créé En cours n’est pas daté', () => {
    expect(finishedAtPatch(null, { status: 'wip', finishedAt: '' }, AUJOURDHUI)).toBeNull()
  })
})
