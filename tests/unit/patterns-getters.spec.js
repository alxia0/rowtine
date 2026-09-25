// @vitest-environment jsdom
import { beforeEach, describe, it, expect } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import { usePatternsStore } from '@/stores/patterns'

describe('getters patrons — bibliothèque vs instances', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.patterns.clear()
  })

  it('libraryPatterns exclut instances et builtin ; selectablePatterns exclut seulement les instances', async () => {
    await db.patterns.add({ name: 'Gabarit', reader: { sizeLabels: [], sections: [] } })
    await db.patterns.add({ name: 'Libre', builtin: true, reader: { sizeLabels: [], sections: [] } })
    await db.patterns.add({ name: 'Instance', ownerProjectId: 5, reader: { sizeLabels: [], sections: [] } })
    const store = usePatternsStore()
    await store.load()
    expect(store.libraryPatterns.map((p) => p.name).sort()).toEqual(['Gabarit'])
    expect(store.selectablePatterns.map((p) => p.name).sort()).toEqual(['Gabarit', 'Libre'])
  })

  it('seedSamplesIfEmpty n\'est pas bloqué par une instance existante', async () => {
    await db.patterns.add({ name: 'Instance', ownerProjectId: 9, reader: { sizeLabels: [], sections: [] } })
    const store = usePatternsStore()
    const ids = await store.seedSamplesIfEmpty('fr')
    expect(Object.keys(ids).length).toBeGreaterThan(0) // les exemples ont bien été semés
  })
})
