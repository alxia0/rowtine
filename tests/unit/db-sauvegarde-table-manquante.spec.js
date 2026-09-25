// @vitest-environment jsdom
// Une table oubliée dans l'unique `db.version()` de src/db/db.js la rend invisible au code
// (`db.purchases === undefined`, sans erreur à l'ouverture). Ce fichier verrouille ce que
// produit alors la collecte de sauvegarde : un REJET, jamais un snapshot aux tableaux vides
// qui écraserait achats.json / jours-actifs.json. `runBackup` absorbe ce rejet avant
// `backupAll`, donc les fichiers précédents survivent (seule trace : `lastBackupAt` cesse
// d'avancer). Deux scénarios, car collect.js lit `purchases` avant `activeDays` : sans le
// second, l'absence d'`activeDays` seule resterait masquée par celle de `purchases`.
//
// Doit être SEUL à manipuler la base « rowtine » : les deux `it()` la détruisent et la
// recréent à tour de rôle (en série, pas de `concurrent`).
import { describe, it, expect, vi, afterEach } from 'vitest'
import Dexie from 'dexie'

// Schémas historiques recopiés VOLONTAIREMENT plutôt qu'importés : ils fabriquent une vue
// partielle de la base et ne doivent pas suivre src/db/db.js, sinon le test cesserait
// d'exercer une table manquante le jour où le schéma bouge.
const SCHEMA_V1 = {
  projects: '++id, name, technique, status, startedAt, finishedAt',
  yarns: '++id, brand, weight, reservedFor',
  patterns: '++id, name, type, category',
  sections: '++id, projectId, patternId, state, order',
  diagrams: '++id, projectId, patternId, sectionId',
  counters: '++id, projectId, name',
  sessions: '++id, projectId, sectionId, date',
  settings: 'key',
  trash: '++id, type, deletedAt',
}
const SCHEMA_V2 = { purchases: '++id, yarnId, date' }
const SCHEMA_V3 = { activeDays: 'day' }

afterEach(() => {
  vi.doUnmock('@/db/db')
  vi.resetModules()
})

// Construit la base complète v1→v2→v3 avec un achat et un jour actif, puis la referme.
async function creerBaseActuelle() {
  const actuelle = new Dexie('rowtine')
  actuelle.version(1).stores(SCHEMA_V1)
  actuelle.version(2).stores(SCHEMA_V2)
  actuelle.version(3).stores(SCHEMA_V3)
  await actuelle.open()
  const yarnId = await actuelle.yarns.add({ brand: 'Drops', weight: 'DK', quantity: 6 })
  await actuelle.purchases.add({ yarnId, quantity: 6 })
  await actuelle.activeDays.put({ day: '2026-08-11' })
  actuelle.close()
}

describe('collecte de sauvegarde contre une base v3 ouverte par un code qui n’en voit qu’une partie', () => {
  it("purchases ET activeDays invisibles (code réduit à v1) : rejette avant de produire un snapshot", async () => {
    await Dexie.delete('rowtine')
    await creerBaseActuelle()

    // Un Dexie qui ne déclare que v1 rouvre cette base : ouverture réussie,
    // purchases/activeDays invisibles.
    const retrogradee = new Dexie('rowtine')
    retrogradee.version(1).stores(SCHEMA_V1)
    await retrogradee.open()

    // Pré-condition : `purchases`/`activeDays` n'existent pas comme PROPRIÉTÉS sur l'instance
    // (à distinguer de `.table('purchases')`, qui lève).
    expect(retrogradee.purchases).toBeUndefined()
    expect(retrogradee.activeDays).toBeUndefined()

    // La collecte RÉELLE de src/backup/collect.js, branchée sur cette base via un mock de son
    // unique dépendance ('@/db/db') : c'est le seul point d'injection sans toucher à src/.
    vi.doMock('@/db/db', () => ({ db: retrogradee }))
    const { collectBackupData } = await import('@/backup/collect')

    // La collecte REJETTE : `db.purchases.toArray()` lit `.toArray` sur `undefined` pendant la
    // construction du tableau passé à `Promise.all` (TypeError synchrone devenu rejet de la
    // fonction `async`). Aucun snapshot partiel.
    await expect(collectBackupData()).rejects.toBeInstanceOf(TypeError)
    await expect(collectBackupData()).rejects.toThrow(/toArray/)

    retrogradee.close()
    await Dexie.delete('rowtine')
  })

  it("purchases visible, SEULE activeDays invisible (code réduit à v1+v2) : rejette aussi, même mécanisme", async () => {
    await Dexie.delete('rowtine')
    await creerBaseActuelle()

    // v1 et v2 déclarées, pas v3 : purchases visible, seule activeDays invisible.
    const retrogradeeV2 = new Dexie('rowtine')
    retrogradeeV2.version(1).stores(SCHEMA_V1)
    retrogradeeV2.version(2).stores(SCHEMA_V2)
    await retrogradeeV2.open()

    // Pré-condition : purchases visible cette fois, activeDays seule ne l'est pas.
    expect(retrogradeeV2.purchases).toBeDefined()
    expect(retrogradeeV2.activeDays).toBeUndefined()

    vi.doMock('@/db/db', () => ({ db: retrogradeeV2 }))
    const { collectBackupData } = await import('@/backup/collect')

    // Même rejet, même mécanisme, déclenché par activeDays SEULE : chaque table invisible
    // suffit à faire rejeter toute la collecte.
    await expect(collectBackupData()).rejects.toBeInstanceOf(TypeError)
    await expect(collectBackupData()).rejects.toThrow(/toArray/)

    retrogradeeV2.close()
    await Dexie.delete('rowtine')
  })
})
