import { describe, it, expect, afterEach, vi } from 'vitest'

// Pont JS du plugin natif KeepAwake : hors natif ou plugin absent, rien ne casse.
async function importerAvecMock(plugin, { natif = true } = {}) {
  vi.resetModules()
  vi.doMock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => natif },
    registerPlugin: () => plugin,
  }))
  return import('@/native/keep-awake')
}

afterEach(() => {
  vi.doUnmock('@capacitor/core')
})

describe('keep-awake (pont natif)', () => {
  it('hors natif : indisponible, setKeepScreenOn ne sollicite pas le plugin', async () => {
    const plugin = { set: vi.fn(() => Promise.resolve()) }
    const mod = await importerAvecMock(plugin, { natif: false })
    expect(mod.isKeepScreenOnAvailable()).toBe(false)
    await expect(mod.setKeepScreenOn(true)).resolves.toBeUndefined()
    expect(plugin.set).not.toHaveBeenCalled()
  })

  it('en natif : setKeepScreenOn transmet un booléen au plugin', async () => {
    const plugin = { set: vi.fn(() => Promise.resolve()) }
    const mod = await importerAvecMock(plugin)
    expect(mod.isKeepScreenOnAvailable()).toBe(true)
    await mod.setKeepScreenOn(true)
    await mod.setKeepScreenOn(0)
    expect(plugin.set).toHaveBeenNthCalledWith(1, { on: true })
    expect(plugin.set).toHaveBeenNthCalledWith(2, { on: false })
  })

  it('plugin qui rejette (ancienne APK) : setKeepScreenOn ne rejette pas', async () => {
    const plugin = { set: vi.fn(() => Promise.reject(new Error('plugin natif absent'))) }
    const mod = await importerAvecMock(plugin)
    await expect(mod.setKeepScreenOn(true)).resolves.toBeUndefined()
    expect(plugin.set).toHaveBeenCalledTimes(1)
  })
})
