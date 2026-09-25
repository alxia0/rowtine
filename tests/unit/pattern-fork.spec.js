// @vitest-environment jsdom
import { beforeEach, describe, it, expect } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import { usePatternsStore } from '@/stores/patterns'

describe('forkForProject — copy-on-write', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.patterns.clear()
  })

  it('copie le patron en une instance nommée comme le projet, sans toucher l\'original', async () => {
    const tplId = await db.patterns.add({
      name: 'SABAI', reader: { sizeLabels: ['M'], sections: [{ id: 'a', icon: '🧶', title: 'A', steps: [] }] },
    })
    const store = usePatternsStore()
    const project = { id: 7, name: 'Mon SABAI', patternId: tplId }
    const newId = await store.forkForProject(project)
    expect(newId).not.toBe(tplId)
    const inst = await db.patterns.get(newId)
    expect(inst.ownerProjectId).toBe(7)
    expect(inst.name).toBe('Mon SABAI')
    expect(inst.builtin).toBe(false)
    expect(inst.reader.sections[0].id).toBe('a') // reader copié
    // original intact
    const tpl = await db.patterns.get(tplId)
    expect(tpl.ownerProjectId).toBeUndefined()
    expect(tpl.name).toBe('SABAI')
  })

  it('no-op si le patron courant est déjà l\'instance du projet', async () => {
    const instId = await db.patterns.add({ name: 'X', ownerProjectId: 7, reader: { sizeLabels: [], sections: [] } })
    const store = usePatternsStore()
    const before = await db.patterns.count()
    const id = await store.forkForProject({ id: 7, name: 'X', patternId: instId })
    expect(id).toBe(instId)
    expect(await db.patterns.count()).toBe(before) // aucun nouvel enregistrement
  })

  it('renvoie null si le projet n\'a pas de patron', async () => {
    const store = usePatternsStore()
    expect(await store.forkForProject({ id: 1, name: 'P', patternId: null })).toBeNull()
  })
})

// ─── Prix du patron (lot 07/08) ─────────────────────────────────────────────
// Corriger un patron pour un projet le DUPLIQUE. Sans précaution, la copie emporterait le
// prix : soit il serait compté deux fois dans les Dépenses, soit — puisqu'on ne compte que
// la bibliothèque — le champ du formulaire projet écrirait dans la copie et ne changerait
// RIEN au total, en silence. La copie est donc dépouillée, et retient d'où elle vient.
describe('forkForProject — le prix ne suit jamais la copie', () => {
  it('F1. la copie n’emporte aucun des trois champs de prix', async () => {
    const store = usePatternsStore()
    const srcId = await db.patterns.add({
      name: 'Sabai', type: 'knitting', price: '8,50', priceCurrency: 'EUR', purchasedAt: '2026-03-12',
    })
    const projectId = await db.projects.add({ name: 'Bonnet', patternId: srcId })
    const forkId = await store.forkForProject({ id: projectId, patternId: srcId, name: 'Bonnet' })
    const fork = await db.patterns.get(forkId)
    expect(fork.price).toBeUndefined()
    expect(fork.priceCurrency).toBeUndefined()
    expect(fork.purchasedAt).toBeUndefined()
  })

  it('F2. la copie retient son patron d’origine', async () => {
    const store = usePatternsStore()
    const srcId = await db.patterns.add({ name: 'Sabai', type: 'knitting', price: '8,50' })
    const projectId = await db.projects.add({ name: 'Bonnet', patternId: srcId })
    const forkId = await store.forkForProject({ id: projectId, patternId: srcId, name: 'Bonnet' })
    expect((await db.patterns.get(forkId)).sourcePatternId).toBe(srcId)
  })

  it('F3. copie d’une copie : la chaîne remonte à la BIBLIOTHÈQUE, pas à la copie intermédiaire', async () => {
    const store = usePatternsStore()
    const srcId = await db.patterns.add({ name: 'Sabai', type: 'knitting', price: '8,50' })
    const projectA = await db.projects.add({ name: 'A', patternId: srcId })
    const forkA = await store.forkForProject({ id: projectA, patternId: srcId, name: 'A' })
    const projectB = await db.projects.add({ name: 'B', patternId: forkA })
    const forkB = await store.forkForProject({ id: projectB, patternId: forkA, name: 'B' })
    expect((await db.patterns.get(forkB)).sourcePatternId).toBe(srcId)
  })

  it('F4. l’original garde son prix intact', async () => {
    const store = usePatternsStore()
    const srcId = await db.patterns.add({ name: 'Sabai', type: 'knitting', price: '8,50', priceCurrency: 'EUR' })
    const projectId = await db.projects.add({ name: 'Bonnet', patternId: srcId })
    await store.forkForProject({ id: projectId, patternId: srcId, name: 'Bonnet' })
    const src = await db.patterns.get(srcId)
    expect(src.price).toBe('8,50')
    expect(src.priceCurrency).toBe('EUR')
  })
})
