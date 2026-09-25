// @vitest-environment jsdom
// Avant de supprimer un patron, il faut savoir combien de projets s'en servent.
// Précédent : src/backup/patron-md-sync.js:163 filtre déjà sur p.patternId.
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import { useProjectsStore } from '@/stores/projects'

describe('projets utilisant un patron', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.projects.clear()
  })

  it('renvoie les projets liés à ce patron', async () => {
    await db.projects.bulkAdd([
      { name: 'Top A', patternId: 7 },
      { name: 'Écharpe', patternId: 9 },
      { name: 'Top B', patternId: 7 },
    ])
    const store = useProjectsStore()
    const lies = await store.usingPattern(7)
    expect(lies.map((p) => p.name).sort()).toEqual(['Top A', 'Top B'])
  })

  it('renvoie une liste vide si aucun projet ne l’utilise', async () => {
    await db.projects.add({ name: 'Écharpe', patternId: 9 })
    const store = useProjectsStore()
    expect(await store.usingPattern(7)).toEqual([])
  })

  it('ignore les projets sans patron', async () => {
    await db.projects.add({ name: 'Libre', patternId: null })
    const store = useProjectsStore()
    expect(await store.usingPattern(7)).toEqual([])
  })
})
