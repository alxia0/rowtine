// tests/unit/purchases.store.spec.js
// Unitaire — registre d'achats : CRUD, tri, orphelinage. La table `purchases` doit exister
// (déclarée dans l'unique `db.version(1)` de src/db/db.js depuis la fusion du 13/08/2026,
// ex-version 2) : ce fichier échoue au premier `db.purchases` si elle manque.
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import Dexie from 'dexie'
import { db } from '@/db/db'
import { usePurchasesStore } from '@/stores/purchases'

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('store purchases', () => {
  it('ajoute une ligne avec les défauts (achat, 1 pelote)', async () => {
    const store = usePurchasesStore()
    await store.add({ yarnId: 3, yarnLabel: 'Drops · Baby Merino' })
    expect(store.purchases).toHaveLength(1)
    expect(store.purchases[0]).toMatchObject({ yarnId: 3, kind: 'buy', quantity: 1, reconstructed: false })
  })

  it('forYarn ne rend que les lignes de cette laine, plus récente d’abord', async () => {
    const store = usePurchasesStore()
    await store.add({ yarnId: 1, date: '2026-01-10', quantity: 2 })
    await store.add({ yarnId: 1, date: '2026-05-04', quantity: 5 })
    await store.add({ yarnId: 2, date: '2026-03-03', quantity: 9 })
    expect(store.forYarn(1).map((l) => l.quantity)).toEqual([5, 2])
  })

  it('une ligne sans date passe APRÈS les lignes datées', async () => {
    const store = usePurchasesStore()
    await store.add({ yarnId: 1, date: '', quantity: 7 })
    await store.add({ yarnId: 1, date: '2020-01-01', quantity: 4 })
    expect(store.forYarn(1).map((l) => l.quantity)).toEqual([4, 7])
  })

  it('remove renvoie la ligne, restore la remet avec le même id', async () => {
    const store = usePurchasesStore()
    const id = await store.add({ yarnId: 1, quantity: 3, unitPrice: '4' })
    const removed = await store.remove(id)
    expect(store.purchases).toHaveLength(0)
    expect(removed).toMatchObject({ id, quantity: 3 })
    await store.restore(removed)
    expect(store.purchases[0].id).toBe(id)
  })

  it('orphanYarn coupe le lien SANS supprimer la ligne ni son libellé', async () => {
    const store = usePurchasesStore()
    await store.add({ yarnId: 8, yarnLabel: 'Katia · Merino', quantity: 2, unitPrice: '6' })
    await store.add({ yarnId: 9, yarnLabel: 'Phildar', quantity: 1, unitPrice: '3' })
    await store.orphanYarn(8)
    const orphan = store.purchases.find((l) => l.yarnLabel === 'Katia · Merino')
    expect(orphan.yarnId).toBeNull()
    expect(orphan.quantity).toBe(2)
    expect(store.purchases.find((l) => l.yarnLabel === 'Phildar').yarnId).toBe(9)
  })

  // Constat de revue 1 : `orphanYarn` coerce en Number avant sa requête Dexie,
  // `forYarn` doit faire pareil — sinon un appelant qui transmet l'id sous forme de
  // chaîne (paramètre de route non converti) obtient un tableau vide EN SILENCE.
  it('forYarn retrouve les mêmes lignes que l’identifiant soit un nombre ou une chaîne', async () => {
    const store = usePurchasesStore()
    await store.add({ yarnId: 5, date: '2026-02-02', quantity: 2 })
    await store.add({ yarnId: 5, date: '2026-06-06', quantity: 6 })
    await store.add({ yarnId: 6, date: '2026-04-04', quantity: 9 })
    expect(store.forYarn('5').map((l) => l.quantity)).toEqual(store.forYarn(5).map((l) => l.quantity))
    expect(store.forYarn('5').map((l) => l.quantity)).toEqual([6, 2])
  })

  // forYarn(null) ne doit ramener NI les lignes d'id 0 (Number(null) === 0) NI les
  // lignes orphelines (yarnId === null) : sans identifiant valable, la réponse est
  // délibérément vide (cf. commentaire dans src/stores/purchases.js).
  it('forYarn(null) rend un tableau vide, ne confond pas avec l’id 0 ni les lignes orphelines', async () => {
    const store = usePurchasesStore()
    await store.add({ yarnId: 0, quantity: 1 })
    await store.add({ yarnId: 7, yarnLabel: 'Orpheline', quantity: 2 })
    await store.orphanYarn(7)
    expect(store.forYarn(null)).toEqual([])
    expect(store.forYarn(undefined)).toEqual([])
  })

  // Constat de revue 2 : `update` n'est exercé par aucun test existant, alors
  // qu'il fait partie de l'API consommée verbatim par les tâches suivantes.
  it('update modifie les champs donnés SANS toucher les autres champs de la ligne', async () => {
    const store = usePurchasesStore()
    const id = await store.add({ yarnId: 4, yarnLabel: 'Rico Design', quantity: 3, unitPrice: '4', date: '2026-01-01' })
    await store.update(id, { unitPrice: '7,50', date: '2026-07-31' })
    const line = store.purchases.find((l) => l.id === id)
    expect(line).toMatchObject({
      id,
      yarnId: 4,
      yarnLabel: 'Rico Design',
      quantity: 3,
      unitPrice: '7,50',
      date: '2026-07-31',
    })
  })

  // Base PEUPLÉE, fermée puis rouverte : la situation réelle d'un redémarrage de l'app.
  // (Écrit du temps où le schéma montait en v2 — depuis la fusion du 13/08/2026, il n'y a
  // plus qu'une version, et c'est le test suivant qui exerce une base incomplète.)
  it('une base peuplée survit à une fermeture puis réouverture', async () => {
    await db.projects.add({ id: 1, name: 'Pull bleu', technique: 'knitting', status: 'wip' })
    await db.yarns.add({ id: 1, brand: 'Drops', colorName: 'Bleu', quantity: 4, price: '5,50', consumed: {} })
    await db.sections.add({ id: 1, projectId: 1, order: 0, state: 'todo' })
    await db.settings.put({ key: 'currency', value: 'EUR' })

    db.close()
    await db.open() // réouverture par la déclaration unique du dépôt

    expect(await db.projects.count()).toBe(1)
    expect((await db.yarns.get(1)).price).toBe('5,50')
    expect(await db.sections.count()).toBe(1)
    await db.purchases.add({ yarnId: 1, kind: 'buy', quantity: 4, unitPrice: '5,50', currency: 'EUR' })
    expect(await db.purchases.count()).toBe(1)
  })

  // Le test précédent rouvre une base que le singleton `db` a créée lui-même, avec les
  // onze tables : il ne prouve donc que « la base survit à un close/reopen ». Celui-ci
  // construit une base ne portant QUE les neuf tables d'origine (ce que l'app écrivait
  // avant les travaux sur le budget laine), la ferme, puis la rouvre avec le schéma courant du dépôt.
  // ⚠️ Depuis la fusion du 13/08/2026, src/db/db.js ne déclare plus qu'une seule
  // `db.version(1)` : les deux bases portent donc le MÊME numéro déclaré et il n'y a plus
  // de montée de version à rejouer côté code. Ce que ce test prouve désormais — mesuré,
  // pas supposé, mécanisme relevé plus bas — c'est que les tables manquantes apparaissent
  // quand même (`purchases` est écrite plus bas et relue), au prix d'une réouverture au
  // numéro natif suivant.
  // Doit être le DERNIER test du fichier : il détruit et recrée la base « rowtine ».
  it("une base ne portant que les neuf tables d'origine gagne purchases sans rien perdre", async () => {
    db.close()
    await Dexie.delete('rowtine') // la base ouverte par beforeEach est DÉJÀ en v2

    const ancienne = new Dexie('rowtine')
    ancienne.version(1).stores({
      projects: '++id, name, technique, status, startedAt, finishedAt',
      yarns: '++id, brand, weight, reservedFor',
      patterns: '++id, name, type, category',
      sections: '++id, projectId, patternId, state, order',
      diagrams: '++id, projectId, patternId, sectionId',
      counters: '++id, projectId, name',
      sessions: '++id, projectId, sectionId, date',
      settings: 'key',
      trash: '++id, type, deletedAt',
    })
    await ancienne.open()
    expect(ancienne.verno).toBe(1)
    expect(ancienne.tables.map((t) => t.name)).not.toContain('purchases')
    await ancienne.projects.add({ id: 1, name: 'Pull bleu', technique: 'knitting', status: 'wip' })
    await ancienne.yarns.add({ id: 1, brand: 'Drops', colorName: 'Bleu', quantity: 4, price: '5,50', consumed: {} })
    await ancienne.sections.add({ id: 1, projectId: 1, order: 0, state: 'todo' })
    await ancienne.settings.put({ key: 'currency', value: 'EUR' })
    ancienne.close()

    await db.open() // lancement après mise à jour, avec la déclaration unique du dépôt
    expect(db.verno).toBe(1) // une seule version déclarée depuis la fusion (ménage pré-1.0)
    // ⚠️ LE MÉCANISME, MESURÉ (13/08/2026) et non déduit : IndexedDB ne sait créer un
    // objectStore que pendant un `onupgradeneeded`, qui ne se déclenche que si le numéro
    // de version MONTE. La base est à 10, le code déclare 10 — et pourtant les deux tables
    // manquantes apparaissent. Ce qui l'explique : Dexie rouvre de lui-même la base au
    // numéro natif SUIVANT. Relevé ici sur l'IDBDatabase brute : 11, pas 10.
    // Conséquence à connaître : un appareil dans cet état finirait à 11 face à un code qui
    // en déclare 10, donc le garde-fou de démarrage (src/db/version-guard.js) s'y
    // déclencherait au lancement suivant. Aucun appareil de la maison n'est dans ce cas
    // (ils sont à 30). ⚠️ Mesuré sous fake-indexeddb seulement, jamais sur une WebView.
    expect(db.backendDB().version).toBe(11)
    expect(await db.projects.count()).toBe(1)
    expect((await db.yarns.get(1)).price).toBe('5,50')
    expect(await db.sections.count()).toBe(1)
    expect((await db.settings.get('currency')).value).toBe('EUR')
    await db.purchases.add({ yarnId: 1, kind: 'buy', quantity: 4, unitPrice: '5,50', currency: 'EUR' })
    expect(await db.purchases.count()).toBe(1)
  })
})
