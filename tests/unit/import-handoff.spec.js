import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useImportHandoff } from '@/stores/import-handoff'

beforeEach(() => setActivePinia(createPinia()))

describe('useImportHandoff', () => {
  it('take() renvoie le fichier posé puis vide', () => {
    const h = useImportHandoff()
    const f = new File(['x'], 'pull.pdf')
    h.set(f)
    expect(h.pendingFile).toBe(f)
    expect(h.take()).toBe(f)
    expect(h.pendingFile).toBe(null)
    expect(h.take()).toBe(null) // second appel : plus rien
  })
})
