import { describe, it, expect, afterEach, vi } from 'vitest'

// Pont JS du plugin natif RowNotification : hors natif ou plugin absent, rien ne casse.
async function importerAvecMock(plugin, { natif = true } = {}) {
  vi.resetModules()
  vi.doMock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => natif },
    registerPlugin: () => plugin,
  }))
  return import('@/native/row-notification')
}

function pluginQuiRejette() {
  const rejet = () => Promise.reject(new Error('plugin natif absent'))
  return {
    show: vi.fn(rejet),
    cancel: vi.fn(rejet),
    checkPermissions: vi.fn(rejet),
    requestPermissions: vi.fn(rejet),
    openSettings: vi.fn(rejet),
    takeLaunchProject: vi.fn(rejet),
    addListener: vi.fn(rejet),
  }
}

afterEach(() => {
  vi.doUnmock('@capacitor/core')
})

describe('row-notification (pont natif)', () => {
  it('hors natif : showRowNotification ne sollicite pas le plugin', async () => {
    const plugin = { show: vi.fn(() => Promise.resolve()) }
    const mod = await importerAvecMock(plugin, { natif: false })
    expect(mod.isRowNotificationAvailable()).toBe(false)
    await expect(mod.showRowNotification({ projectId: 1, stepId: 's#0' })).resolves.toBeUndefined()
    expect(plugin.show).not.toHaveBeenCalled()
  })

  it('hors natif : permissions refusées, aucun projet de lancement, retrait sans effet', async () => {
    const mod = await importerAvecMock({}, { natif: false })
    await expect(mod.checkRowNotificationPermission()).resolves.toBe('denied')
    await expect(mod.requestRowNotificationPermission()).resolves.toBe('denied')
    await expect(mod.takeLaunchProject()).resolves.toBeNull()
    const retirer = await mod.onRowAction(() => {})
    expect(() => retirer()).not.toThrow()
  })

  it('en natif : showRowNotification transmet la charge au plugin', async () => {
    const plugin = { show: vi.fn(() => Promise.resolve()) }
    const mod = await importerAvecMock(plugin)
    const charge = { projectId: 3, stepId: 'a#2', title: 'Rang 1/4, Dos' }
    await mod.showRowNotification(charge)
    expect(plugin.show).toHaveBeenCalledWith(charge)
  })

  it('en natif : cancelRowNotification et openRowNotificationSettings appellent le plugin', async () => {
    const plugin = { cancel: vi.fn(() => Promise.resolve()), openSettings: vi.fn(() => Promise.resolve()) }
    const mod = await importerAvecMock(plugin)
    await expect(mod.cancelRowNotification()).resolves.toBeUndefined()
    await expect(mod.openRowNotificationSettings()).resolves.toBeUndefined()
    expect(plugin.cancel).toHaveBeenCalledTimes(1)
    expect(plugin.openSettings).toHaveBeenCalledTimes(1)
  })

  it('un remove() qui rejette ne laisse fuir aucun rejet', async () => {
    const plugin = { addListener: vi.fn(() => Promise.resolve({ remove: () => Promise.reject(new Error('pont fermé')) })) }
    const mod = await importerAvecMock(plugin)
    const unhandled = []
    const onUnhandled = (err) => unhandled.push(err)
    process.on('unhandledRejection', onUnhandled)
    try {
      const retirer = await mod.onRowAction(() => {})
      expect(() => retirer()).not.toThrow()
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
    expect(unhandled).toEqual([])
  })

  it('en natif : onRowAction pose l’écouteur rowAction et la fonction rendue le retire', async () => {
    const remove = vi.fn(() => Promise.resolve())
    const plugin = { addListener: vi.fn(() => Promise.resolve({ remove })) }
    const mod = await importerAvecMock(plugin)
    const cb = vi.fn()
    const retirer = await mod.onRowAction(cb)
    expect(plugin.addListener).toHaveBeenCalledWith('rowAction', cb)
    retirer()
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('en natif : onOpenProject pose l’écouteur openProject', async () => {
    const remove = vi.fn(() => Promise.resolve())
    const plugin = { addListener: vi.fn(() => Promise.resolve({ remove })) }
    const mod = await importerAvecMock(plugin)
    const cb = vi.fn()
    const retirer = await mod.onOpenProject(cb)
    expect(plugin.addListener).toHaveBeenCalledWith('openProject', cb)
    retirer()
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('plugin qui rejette : aucune fonction ne rejette, permissions refusées', async () => {
    const mod = await importerAvecMock(pluginQuiRejette())
    await expect(mod.showRowNotification({ projectId: 1 })).resolves.toBeUndefined()
    await expect(mod.cancelRowNotification()).resolves.toBeUndefined()
    await expect(mod.checkRowNotificationPermission()).resolves.toBe('denied')
    await expect(mod.requestRowNotificationPermission()).resolves.toBe('denied')
    await expect(mod.openRowNotificationSettings()).resolves.toBeUndefined()
    await expect(mod.takeLaunchProject()).resolves.toBeNull()
    const retirer = await mod.onRowAction(() => {})
    expect(() => retirer()).not.toThrow()
    const retirerOuvrir = await mod.onOpenProject(() => {})
    expect(() => retirerOuvrir()).not.toThrow()
  })

  it('lit l’alias notifications et ramène prompt-with-rationale à prompt', async () => {
    const etats = ['granted', 'prompt-with-rationale', 'prompt', 'denied']
    const plugin = {
      checkPermissions: vi.fn(() => Promise.resolve({ notifications: etats.shift() })),
      requestPermissions: vi.fn(() => Promise.resolve({ notifications: 'granted' })),
    }
    const mod = await importerAvecMock(plugin)
    await expect(mod.checkRowNotificationPermission()).resolves.toBe('granted')
    await expect(mod.checkRowNotificationPermission()).resolves.toBe('prompt')
    await expect(mod.checkRowNotificationPermission()).resolves.toBe('prompt')
    await expect(mod.checkRowNotificationPermission()).resolves.toBe('denied')
    await expect(mod.requestRowNotificationPermission()).resolves.toBe('granted')
  })

  it('takeLaunchProject : null sans projectId, sinon le nombre', async () => {
    const reponses = [{ projectId: null }, {}, { projectId: 42 }]
    const plugin = { takeLaunchProject: vi.fn(() => Promise.resolve(reponses.shift())) }
    const mod = await importerAvecMock(plugin)
    await expect(mod.takeLaunchProject()).resolves.toBeNull()
    await expect(mod.takeLaunchProject()).resolves.toBeNull()
    await expect(mod.takeLaunchProject()).resolves.toBe(42)
  })
})
