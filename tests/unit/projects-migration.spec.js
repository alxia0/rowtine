import { beforeEach, describe, it, expect } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import { useProjectsStore, emptyProject, needlesPatch } from '@/stores/projects'

describe('aiguilles multiples — modèle & migration', () => {
  it('emptyProject expose une liste needles avec une entrée vide', () => {
    const p = emptyProject()
    expect(p.needles).toEqual([{ mm: '', us: '' }])
    expect(p.needleMm).toBeUndefined()
  })
  it('needlesPatch convertit les scalaires hérités en liste', () => {
    expect(needlesPatch({ needleMm: '4.5', needleUs: '7' })).toEqual({ needles: [{ mm: '4.5', us: '7' }] })
    expect(needlesPatch({})).toEqual({ needles: [{ mm: '', us: '' }] })
  })
  it('needlesPatch est un no-op si needles est déjà une liste', () => {
    expect(needlesPatch({ needles: [{ mm: '3', us: '' }] })).toBeNull()
  })

  it('load() migre en base les projets à scalaires (une seule fois)', async () => {
    setActivePinia(createPinia())
    await db.projects.clear()
    const id = await db.projects.add({ name: 'Vieux', needleMm: '5', needleUs: 'US 8' })
    const store = useProjectsStore()
    await store.load()
    const migrated = await db.projects.get(id)
    expect(migrated.needles).toEqual([{ mm: '5', us: 'US 8' }])
    // Les scalaires hérités sont retirés de la base (Dexie supprime les clés à undefined).
    expect(migrated.needleMm).toBeUndefined()
    expect(migrated.needleUs).toBeUndefined()
  })
})

describe('migrateFreeProjects', () => {
  beforeEach(async () => { setActivePinia(createPinia()); await db.projects.clear() })

  it('rattache les projets sans patron au patron libre', async () => {
    const a = await db.projects.add({ name: 'A', patternId: null, activeSectionId: 5 })
    const b = await db.projects.add({ name: 'B', patternId: 7 })
    const store = useProjectsStore()
    const n = await store.migrateFreeProjects(42)
    expect(n).toBe(1)
    expect((await db.projects.get(a)).patternId).toBe(42)
    expect((await db.projects.get(a)).activeSectionId).toBeNull() // pointeur legacy effacé
    expect((await db.projects.get(b)).patternId).toBe(7) // inchangé
  })

  it('idempotent : 2e passage ne change rien', async () => {
    await db.projects.add({ name: 'A', patternId: null })
    const store = useProjectsStore()
    await store.migrateFreeProjects(42)
    expect(await store.migrateFreeProjects(42)).toBe(0)
  })
})
