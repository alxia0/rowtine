// resolveOpenSyncTarget — résolution pure du { kind, id } à synchroniser (patron.md
// ciblé) à l'ouverture du Lecteur (Lot N3). Cf. src/utils/resolve-open-sync-target.js
// pour la logique de mapping (dossier `Projets/*` vs `Patrons/*`).
import { describe, it, expect } from 'vitest'
import { resolveOpenSyncTarget } from '@/utils/resolve-open-sync-target'

describe('resolveOpenSyncTarget', () => {
  it('contexte projet, patron FORKÉ (ownerProjectId === project.id) → { kind: project, id: projectId }', () => {
    const project = { id: 7, patternId: 42 }
    const pattern = { id: 42, ownerProjectId: 7 }
    expect(resolveOpenSyncTarget({ ctx: 'project', project, pattern })).toEqual({ kind: 'project', id: 7 })
  })

  it('contexte projet, patron de bibliothèque partagé (non forké) → { kind: pattern, id: patternId }', () => {
    const project = { id: 7, patternId: 42 }
    const pattern = { id: 42, ownerProjectId: null }
    expect(resolveOpenSyncTarget({ ctx: 'project', project, pattern })).toEqual({ kind: 'pattern', id: 42 })
  })

  it('contexte bibliothèque (route patron) → { kind: pattern, id }', () => {
    expect(resolveOpenSyncTarget({ ctx: 'library', pattern: { id: 42 } })).toEqual({ kind: 'pattern', id: 42 })
  })

  it('contexte projet sans patron lié → null (rien à synchroniser)', () => {
    expect(resolveOpenSyncTarget({ ctx: 'project', project: { id: 7, patternId: null }, pattern: null })).toBeNull()
  })

  it('contexte projet sans projet pré-chargé (projet introuvable) → null', () => {
    expect(resolveOpenSyncTarget({ ctx: 'project', project: null, pattern: { id: 42, ownerProjectId: null } })).toBeNull()
  })

  it('contexte bibliothèque sans patron → null', () => {
    expect(resolveOpenSyncTarget({ ctx: 'library', pattern: null })).toBeNull()
  })
})
