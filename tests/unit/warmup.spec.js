// tests/unit/warmup.spec.js
// Unitaire — préchauffe : exécute chaque tâche une fois, avale les échecs, idempotent,
// et NE démarre PAS une tâche tant qu'une navigation est active (ne concurrence pas un tap).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { runWarmup, __resetWarmupForTest } from '@/utils/warmup'

afterEach(() => {
  __resetWarmupForTest()
  vi.useRealTimers()
})

describe('runWarmup', () => {
  it('exécute chaque tâche une fois', async () => {
    const a = vi.fn().mockResolvedValue(1)
    const b = vi.fn().mockResolvedValue(2)
    await runWarmup([a, b])
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('avale un échec de tâche sans lever ni bloquer les suivantes', async () => {
    const boom = vi.fn().mockRejectedValue(new Error('nope'))
    const after = vi.fn().mockResolvedValue(1)
    await expect(runWarmup([boom, after])).resolves.toBeUndefined()
    expect(after).toHaveBeenCalledTimes(1)
  })

  it('idempotent : un 2e appel ne relance rien', async () => {
    const a = vi.fn().mockResolvedValue(1)
    await runWarmup([a])
    await runWarmup([a])
    expect(a).toHaveBeenCalledTimes(1)
  })

  it('cède la main tant qu’une navigation est active, puis reprend', async () => {
    vi.useFakeTimers()
    let busy = true
    const a = vi.fn().mockResolvedValue(1)
    const p = runWarmup([a], () => busy)
    await Promise.resolve() // laisse la boucle atteindre le 1er point d'attente
    expect(a).not.toHaveBeenCalled() // navigation en cours : rien démarré
    busy = false
    await vi.advanceTimersByTimeAsync(250)
    await p
    expect(a).toHaveBeenCalledTimes(1)
  })
})
