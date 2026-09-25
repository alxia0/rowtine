// @vitest-environment jsdom
import { beforeEach, describe, it, expect } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import { usePatternsStore } from '@/stores/patterns'

describe('migrateReadersIfNeeded', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.patterns.clear()
  })


  it('ajoute un reader aux patrons qui n\'en ont pas', async () => {
    const id = await db.patterns.add({ name: 'Écharpe', sections: [{ name: 'Corps', instructions: 'Rg 1\nRg 2' }] })
    const store = usePatternsStore()
    const n = await store.migrateReadersIfNeeded()
    expect(n).toBe(1)
    const p = await db.patterns.get(id)
    expect(p.reader.sections[0].steps).toEqual([{ t: 'Rg 1' }, { t: 'Rg 2' }])
  })

  it('ne retouche pas un patron ayant déjà un reader (idempotent)', async () => {
    const reader = { sizeLabels: ['M'], sections: [] }
    const id = await db.patterns.add({ name: 'X', reader, sections: [], pdf: '', gallery: [], coverIndex: 0 })
    const store = usePatternsStore()
    expect(await store.migrateReadersIfNeeded()).toBe(0)
    const p = await db.patterns.get(id)
    expect(p.reader).toEqual(reader)
  })

  it('load() backfille coverIndex même quand tous les patrons ont déjà un reader', async () => {
    const reader = { sizeLabels: ['M'], sections: [] }
    const id = await db.patterns.add({ name: 'X', reader, sections: [], pdf: '', gallery: [] })
    const store = usePatternsStore()
    await store.load()
    const p = await db.patterns.get(id)
    expect(p.coverIndex).toBe(0)
    // La migration ne se relance plus une fois tous les patrons dotés d'un coverIndex numérique.
    expect(await store.migrateReadersIfNeeded()).toBe(0)
  })
})

describe('ensureFreePattern', () => {
  beforeEach(async () => { await db.patterns.clear() })

  it('sème un patron libre builtin une seule fois', async () => {
    setActivePinia(createPinia())
    const store = usePatternsStore()
    const id1 = await store.ensureFreePattern('fr')
    const id2 = await store.ensureFreePattern('fr')
    expect(id1).toBe(id2)
    const p = await db.patterns.get(id1)
    expect(p.builtin).toBe(true)
    expect(p.reader.sections).toHaveLength(1)
    expect(store.freePatternId).toBe(id1)
  })
})
