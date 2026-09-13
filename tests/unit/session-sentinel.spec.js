// La valeur de la sentinelle de section est un CONTRAT AVEC LES DONNÉES DÉJÀ ENREGISTRÉES,
// pas un détail d'implémentation : toutes les séances déjà en base, et dans les sauvegardes
// des appareils, portent `sectionId: 0` pour « aucune section ». La changer orphelinerait
// ces séances en silence — elles ne seraient plus reconnues comme des séances hors section.
// Ce test existe pour qu'un « nettoyage » de constante ne puisse pas le faire sans le voir.
import { describe, it, expect } from 'vitest'
import { SESSION_NO_SECTION } from '@/constants/session'

describe('SESSION_NO_SECTION', () => {
  it('vaut 0, la valeur que portent les séances déjà enregistrées', () => {
    expect(SESSION_NO_SECTION).toBe(0)
  })
})
