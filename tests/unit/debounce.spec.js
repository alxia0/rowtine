// Unitaire — utilitaire debounce (trailing-edge) + maxWait.
// Pur, testé aux fake timers : sert de brique à la sauvegarde automatique
// débouncée sur mutation (src/backup/auto-backup.js).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { debounce } from '@/utils/debounce'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('debounce', () => {
  it("n'appelle pas la fonction immédiatement", () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 1000)
    debounced()
    expect(fn).not.toHaveBeenCalled()
  })

  it('coalesce plusieurs appels rapprochés en un seul appel trailing', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 1000)
    debounced()
    vi.advanceTimersByTime(400)
    debounced()
    vi.advanceTimersByTime(400)
    debounced()
    vi.advanceTimersByTime(999)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("déclenche après `wait` ms d'inactivité, avec les derniers arguments", () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 1000)
    debounced('a')
    debounced('b')
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('b')
  })

  it('maxWait force un déclenchement pendant une rafale soutenue', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 1000, { maxWait: 3000 })
    // Rafale : un appel toutes les 800ms, jamais assez d'inactivité pour le trailing normal.
    debounced()
    for (let i = 0; i < 10; i += 1) {
      vi.advanceTimersByTime(800)
      debounced()
    }
    // Au bout de 3000ms cumulés (maxWait), un déclenchement a dû avoir lieu
    // malgré la rafale continue.
    expect(fn).toHaveBeenCalled()
  })

  it('sans maxWait, une rafale continue ne déclenche jamais', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 1000)
    debounced()
    for (let i = 0; i < 10; i += 1) {
      vi.advanceTimersByTime(800)
      debounced()
    }
    expect(fn).not.toHaveBeenCalled()
  })

  it('.cancel() annule le déclenchement en attente', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 1000)
    debounced()
    debounced.cancel()
    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()
  })

  it('.cancel() sans appel préalable est un no-op sûr', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 1000)
    expect(() => debounced.cancel()).not.toThrow()
  })

  it('.flush() déclenche immédiatement un appel en attente', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 1000)
    debounced('x')
    debounced.flush()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('x')
    // Le timer trailing ne doit pas re-déclencher un second appel.
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it(".flush() sans appel en attente ne fait rien", () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 1000)
    debounced.flush()
    expect(fn).not.toHaveBeenCalled()
  })

  it('un nouvel appel après un flush réarme normalement le debounce', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 1000)
    debounced('x')
    debounced.flush()
    debounced('y')
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith('y')
  })
})
