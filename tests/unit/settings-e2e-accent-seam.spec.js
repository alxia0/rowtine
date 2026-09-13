// Unitaire — seam e2e de la teinte d'accent (alternance des couleurs par défaut des
// captures du guide, spéc 2026-09-05) : l'ACTION du store, testée indépendamment de
// l'enregistrement window (VITE_E2E n'est pas défini sous vitest — motif action +
// enregistrement conditionnel).
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db, getSetting } from '@/db/db'
import { useSettingsStore } from '@/stores/settings'
import { generatePalette } from '@/theme/palette'

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
  document.documentElement.style.cssText = '' // repartir de tokens vierges
})

// `theme` est posé explicitement ('light'/'dark') : resolveEffective('system') dépendrait
// de matchMedia sous jsdom, le test ne doit tenir qu'au code du store.
const brandApplique = () => document.documentElement.style.getPropertyValue('--brand')

describe('e2eSetAccentHue (seam captures du guide)', () => {
  it('force une teinte comme le nuancier : mémoire + base + marqueur de choix, tokens appliqués', async () => {
    const store = useSettingsStore()
    store.theme = 'light'
    await store.e2eSetAccentHue(320)
    expect(store.accentHue).toBe(320)
    expect(store.accentHueChosen).toBe(true)
    expect(await getSetting('accentHue')).toBe(320)
    expect(await getSetting('accentHueChosen')).toBe(true)
    expect(brandApplique()).toBe(generatePalette(320, 'light')['--brand'])
  })

  it('null ramène le DÉFAUT DYNAMIQUE : marqueur effacé en mémoire ET en base, tokens au défaut du thème', async () => {
    const store = useSettingsStore()
    store.theme = 'light'
    await store.e2eSetAccentHue(320)
    await store.e2eSetAccentHue(null)
    expect(store.accentHueChosen).toBe(false)
    expect(await getSetting('accentHueChosen')).toBe(false)
    expect(brandApplique()).toBe(generatePalette(230, 'light')['--brand'])
    expect(store.effectiveAccentHue('light')).toBe(230)
  })

  it('null en thème sombre applique le défaut sombre (320)', async () => {
    const store = useSettingsStore()
    store.theme = 'dark'
    await store.e2eSetAccentHue(null)
    expect(brandApplique()).toBe(generatePalette(320, 'dark')['--brand'])
  })
})
