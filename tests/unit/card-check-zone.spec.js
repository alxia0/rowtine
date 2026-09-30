import { describe, it, expect } from 'vitest'
import { inCheckZone } from '@/utils/card-check-zone'

// Protège la frontière du tiers gauche d'une carte cochable du lecteur (appui qui coche).
describe('inCheckZone', () => {
  it('le bord gauche et tout le premier tiers cochent', () => {
    expect(inCheckZone(100, 100, 300)).toBe(true)
    expect(inCheckZone(150, 100, 300)).toBe(true)
    expect(inCheckZone(199.9, 100, 300)).toBe(true)
  })

  it('à partir du tiers exact, l’appui ne coche plus', () => {
    expect(inCheckZone(200, 100, 300)).toBe(false)
    expect(inCheckZone(300, 100, 300)).toBe(false)
    expect(inCheckZone(400, 100, 300)).toBe(false)
  })

  it('un appui à gauche de la carte ne coche pas', () => {
    expect(inCheckZone(99, 100, 300)).toBe(false)
  })

  it('une carte sans largeur mesurable ne coche jamais', () => {
    expect(inCheckZone(0, 0, 0)).toBe(false)
    expect(inCheckZone(0, 0, -10)).toBe(false)
    expect(inCheckZone(0, 0, NaN)).toBe(false)
    expect(inCheckZone(0, 0, undefined)).toBe(false)
    expect(inCheckZone(undefined, 0, 300)).toBe(false)
  })
})
