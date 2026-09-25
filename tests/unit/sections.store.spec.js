// @vitest-environment jsdom
// Unitaire — store sections : machine à états, bornage des rangs, agrégation de progression.
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import { useSectionsStore, sectionInstructions, sectionState } from '@/stores/sections'

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('sectionInstructions', () => {
  it('préfère la variante de taille, sinon le texte commun', () => {
    const s = { instructions: 'commun', bySize: { M: 'pour M' } }
    expect(sectionInstructions(s, 'M')).toBe('pour M')
    expect(sectionInstructions(s, 'L')).toBe('commun')
    expect(sectionInstructions(s, '')).toBe('commun')
    expect(sectionInstructions(null, 'M')).toBe('')
  })
})

describe('sectionState', () => {
  it('classe la section selon sa progression', () => {
    expect(sectionState({ id: 1, markedDone: true }, 7)).toBe('done')
    expect(sectionState({ id: 2, rowsTotal: 10, rowsDone: 10 }, 7)).toBe('done')
    expect(sectionState({ id: 7, rowsDone: 3 }, 7)).toBe('wip') // = section active
    expect(sectionState({ id: 3, rowsDone: 2 }, 7)).toBe('started')
    expect(sectionState({ id: 4, rowsDone: 0 }, 7)).toBe('todo')
  })
})

describe('store sections — rangs', () => {
  it('borne rowsDone à [0, rowsTotal] et annule le « marqué terminé »', async () => {
    const store = useSectionsStore()
    const id = await store.add(1, { name: 'Dos', rowsTotal: 5, markedDone: true })

    await store.setRowsDone(id, 99)
    expect((await store.get(id)).rowsDone).toBe(5)
    await store.setRowsDone(id, -3)
    const s = await store.get(id)
    expect(s.rowsDone).toBe(0)
    expect(s.markedDone).toBe(false)
  })

  it('markDone remplit les rangs ; reset les remet à zéro', async () => {
    const store = useSectionsStore()
    const id = await store.add(1, { name: 'Manche', rowsTotal: 8 })
    await store.markDone(id)
    expect(await store.get(id)).toMatchObject({ markedDone: true, rowsDone: 8 })
    await store.reset(id)
    expect(await store.get(id)).toMatchObject({ markedDone: false, rowsDone: 0 })
  })

  it('add incrémente l’ordre des sections d’un projet', async () => {
    const store = useSectionsStore()
    await store.add(1, { name: 'A' })
    await store.add(1, { name: 'B' })
    expect(store.sections.map((s) => s.order)).toEqual([0, 1])
  })
})

describe('store sections — patron & progression', () => {
  it('replaceFromPattern estime rowsTotal d’après les lignes d’instructions', async () => {
    const store = useSectionsStore()
    await store.replaceFromPattern(1, [
      { name: 'Corps', instructions: 'rang 1\nrang 2\nrang 3' },
      { name: 'Diag', instructions: '', isDiagram: true },
    ])
    const corps = store.sections.find((s) => s.name === 'Corps')
    expect(corps.rowsTotal).toBe(3)
    expect(store.sections.find((s) => s.name === 'Diag').isDiagram).toBe(true)
  })

  it('progressByProject agrège rangs faits/total et compte les terminées comme pleines', async () => {
    const store = useSectionsStore()
    await store.add(1, { name: 'a', rowsTotal: 10, rowsDone: 4 })
    await store.add(1, { name: 'b', rowsTotal: 6, markedDone: true })
    await store.add(2, { name: 'c', rowsTotal: 0 }) // sans total → ignorée
    const map = await store.progressByProject()
    expect(map[1]).toEqual({ done: 10, total: 16 })
    expect(map[2]).toBeUndefined()
  })
})
