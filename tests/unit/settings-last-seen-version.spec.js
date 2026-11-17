// @vitest-environment jsdom
// Unitaire — le réglage `lastSeenVersion` (pop-up « Nouveautés » après mise à jour).
//
// Absent (`null`) = installation d'avant la fonction OU première installation : c'est la
// décision `decideReleaseNotice` qui les départage, pas ce réglage. Le marqueur n'est PAS
// sauvegardé : il décrit CET appareil, une restauration ne doit pas le rejouer.
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db, getSetting, setSetting } from '@/db/db'
import { useSettingsStore } from '@/stores/settings'
import { serializeSettings } from '@/backup/serialize'

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('lastSeenVersion', () => {
  it('vaut null sur une base vierge', async () => {
    const s = useSettingsStore()
    await s.load()
    expect(s.lastSeenVersion).toBeNull()
  })

  it('reste null sur une base ancienne (onboardée, clé absente)', async () => {
    await setSetting('onboarded', true)
    expect(await getSetting('lastSeenVersion')).toBeUndefined()
    const s = useSettingsStore()
    await s.load()
    expect(s.onboarded).toBe(true)
    expect(s.lastSeenVersion).toBeNull()
  })

  it('setLastSeenVersion() pose la valeur en mémoire ET en base', async () => {
    const s = useSettingsStore()
    await s.load()
    await s.setLastSeenVersion('1.4.3')
    expect(s.lastSeenVersion).toBe('1.4.3')
    expect(await getSetting('lastSeenVersion')).toBe('1.4.3')
  })

  it('un store neuf sur la même base relit la valeur', async () => {
    const s = useSettingsStore()
    await s.load()
    await s.setLastSeenVersion('1.4.3')

    setActivePinia(createPinia())
    const s2 = useSettingsStore()
    await s2.load()
    expect(s2.lastSeenVersion).toBe('1.4.3')
  })
})

describe('sauvegarde', () => {
  it('serializeSettings écarte lastSeenVersion mais garde les autres réglages', () => {
    const out = JSON.parse(serializeSettings({ lastSeenVersion: '1.4.3', firstName: 'x' }).data)
    expect(out).not.toHaveProperty('lastSeenVersion')
    expect(out.firstName).toBe('x')
  })
})
