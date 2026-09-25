// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import { usePatternsStore } from '@/stores/patterns'
import { useProjectsStore } from '@/stores/projects'
import { DEMO_PATTERN_DEMO_ID, loadDemoContent } from '@/constants/demo'

describe('semis des exemples dans la langue choisie', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.patterns.clear()
    await db.projects.clear()
  })

  it('sème les patrons de la langue demandée et les indexe par demoId', async () => {
    const store = usePatternsStore()
    const ids = await store.seedSamplesIfEmpty('fr')
    expect(Object.keys(ids).sort()).toEqual(['bonnet', 'echarpe', 'sac'])
    expect(ids[DEMO_PATTERN_DEMO_ID]).toBeTypeOf('number')
    const semes = await db.patterns.toArray()
    expect(semes).toHaveLength(3)
  })

  it("ne persiste PAS le demoId : c'est une clé de semis, pas une donnée de patron", async () => {
    const store = usePatternsStore()
    await store.seedSamplesIfEmpty('fr')
    const semes = await db.patterns.toArray()
    for (const p of semes) expect(p.demoId).toBeUndefined()
  })

  it('ne sème rien si la bibliothèque contient déjà un patron', async () => {
    await db.patterns.add({ name: 'Déjà là', builtin: false, ownerProjectId: null })
    const store = usePatternsStore()
    const ids = await store.seedSamplesIfEmpty('fr')
    expect(ids).toEqual({})
    expect(await db.patterns.count()).toBe(1)
  })

  it('le patron libre porte le nom de la langue demandée', async () => {
    const store = usePatternsStore()
    const id = await store.ensureFreePattern('fr')
    const p = await db.patterns.get(id)
    const attendu = (await loadDemoContent('fr')).freePattern.name
    expect(p.name).toBe(attendu)
  })

  it('les projets exemples reprennent les libellés fournis', async () => {
    const projects = useProjectsStore()
    await projects.seedExamplesIfEmpty('knitting', null, {
      idea: { name: 'Mon idée', notes: 'note idée' },
      fallbackKnitting: 'Mon en-cours',
      fallbackNotes: 'note en-cours',
    })
    const tous = await db.projects.toArray()
    expect(tous.map((p) => p.name).sort()).toEqual(['Mon en-cours', 'Mon idée'])
  })
})
