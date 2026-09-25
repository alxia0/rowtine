// @vitest-environment jsdom
// Unitaire — budget laine cumulé : `achats.json` dans la sauvegarde et
// la restauration. L'historique d'achat n'existe QUE dans la base : s'il ne part pas
// dans la sauvegarde, il est perdu au premier changement d'appareil. Et une
// sauvegarde ANTÉRIEURE à ce lot ne contient pas achats.json : la restauration doit
// alors reconstruire, sinon on affiche un budget à zéro sur un stock rempli.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db, setSetting } from '@/db/db'
import { serializePurchases } from '@/backup/serialize'
import { deserializePurchases } from '@/backup/deserialize'
import { collectBackupData } from '@/backup/collect'
import { readBackup, writeSnapshotToDb } from '@/backup/restore'
import { backupAll } from '@/backup/orchestrator'
import { MemoryBackupStorage } from '@/backup/memory-storage'

// `runReprise` enveloppé d'un espion QUI APPELLE l'implémentation réelle par défaut
// (donc tous les tests d'effet existants restent couverts sans rien changer) — sauf
// pour le test « runReprise qui lève », qui lui substitue une implémentation UNIQUE
// (`mockImplementationOnce`) pour vérifier que `writeSnapshotToDb` survit à une
// exception (revue, point 1 : la reprise tourne hors transaction).
vi.mock('@/db/purchases-reprise', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, runReprise: vi.fn(actual.runReprise) }
})

import { runReprise, REPRISE_FLAG } from '@/db/purchases-reprise'

beforeEach(async () => {
  vi.clearAllMocks()
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

it('sérialise vers achats.json', () => {
  const file = serializePurchases([{ id: 1, quantity: 2 }])
  expect(file.path).toBe('achats.json')
  expect(JSON.parse(file.data)).toEqual([{ id: 1, quantity: 2 }])
})

it('désérialise, fichier absent = tableau vide', () => {
  expect(deserializePurchases(null)).toEqual([])
  expect(deserializePurchases([{ id: 3 }])).toEqual([{ id: 3 }])
})

it('collectBackupData embarque les achats', async () => {
  await db.purchases.add({ yarnId: 1, quantity: 4, unitPrice: '5', currency: 'EUR', kind: 'buy' })
  const snap = await collectBackupData()
  expect(snap.purchases).toHaveLength(1)
  expect(snap.purchases[0].quantity).toBe(4)
})

// GARDE DE CÂBLAGE — même motif que backup-restore.spec.js:414-419 : les tests
// unitaires ci-dessus appellent serializePurchases/deserializePurchases en direct,
// ils resteraient VERTS si l'orchestrateur ne les câblait pas réellement dans le
// fichier écrit sur disque. Celui-ci passe par le VRAI chemin de bout en bout
// (collectBackupData → backupAll → readBackup → writeSnapshotToDb) : c'est LUI qui
// prouve l'affirmation du plan (« s'il ne part pas dans la sauvegarde, il est perdu
// au premier changement d'appareil ») — pas les tests unitaires en amont.
describe('bout en bout — collectBackupData → backupAll → readBackup → writeSnapshotToDb', () => {
  it('un achat réel traverse intact la sauvegarde puis la restauration', async () => {
    await db.purchases.add({
      yarnId: 50,
      yarnLabel: 'Drops · Bleu',
      quantity: 4,
      unitPrice: '5',
      currency: 'EUR',
      kind: 'buy',
      date: '2026-07-20',
    })

    const snapshot = await collectBackupData()
    const mem = new MemoryBackupStorage()
    await backupAll(mem, snapshot)
    expect(await mem.exists('achats.json')).toBe(true)

    const dbSnapshot = await readBackup(mem)
    expect(dbSnapshot.hasPurchasesFile).toBe(true)

    await Promise.all(db.tables.map((t) => t.clear())) // simule une réinstallation
    await writeSnapshotToDb(dbSnapshot)

    const purchases = await db.purchases.toArray()
    expect(purchases).toHaveLength(1)
    expect(purchases[0]).toMatchObject({ yarnId: 50, quantity: 4, unitPrice: '5', currency: 'EUR' })
  })
})

describe('restauration — reconstruction si achats.json est absent (sauvegarde antérieure au lot)', () => {
  it('restaurer une sauvegarde SANS achats.json reconstruit l’historique', async () => {
    const mem = new MemoryBackupStorage()
    // Sauvegarde d'une version antérieure au lot : laines.json présent, achats.json
    // absent. La laine a 3 pelotes restantes + 2 déjà tricotées (`consumed`).
    await mem.writeFile(
      'laines.json',
      JSON.stringify([
        { id: 50, brand: 'Drops', quantity: 3, reservations: {}, consumed: { 1: 2 }, price: 4 },
      ]),
      { encoding: 'utf8' },
    )
    // CHF, PAS EUR (revue, point 2) : EUR est aussi `DEFAULT_CURRENCY` — un test
    // qui utiliserait EUR ici resterait vert même si la lecture de `dbSnapshot.settings`
    // était retirée du code (mutation survivante, prouvée en revue).
    await mem.writeFile('reglages.json', JSON.stringify({ currency: 'CHF' }), { encoding: 'utf8' })

    const dbSnapshot = await readBackup(mem)
    expect(dbSnapshot.hasPurchasesFile).toBe(false)

    await writeSnapshotToDb(dbSnapshot)

    // Attendu : 1 laine restaurée (3 restantes + 2 tricotées) ⇒ 1 ligne de 5 pelotes.
    const purchases = await db.purchases.toArray()
    expect(purchases).toHaveLength(1)
    expect(purchases[0]).toMatchObject({
      yarnId: 50,
      quantity: 5,
      currency: 'CHF',
      kind: 'buy',
      reconstructed: true,
    })
  })

  it("un drapeau de reprise déjà posé sur CETTE base (settings fusionnée, pas remplacée) n'empêche pas la reconstruction — c'est `runReprise`, pas `ensureReprise`, qui doit tourner ici", async () => {
    // Simule une base où la reprise locale a déjà tourné (drapeau posé) AVANT de
    // restaurer une sauvegarde ancienne : `settings` est fusionnée à la restauration
    // (writeSnapshotToDb), le drapeau resterait donc posé même après avoir écrasé
    // les autres tables — `ensureReprise` ne ferait alors rien.
    await setSetting(REPRISE_FLAG, true)

    const mem = new MemoryBackupStorage()
    await mem.writeFile(
      'laines.json',
      JSON.stringify([{ id: 60, brand: 'Katia', quantity: 2, reservations: {}, consumed: {}, price: 5 }]),
      { encoding: 'utf8' },
    )

    const dbSnapshot = await readBackup(mem)
    expect(dbSnapshot.hasPurchasesFile).toBe(false)

    await writeSnapshotToDb(dbSnapshot)

    const purchases = await db.purchases.toArray()
    expect(purchases).toHaveLength(1)
    expect(purchases[0]).toMatchObject({ yarnId: 60, quantity: 2, reconstructed: true })
  })

  it('arbo vide (aucune laine) : rien à reconstruire, aucune ligne créée, drapeau non posé', async () => {
    const mem = new MemoryBackupStorage()
    const dbSnapshot = await readBackup(mem)
    expect(dbSnapshot.hasPurchasesFile).toBe(false)

    await writeSnapshotToDb(dbSnapshot)

    expect(await db.purchases.count()).toBe(0)
    // Revue, point 2 : sans la garde `dbSnapshot.yarns?.length`, `runReprise`
    // tournerait quand même sur zéro laine — il ne créerait toujours aucune ligne
    // (rien à parcourir), donc SEUL le drapeau distingue les deux comportements.
    // Sans cette assertion, retirer la garde laisse ce test vert (mutation survivante,
    // prouvée en revue).
    expect(await db.settings.get(REPRISE_FLAG)).toBeUndefined()
  })

  it("runReprise qui lève ⇒ la restauration réussit quand même ET le drapeau n'est pas posé", async () => {
    const mem = new MemoryBackupStorage()
    await mem.writeFile(
      'laines.json',
      JSON.stringify([{ id: 80, brand: 'Erreur', quantity: 1, reservations: {}, consumed: {} }]),
      { encoding: 'utf8' },
    )

    const dbSnapshot = await readBackup(mem)
    expect(dbSnapshot.hasPurchasesFile).toBe(false)

    runReprise.mockImplementationOnce(() => {
      throw new Error('boum — panne simulée de la reprise')
    })

    // Ne doit PAS rejeter : la restauration (projets/laines/réglages, déjà commitée
    // en transaction avant l'appel à runReprise) ne doit pas échouer pour un souci
    // sur la reprise du budget seule.
    await expect(writeSnapshotToDb(dbSnapshot)).resolves.toBeUndefined()

    // La laine, elle, a bien été restaurée (transaction indépendante, déjà commitée).
    expect(await db.yarns.count()).toBe(1)
    // Aucune ligne créée (l'exception a interrompu runReprise avant tout db.purchases.add).
    expect(await db.purchases.count()).toBe(0)
    // Le drapeau reste ABSENT : c'est ce qui permet à `ensureReprise` (App.vue, prochain
    // lancement) de rattraper ce que cette restauration n'a pas pu terminer.
    expect(await db.settings.get(REPRISE_FLAG)).toBeUndefined()
  })
})

describe('restauration — achats.json présent : remplace, n’ajoute pas', () => {
  it('restaurer une sauvegarde AVEC achats.json remplace, n’ajoute pas', async () => {
    // Base courante : 1 ligne de 9 pelotes.
    await db.purchases.add({ id: 1, yarnId: 50, quantity: 9, kind: 'buy', unitPrice: '3', currency: 'EUR' })

    // Snapshot restauré : 1 ligne de 2 pelotes.
    const mem = new MemoryBackupStorage()
    await mem.writeFile(
      'achats.json',
      JSON.stringify([{ id: 2, yarnId: 50, quantity: 2, kind: 'buy', unitPrice: '3', currency: 'EUR' }]),
      { encoding: 'utf8' },
    )

    const dbSnapshot = await readBackup(mem)
    expect(dbSnapshot.hasPurchasesFile).toBe(true)

    await writeSnapshotToDb(dbSnapshot)

    // Attendu après restauration : 1 seule ligne, 2 pelotes (pas 2 lignes, pas 11 pelotes).
    const purchases = await db.purchases.toArray()
    expect(purchases).toHaveLength(1)
    expect(purchases[0].quantity).toBe(2)
  })

  it('achats.json présent mais VIDE ([]) : zéro achat restauré, aucune reconstruction', async () => {
    await db.yarns.add({ id: 70, brand: 'Existante', quantity: 5 })

    const mem = new MemoryBackupStorage()
    await mem.writeFile('laines.json', JSON.stringify([{ id: 70, brand: 'Existante', quantity: 5 }]), {
      encoding: 'utf8',
    })
    await mem.writeFile('achats.json', '[]', { encoding: 'utf8' })

    const dbSnapshot = await readBackup(mem)
    expect(dbSnapshot.hasPurchasesFile).toBe(true)
    expect(dbSnapshot.purchases).toEqual([])

    await writeSnapshotToDb(dbSnapshot)

    expect(await db.purchases.count()).toBe(0)
  })
})
