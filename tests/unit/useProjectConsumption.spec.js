// @vitest-environment jsdom
// Unitaire : composable useProjectConsumption (K2) : logique partagée par les points
// d'entrée qui peuvent clore un projet. Règle (décision produit) : toute fermeture sans
// « Valider » est une ANNULATION (rien n'est consommé, le statut ne change pas). Couvre
// aussi le chemin qui NE passe PAS par le dialogue : le Retour Android, qui ferme
// directement le store project-consumption (App.vue → projectConsumption.close()).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { db } from '@/db/db'
import { useProjectConsumption } from '@/composables/useProjectConsumption'
import { useProjectConsumptionStore } from '@/stores/project-consumption'
import { createTestRouter } from './helpers/i18n-router'

// Monte un composant minimal pour exécuter le composable dans un vrai setup() (mêmes
// motifs que useSoftDelete.spec.js) — nécessaire pour que les `watch()` internes tournent.
function mountConsumption() {
  const pinia = createPinia()
  const router = createTestRouter([{ path: '/', component: { render: () => null } }, { path: '/stash/:id/edit', name: 'stash-edit', component: { render: () => null } }])
  const push = vi.spyOn(router, 'push').mockResolvedValue()
  const Comp = defineComponent({
    setup: () => ({ pc: useProjectConsumption() }),
    render: () => h('div'),
  })
  const wrapper = mount(Comp, { global: { plugins: [pinia, router] } })
  wrapper.push = push
  return wrapper
}

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('useProjectConsumption', () => {
  it('Retour Android (store.close()) annule : aucune laine touchée, statut non appliqué, onCancel appelé UNE fois', async () => {
    const pid = await db.projects.add({ name: 'Pull', technique: 'knitting', status: 'wip' })
    const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
    const w = mountConsumption()
    const onCancel = vi.fn()

    let applied = false
    await w.vm.pc.requestStatusChange({ id: pid }, 'done', () => { applied = true }, onCancel)
    expect(w.vm.pc.open).toBe(true)
    expect(applied).toBe(false)

    // Simule le Retour Android : App.vue ferme le store sans passer par le dialogue.
    useProjectConsumptionStore().close()

    await vi.waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1))
    // Laisse le temps à un éventuel second déclenchement (store.open repasse à false après cancel()).
    await new Promise((r) => setTimeout(r, 50))
    expect(onCancel).toHaveBeenCalledTimes(1)
    const y = await db.yarns.get(yid)
    expect(y.quantity).toBe(5)
    expect(y.reservations).toEqual({ [pid]: 2 })
    expect(applied).toBe(false)
    expect(w.vm.pc.open).toBe(false)
  })

  it('cancel() ferme sans toucher aux laines ni appeler applyStatus, et appelle onCancel une seule fois', async () => {
    const pid = await db.projects.add({ name: 'Pull', technique: 'knitting', status: 'wip' })
    const yid = await db.yarns.add({ brand: 'Drops', quantity: 5, reservations: { [pid]: 2 } })
    const w = mountConsumption()
    const onCancel = vi.fn()
    const applyStatus = vi.fn()
    await w.vm.pc.requestStatusChange({ id: pid }, 'done', applyStatus, onCancel)
    await w.vm.pc.cancel()
    await w.vm.pc.cancel() // double déclenchement : sans effet
    await new Promise((r) => setTimeout(r, 50))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(applyStatus).not.toHaveBeenCalled()
    expect((await db.yarns.get(yid)).quantity).toBe(5)
    expect(w.vm.pc.open).toBe(false)
  })

  // Double déclenchement : Retour Android (watcher sur store.open) ET Annuler dans le même
  // instant, avec un onCancel asynchrone lent. Sans `req` vidé AVANT l'await, les deux
  // passeraient le garde et onCancel serait appelé deux fois.
  it('double déclenchement pendant un onCancel lent : onCancel appelé une seule fois', async () => {
    const pid = await db.projects.add({ name: 'Pull', technique: 'knitting', status: 'wip' })
    await db.yarns.add({ brand: 'Drops', quantity: 5, reservations: { [pid]: 2 } })
    const w = mountConsumption()
    const onCancel = vi.fn(() => new Promise((r) => setTimeout(r, 40)))
    await w.vm.pc.requestStatusChange({ id: pid }, 'done', vi.fn(), onCancel)
    useProjectConsumptionStore().close() // Retour Android : le watcher appelle cancel()
    await Promise.all([w.vm.pc.cancel(), w.vm.pc.cancel()])
    await new Promise((r) => setTimeout(r, 80))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('cancel() sans onCancel ne lève rien', async () => {
    const pid = await db.projects.add({ name: 'Pull', technique: 'knitting', status: 'wip' })
    await db.yarns.add({ brand: 'Drops', quantity: 5, reservations: { [pid]: 2 } })
    const w = mountConsumption()
    await w.vm.pc.requestStatusChange({ id: pid }, 'done', () => {})
    await expect(w.vm.pc.cancel()).resolves.toBeUndefined()
    expect(w.vm.pc.open).toBe(false)
  })

  it('confirm avec used au-dessus du réservé consomme jusqu’à cette valeur, plafonnée au disponible', async () => {
    const pid = await db.projects.add({ name: 'Pull', technique: 'knitting', status: 'wip' })
    const yid = await db.yarns.add({ brand: 'Drops', quantity: 5, reservations: { [pid]: 2 } })
    const w = mountConsumption()
    const applyStatus = vi.fn()
    await w.vm.pc.requestStatusChange({ id: pid }, 'done', applyStatus)
    expect(w.vm.pc.yarns[0].available).toBe(5)
    expect(w.vm.pc.yarns[0].othersReserved).toBe(false)
    await w.vm.pc.confirm([{ id: yid, used: 4 }, { id: 99999, used: 1 }]) // laine introuvable ignorée
    const y = await db.yarns.get(yid)
    expect(y.quantity).toBe(1)
    expect(y.reservations).toEqual({})
    expect(applyStatus).toHaveBeenCalledTimes(1)
  })

  // Régression (revue finale) : le plafond était le stock TOTAL. Stock 5, A réserve 2, B
  // réserve 3 : A pouvait déclarer 5, le stock tombait à 0 pendant que B gardait 3 pelotes
  // réservées, et la clôture de B était ensuite tronquée à 0 sans trace.
  it('stock 5, A réserve 2, B réserve 3 : le disponible de A vaut 2 et sa clôture ne touche pas aux pelotes de B', async () => {
    const a = await db.projects.add({ name: 'A', technique: 'knitting', status: 'wip' })
    const b = await db.projects.add({ name: 'B', technique: 'knitting', status: 'wip' })
    const yid = await db.yarns.add({ brand: 'Drops', quantity: 5, reservations: { [a]: 2, [b]: 3 } })
    const w = mountConsumption()
    await w.vm.pc.requestStatusChange({ id: a }, 'done', () => {})
    expect(w.vm.pc.yarns).toEqual([{ id: yid, name: 'Drops', reserved: 2, available: 2, othersReserved: true }])
    await w.vm.pc.confirm([{ id: yid, used: 5 }])
    const y = await db.yarns.get(yid)
    expect(y.quantity).toBe(3)
    expect(y.reservations).toEqual({ [b]: 3 })
    expect(y.consumed).toEqual({ [a]: 2 })
    // B peut encore clore avec ses 3 pelotes, et sa trace est écrite.
    await w.vm.pc.requestStatusChange({ id: b }, 'done', () => {})
    expect(w.vm.pc.yarns[0].available).toBe(3)
    await w.vm.pc.confirm([{ id: yid, used: 3 }])
    const fin = await db.yarns.get(yid)
    expect(fin.quantity).toBe(0)
    expect(fin.consumed).toEqual({ [a]: 2, [b]: 3 })
  })

  it('confirm avec used très supérieur au stock consomme tout le stock, pas plus', async () => {
    const pid = await db.projects.add({ name: 'Bonnet', technique: 'knitting', status: 'wip' })
    const yid = await db.yarns.add({ brand: 'Katia', quantity: 3, reservations: { [pid]: 1 } })
    const w = mountConsumption()
    await w.vm.pc.requestStatusChange({ id: pid }, 'done', () => {})
    await w.vm.pc.confirm([{ id: yid, used: 50 }])
    expect((await db.yarns.get(yid)).quantity).toBe(0)
  })

  it('fixStock(id) annule puis pousse la route stash-edit', async () => {
    const pid = await db.projects.add({ name: 'Pull', technique: 'knitting', status: 'wip' })
    const yid = await db.yarns.add({ brand: 'Drops', quantity: 5, reservations: { [pid]: 2 } })
    const w = mountConsumption()
    const onCancel = vi.fn()
    await w.vm.pc.requestStatusChange({ id: pid }, 'done', vi.fn(), onCancel)
    await w.vm.pc.fixStock(yid)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(w.vm.pc.open).toBe(false)
    expect(w.push).toHaveBeenCalledWith({ name: 'stash-edit', params: { id: yid } })
  })

  it('fixStock(id) appelle onCancel une seule fois avec { fixingStock: true } ; un cancel() simple sans cet indicateur', async () => {
    const pid = await db.projects.add({ name: 'Pull', technique: 'knitting', status: 'wip' })
    const yid = await db.yarns.add({ brand: 'Drops', quantity: 5, reservations: { [pid]: 2 } })
    const w = mountConsumption()
    const onCancel = vi.fn()
    await w.vm.pc.requestStatusChange({ id: pid }, 'done', vi.fn(), onCancel)
    await w.vm.pc.fixStock(yid)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledWith({ fixingStock: true })
    expect(w.push).toHaveBeenCalledWith({ name: 'stash-edit', params: { id: yid } })

    const onCancel2 = vi.fn()
    await w.vm.pc.requestStatusChange({ id: pid }, 'done', vi.fn(), onCancel2)
    await w.vm.pc.cancel()
    expect(onCancel2).toHaveBeenCalledTimes(1)
    expect(onCancel2.mock.calls[0][0]?.fixingStock).toBeFalsy()
  })

  it('aucune laine réservée : requestStatusChange applique directement, sans ouvrir', async () => {
    const pid = await db.projects.add({ name: 'Pull', technique: 'knitting', status: 'wip' })
    const w = mountConsumption()

    let applied = false
    await w.vm.pc.requestStatusChange({ id: pid }, 'done', () => {
      applied = true
    })
    expect(applied).toBe(true)
    expect(w.vm.pc.open).toBe(false)
  })
})
