import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useImportProgress } from '@/composables/useImportProgress'

// Hors composant : getCurrentInstance() est null → onUnmounted est ignoré, testable seul.
describe('useImportProgress — cycle de vie du timer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('la barre avance pendant l’import puis se fige à 100 % après end()', () => {
    const p = useImportProgress()
    p.begin('local', 0)
    p.report({ phase: 'parse' })
    vi.advanceTimersByTime(2000)
    expect(p.pct.value).toBeGreaterThan(0)
    expect(p.elapsedSec.value).toBeGreaterThanOrEqual(1)
    p.end()
    expect(p.pct.value).toBe(100)
    const frozen = p.elapsedSec.value
    vi.advanceTimersByTime(5000)
    expect(p.elapsedSec.value).toBe(frozen) // timer arrêté : rien ne bouge
  })

  it('un 2e begin ne laisse pas le timer précédent orphelin', () => {
    const p = useImportProgress()
    p.begin('local', 0)
    vi.advanceTimersByTime(1000)
    p.begin('zip', 0) // relance (changement de profil) : doit nettoyer le timer précédent
    p.report({ phase: 'images' })
    vi.advanceTimersByTime(1000)
    p.end()
    const frozen = p.elapsedSec.value
    vi.advanceTimersByTime(5000)
    // Si un timer était resté orphelin, elapsedSec continuerait d’augmenter.
    expect(p.elapsedSec.value).toBe(frozen)
  })
})
