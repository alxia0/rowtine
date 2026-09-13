// Unitaire — collecte du snapshot de sauvegarde : lit `db`
// (fake-indexeddb) et produit la forme attendue par `backupAll`.
import { describe, it, expect, beforeEach } from 'vitest'
import { db, setSetting } from '@/db/db'
import { collectBackupData } from '@/backup/collect'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('collectBackupData', () => {
  it('embarque sections/counters/sessions/diagrams + instancePattern par projet', async () => {
    await db.projects.bulkAdd([
      { id: 1, name: 'Pull', patternId: 9 },
      { id: 2, name: 'Écharpe' },
    ])
    await db.sections.bulkAdd([
      { id: 10, projectId: 1, name: 'Dos' },
      { id: 11, projectId: 2, name: 'Corps' },
    ])
    await db.counters.bulkAdd([
      { id: 20, projectId: 1, name: 'Rangs' },
      { id: 21, projectId: 0, name: 'Indépendant' }, // compteur indépendant
    ])
    await db.sessions.bulkAdd([{ id: 30, projectId: 1, durationSec: 600 }])
    await db.diagrams.bulkAdd([{ id: 40, projectId: 1, patternId: 9 }])
    // Patron instance du projet 1 (forké — ownerProjectId === project.id)
    await db.patterns.bulkAdd([
      { id: 9, name: 'Torsade', ownerProjectId: 1 },
      { id: 100, name: 'Bibliothèque', ownerProjectId: null },
      { id: 101, name: 'Intégré', ownerProjectId: null, builtin: true },
    ])

    const snapshot = await collectBackupData()

    const p1 = snapshot.projects.find((p) => p.id === 1)
    const p2 = snapshot.projects.find((p) => p.id === 2)
    expect(p1.sections).toEqual([{ id: 10, projectId: 1, name: 'Dos' }])
    expect(p1.counters).toEqual([{ id: 20, projectId: 1, name: 'Rangs' }])
    expect(p1.sessions).toEqual([{ id: 30, projectId: 1, durationSec: 600 }])
    expect(p1.diagrams).toEqual([{ id: 40, projectId: 1, patternId: 9 }])
    expect(p1.instancePattern).toMatchObject({ id: 9, name: 'Torsade' })
    expect(p2.sections).toEqual([{ id: 11, projectId: 2, name: 'Corps' }])
    expect(p2.instancePattern).toBeNull()
  })

  it('inclut les patrons builtin (ex. patron libre) avec les patrons de bibliothèque (ownerProjectId null), pas les instances de projet', async () => {
    await db.patterns.bulkAdd([
      { id: 100, name: 'Bibliothèque', ownerProjectId: null },
      { id: 101, name: 'Intégré', ownerProjectId: null, builtin: true },
      { id: 102, name: 'Instance', ownerProjectId: 5 },
    ])

    const snapshot = await collectBackupData()

    expect(snapshot.libraryPatterns.map((p) => p.id).sort((a, b) => a - b)).toEqual([100, 101])
    // Le flag builtin est préservé dans le JSON sérialisé (S3/ensureFreePattern s'y fie).
    expect(snapshot.libraryPatterns.find((p) => p.id === 101).builtin).toBe(true)
    // Son id fait partie de keepIds.patterns (dossier non réconcilié à tort).
    expect(snapshot.keepIds.patterns).toContain(101)
  })

  it('filtre les compteurs indépendants (projectId === 0), sans dupliquer les compteurs liés à un projet', async () => {
    await db.projects.add({ id: 1, name: 'Pull' })
    await db.counters.bulkAdd([
      { id: 20, projectId: 1, name: 'Rangs' },
      { id: 21, projectId: 0, name: 'Indépendant' },
    ])

    const snapshot = await collectBackupData()

    expect(snapshot.independentCounters).toEqual([{ id: 21, projectId: 0, name: 'Indépendant' }])
  })

  it('renvoie toutes les laines et un objet settings clé→valeur', async () => {
    await db.yarns.bulkAdd([{ id: 1, brand: 'Drops' }])
    await setSetting('onboarded', true)
    await setSetting('lastBackupAt', '2026-01-01T00:00:00.000Z')

    const snapshot = await collectBackupData()

    expect(snapshot.yarns).toEqual([{ id: 1, brand: 'Drops' }])
    expect(snapshot.settings).toMatchObject({ onboarded: true, lastBackupAt: '2026-01-01T00:00:00.000Z' })
  })

  it('keepIds inclut les ids actifs et les ids en corbeille (projet en bundle + patron seul)', async () => {
    await db.projects.add({ id: 1, name: 'Actif' })
    await db.patterns.add({ id: 100, name: 'Bibliothèque actif', ownerProjectId: null })

    // Projet en corbeille — bundle avec instancePattern.
    await db.trash.add({
      type: 'project',
      payload: { project: { id: 2, name: 'Corbeille' }, instancePattern: { id: 9, name: 'Torsade corbeille' } },
      name: 'Corbeille',
      deletedAt: '2026-01-01T00:00:00.000Z',
    })
    // Patron en corbeille — payload direct.
    await db.trash.add({
      type: 'pattern',
      payload: { id: 200, name: 'Patron corbeille' },
      name: 'Patron corbeille',
      deletedAt: '2026-01-01T00:00:00.000Z',
    })

    const snapshot = await collectBackupData()

    expect(snapshot.keepIds.projects.sort((a, b) => a - b)).toEqual([1, 2])
    // Le patron d'instance du projet en corbeille (bundle) est aussi préservé —
    // il vit sous Projets/, mais on le garde par prudence dans keepIds.patterns.
    expect(snapshot.keepIds.patterns.sort((a, b) => a - b)).toEqual([9, 100, 200])
  })

  it('tolère aussi un payload projet nu (sans enveloppe bundle) dans la corbeille, comme trash.js/restore', async () => {
    await db.trash.add({
      type: 'project',
      payload: { id: 5, name: 'Nu' }, // pas de { project: {...} } — cf. fallback de restore()
      name: 'Nu',
      deletedAt: '2026-01-01T00:00:00.000Z',
    })

    const snapshot = await collectBackupData()

    expect(snapshot.keepIds.projects).toContain(5)
  })

  it('expose trashIds (ids en corbeille SEULEMENT, pas les actifs) pour projets et patrons', async () => {
    await db.projects.add({ id: 1, name: 'Actif' })
    await db.patterns.add({ id: 100, name: 'Bibliothèque actif', ownerProjectId: null })

    await db.trash.add({
      type: 'project',
      payload: { project: { id: 2, name: 'Corbeille' }, instancePattern: { id: 9, name: 'Torsade corbeille' } },
      name: 'Corbeille',
      deletedAt: '2026-01-01T00:00:00.000Z',
    })
    await db.trash.add({
      type: 'pattern',
      payload: { id: 200, name: 'Patron corbeille' },
      name: 'Patron corbeille',
      deletedAt: '2026-01-01T00:00:00.000Z',
    })

    const snapshot = await collectBackupData()

    // Seuls les ids en corbeille — pas les ids actifs (1, 100).
    expect(snapshot.trashIds.projects).toEqual([2])
    expect(snapshot.trashIds.patterns.sort((a, b) => a - b)).toEqual([9, 200])
  })
})
