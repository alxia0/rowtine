// @vitest-environment jsdom
// Unitaire — finir l'onboarding note la version installée comme déjà vue.
//
// Sans cela, l'accueil monté juste après l'onboarding (`onboarded` vrai, aucun marqueur)
// prendrait une installation neuve pour une mise à jour et lui montrerait les nouveautés.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db, getSetting } from '@/db/db'
import { APP_VERSION } from '@/constants/app-info'
import { useSettingsStore } from '@/stores/settings'

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('completeOnboarding et lastSeenVersion', () => {
  it('écrit la version installée en base, et dans le store', async () => {
    const s = useSettingsStore()
    await s.load()
    await s.completeOnboarding({ firstName: 'Alex', technique: 'knitting' })
    expect(await getSetting('lastSeenVersion')).toBe(APP_VERSION)
    expect(s.lastSeenVersion).toBe(APP_VERSION)
  })
})

describe('ordre des écritures de completeOnboarding', () => {
  it('pose lastSeenVersion AVANT onboarded (un arrêt entre les deux ne doit pas laisser onboarded sans marqueur)', async () => {
    const s = useSettingsStore()
    await s.load()
    const ordre = []
    const reel = db.settings.put.bind(db.settings)
    const espion = vi.spyOn(db.settings, 'put').mockImplementation((row) => {
      ordre.push(row.key)
      return reel(row)
    })
    await s.completeOnboarding({ firstName: 'Alex', technique: 'knitting' })
    espion.mockRestore()
    expect(ordre).toContain('lastSeenVersion')
    expect(ordre).toContain('onboarded')
    expect(ordre.indexOf('lastSeenVersion')).toBeLessThan(ordre.indexOf('onboarded'))
  })
})
