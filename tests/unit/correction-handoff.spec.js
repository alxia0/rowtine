// Relais lecteur → écran de correction → lecteur. Calqué sur import-handoff
// (même forme set()/take(), take() efface) : jamais de relais périmé réutilisé
// au montage.
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useCorrectionHandoff } from '@/stores/correction-handoff'

beforeEach(() => setActivePinia(createPinia()))

const PAYLOAD = {
  projectId: 7,
  sectionId: 'corps',
  stepIndex: 2,
  chronoWasRunning: true,
}

describe('useCorrectionHandoff', () => {
  it('take() renvoie la charge posée puis vide', () => {
    const h = useCorrectionHandoff()
    h.set(PAYLOAD)
    expect(h.pending).toEqual(PAYLOAD)
    expect(h.take()).toEqual(PAYLOAD)
    expect(h.pending).toBe(null)
    expect(h.take()).toBe(null)
  })

  it('set(null) vide le relais', () => {
    const h = useCorrectionHandoff()
    h.set(PAYLOAD)
    h.set(null)
    expect(h.pending).toBe(null)
  })

  it('un second set() remplace le premier (un seul relais en vol)', () => {
    const h = useCorrectionHandoff()
    h.set(PAYLOAD)
    h.set({ ...PAYLOAD, projectId: 9 })
    expect(h.take().projectId).toBe(9)
  })
})
