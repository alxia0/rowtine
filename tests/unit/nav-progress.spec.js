// tests/unit/nav-progress.spec.js
// Unitaire — cue de navigation : état singleton + anti-flash déterministe (fake timers).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { navActive, navStart, navDone, NAV_PROGRESS_DELAY_MS } from '@/composables/useNavProgress'

beforeEach(() => {
  vi.useFakeTimers()
  navDone() // état propre entre les tests (module singleton)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useNavProgress', () => {
  it("n'affiche rien avant le délai anti-flash", () => {
    navStart()
    expect(navActive.value).toBe(false)
    vi.advanceTimersByTime(NAV_PROGRESS_DELAY_MS - 1)
    expect(navActive.value).toBe(false)
  })

  it('affiche la barre si la navigation dure plus que le délai', () => {
    navStart()
    vi.advanceTimersByTime(NAV_PROGRESS_DELAY_MS)
    expect(navActive.value).toBe(true)
  })

  it("navDone() avant le délai n'affiche jamais la barre (navigation chaude)", () => {
    navStart()
    navDone()
    vi.advanceTimersByTime(NAV_PROGRESS_DELAY_MS * 2)
    expect(navActive.value).toBe(false)
  })

  it("navDone() éteint une barre déjà affichée", () => {
    navStart()
    vi.advanceTimersByTime(NAV_PROGRESS_DELAY_MS)
    expect(navActive.value).toBe(true)
    navDone()
    expect(navActive.value).toBe(false)
  })

  it("navDone() sans navStart() est un no-op (pas d'erreur, reste éteint)", () => {
    expect(() => navDone()).not.toThrow()
    expect(navActive.value).toBe(false)
  })

  it("navStart() enchaînés (redirection) : un seul navDone() réinitialise tout", () => {
    navStart()
    navStart()
    navDone()
    vi.advanceTimersByTime(NAV_PROGRESS_DELAY_MS * 2)
    expect(navActive.value).toBe(false)
  })
})
