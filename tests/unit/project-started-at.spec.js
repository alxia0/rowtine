// Unitaire — le lien entre le premier signe d'activité sur un projet et sa date de début.
// Symétrique de project-finished-at.spec.js, mais à sens UNIQUE : `startedAt` ne se pose
// qu'une seule fois (contrairement à `finishedAt`, qui se redate à chaque clôture).
import { describe, it, expect } from 'vitest'
import { startedAtPatch } from '@/utils/project-started-at'

const AUJOURDHUI = '2026-09-12'

describe('startedAtPatch', () => {
  it('projet sans date de début ⇒ date = aujourd’hui', () => {
    expect(startedAtPatch({ startedAt: '' }, AUJOURDHUI)).toEqual({ startedAt: AUJOURDHUI })
  })

  it('projet neuf (aucun état antérieur) ⇒ date = aujourd’hui', () => {
    expect(startedAtPatch(null, AUJOURDHUI)).toEqual({ startedAt: AUJOURDHUI })
  })

  it('une date déjà présente n’est JAMAIS réécrite', () => {
    // Contrairement à finishedAt (qui se redate à chaque clôture), startedAt ne se pose
    // qu'une fois : la première séance de tricot d'un ouvrage ne se reproduit pas.
    expect(startedAtPatch({ startedAt: '2026-01-01' }, AUJOURDHUI)).toBeNull()
  })
})
