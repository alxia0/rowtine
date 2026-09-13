import { beforeEach, describe, it, expect } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import { useProjectsStore } from '@/stores/projects'

describe('remove/restore — instance patron du projet', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.projects.clear()
    await db.patterns.clear()
  })

  it('supprime l\'instance du projet et la restaure à l\'annulation', async () => {
    const pid = await db.projects.add({ name: 'P', patternId: 0 })
    const instId = await db.patterns.add({ name: 'P', ownerProjectId: pid, reader: { sizeLabels: [], sections: [] } })
    await db.projects.update(pid, { patternId: instId })
    const store = useProjectsStore()
    const bundle = await store.remove(pid)
    expect(bundle.instancePattern?.id).toBe(instId)
    expect(await db.patterns.get(instId)).toBeUndefined() // instance supprimée
    await store.restore(bundle)
    expect((await db.patterns.get(instId))?.name).toBe('P') // instance restaurée
  })

  it('ne supprime pas un patron de bibliothèque partagé', async () => {
    const tplId = await db.patterns.add({ name: 'Gabarit', reader: { sizeLabels: [], sections: [] } })
    const pid = await db.projects.add({ name: 'P', patternId: tplId })
    const store = useProjectsStore()
    const bundle = await store.remove(pid)
    expect(bundle.instancePattern).toBeFalsy()
    expect((await db.patterns.get(tplId))?.name).toBe('Gabarit') // gabarit intact
  })
})
