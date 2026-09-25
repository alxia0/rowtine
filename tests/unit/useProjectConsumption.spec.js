// @vitest-environment jsdom
// Unitaire — composable useProjectConsumption (K2) : logique partagée par les deux
// points d'entrée qui peuvent clore un projet. Couvre spécifiquement le chemin qui NE
// passe PAS par le dialogue : le Retour Android, qui ferme directement le store
// project-consumption (App.vue → projectConsumption.close()) — ce chemin doit appliquer
// le MÊME défaut (tout le réservé compté comme tricoté) que la croix/le scrim/Échap.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { db } from '@/db/db'
import { useProjectConsumption } from '@/composables/useProjectConsumption'
import { useProjectConsumptionStore } from '@/stores/project-consumption'

// Monte un composant minimal pour exécuter le composable dans un vrai setup() (mêmes
// motifs que useSoftDelete.spec.js) — nécessaire pour que les `watch()` internes tournent.
function mountConsumption() {
  const pinia = createPinia()
  const Comp = defineComponent({
    setup: () => ({ pc: useProjectConsumption() }),
    render: () => h('div'),
  })
  const wrapper = mount(Comp, { global: { plugins: [pinia] } })
  return wrapper
}

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('useProjectConsumption', () => {
  it('Retour Android (store.close()) applique le défaut : tout le réservé est consommé ET le statut appliqué', async () => {
    const pid = await db.projects.add({ name: 'Pull', technique: 'knitting', status: 'wip' })
    const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
    const w = mountConsumption()

    let applied = false
    await w.vm.pc.requestStatusChange({ id: pid }, 'done', () => {
      applied = true
    })
    expect(w.vm.pc.open).toBe(true)
    expect(applied).toBe(false) // pas encore appliqué : la question est en attente

    // Simule le Retour Android : App.vue appelle projectConsumption.close() directement,
    // sans passer par le dialogue (croix/scrim/Échap).
    useProjectConsumptionStore().close()

    // La fermeture externe déclenche un watcher async qui applique le défaut via
    // consumeProjectReservation (yarnsStore.update() enchaîne plusieurs tours Dexie).
    await vi.waitFor(async () => {
      const y = await db.yarns.get(yid)
      expect(y.quantity).toBe(3) // 5 - 2 (tout le réservé, défaut = tout tricoté)
      expect(y.reservations).toEqual({})
      expect(y.consumed).toEqual({ [pid]: 2 })
    }, { timeout: 10000 })
    expect(applied).toBe(true) // le changement de statut a bien été appliqué
    expect(w.vm.pc.open).toBe(false)
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
