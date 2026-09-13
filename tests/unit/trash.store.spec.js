// Unitaire — corbeille : envoi, restauration (simple + bundle projet en cascade), purge.
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import { useTrashStore } from '@/stores/trash'

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('store trash', () => {
  it('dérive un libellé depuis le nom/marque de l’objet', async () => {
    const store = useTrashStore()
    await store.add('yarn', { brand: 'Drops', colorName: 'Écru' })
    expect(store.items[0]).toMatchObject({ type: 'yarn', name: 'Drops' })
  })

  it('restaure une laine simple puis retire l’entrée de corbeille', async () => {
    const store = useTrashStore()
    const tid = await store.add('yarn', { id: 3, brand: 'Katia' })
    await store.restore(tid)
    expect(await db.yarns.get(3)).toMatchObject({ brand: 'Katia' })
    expect(store.items).toHaveLength(0)
  })

  it('restaure un projet EN CASCADE depuis son bundle (pool, nouveau format { id, qty })', async () => {
    const store = useTrashStore()
    const bundle = {
      project: { id: 1, name: 'Pull' },
      sections: [{ id: 10, projectId: 1, name: 'Dos' }],
      sessions: [{ id: 20, projectId: 1, durationSec: 60 }],
      yarnLinks: [{ id: 30, qty: 2 }],
    }
    await db.yarns.add({ id: 30, brand: 'Drops', quantity: 5, reservations: {} })
    const tid = await store.add('project', bundle)

    await store.restore(tid)
    expect(await db.projects.get(1)).toMatchObject({ name: 'Pull' })
    expect(await db.sections.get(10)).toMatchObject({ name: 'Dos' })
    expect(await db.sessions.get(20)).toBeTruthy()
    expect((await db.yarns.get(30)).reservations).toEqual({ 1: 2 })
  })

  it('signale un manque quand la restauration alloue moins que demandé (pelotes reprises entre-temps)', async () => {
    const store = useTrashStore()
    // La laine n'a que 3 pelotes, dont 2 déjà prises par le projet 2 : le projet 1
    // (en cours de restauration) ne pourra en récupérer qu'1 sur les 3 demandées.
    await db.yarns.add({ id: 30, brand: 'Drops', quantity: 3, reservations: { 2: 2 } })
    const bundle = { project: { id: 1, name: 'Pull' }, yarnLinks: [{ id: 30, qty: 3 }] }
    const tid = await store.add('project', bundle)

    const result = await store.restore(tid)
    expect(result.shortfalls).toEqual([{ yarnId: 30, requested: 3, got: 1 }])
    expect((await db.yarns.get(30)).reservations).toEqual({ 1: 1, 2: 2 })
  })

  it('ne signale rien quand la restauration obtient l’intégralité de l’allocation demandée', async () => {
    const store = useTrashStore()
    await db.yarns.add({ id: 30, brand: 'Drops', quantity: 5, reservations: {} })
    const bundle = { project: { id: 1, name: 'Pull' }, yarnLinks: [{ id: 30, qty: 2 }] }
    const tid = await store.add('project', bundle)

    const result = await store.restore(tid)
    expect(result.shortfalls).toEqual([])
  })

  it('une entrée à l’ANCIEN format (projet nu, sans enveloppe { project }) ne restaure rien — tolérance retirée (07/09/2026)', async () => {
    const store = useTrashStore()
    // Ancienne forme : le projet stocké NU comme payload, sans le paquet
    // { project, sections, … } que produit la suppression en cascade. La
    // tolérance qui le relisait a été retirée (ménage pré-1.0, corbeilles
    // vérifiées vides sur les deux appareils le 07/09) : l’entrée est
    // consommée, la base ne bouge pas — même contrat que projects.js `restore`.
    await db.trash.add({ type: 'project', payload: { id: 7, name: 'Vieux nu' }, name: 'Vieux nu', deletedAt: new Date().toISOString() })
    await store.load()
    expect(store.items).toHaveLength(1)
    await store.restore(store.items[0].id)
    expect(await db.projects.get(7)).toBeUndefined()
    expect(store.items).toHaveLength(0)
  })

  it('la restauration n’efface plus les scalaires hérités reservedFor/reservedQty (ancien modèle « 1 laine = 1 projet », retiré le 07/09/2026)', async () => {
    const store = useTrashStore()
    // Scalars hérités préexistants sur la fiche laine : la restauration ne doit
    // plus les effacer à l’aveugle — elle n’écrit que la map `reservations`.
    await db.yarns.add({ id: 30, brand: 'Drops', quantity: 5, reservations: {}, reservedFor: 9, reservedQty: 2 })
    const bundle = { project: { id: 1, name: 'Pull' }, yarnLinks: [{ id: 30, qty: 2 }] }
    const tid = await store.add('project', bundle)

    await store.restore(tid)
    const y = await db.yarns.get(30)
    expect(y.reservations).toEqual({ 1: 2 })
    expect(y.reservedFor).toBe(9)
    expect(y.reservedQty).toBe(2)
  })

  it('restaure un projet EN CASCADE (trace de consommation, K3) : la trace revient, la quantité n’est pas touchée', async () => {
    const store = useTrashStore()
    const bundle = {
      project: { id: 1, name: 'Pull', status: 'done' },
      yarnLinks: [{ id: 30, qty: null, consumedQty: 2 }],
    }
    // La laine a déjà perdu sa trace (comme le ferait projects.remove() sur un lien
    // consommé) : plus de `consumed`, `quantity` déjà déduite par le tricot réel.
    await db.yarns.add({ id: 30, brand: 'Drops', quantity: 3, reservations: {}, consumed: {} })
    const tid = await store.add('project', bundle)

    await store.restore(tid)
    const y = await db.yarns.get(30)
    expect(y.consumed).toEqual({ 1: 2 })
    expect(y.quantity).toBe(3) // rien ne revient : les pelotes ont VRAIMENT été tricotées
  })

  it('empty vide toute la corbeille', async () => {
    const store = useTrashStore()
    await store.add('yarn', { brand: 'A' })
    await store.add('yarn', { brand: 'B' })
    await store.empty()
    expect(store.items).toHaveLength(0)
  })
})
