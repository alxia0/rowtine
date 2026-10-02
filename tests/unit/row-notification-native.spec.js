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
    isIgnoringBatteryOptimizations: vi.fn(rejet),
    requestIgnoreBatteryOptimizations: vi.fn(rejet),
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

  it('readPendingRowAction : l’appui retenu passe tel quel, l’effacement est délégué', async () => {
    const plugin = {
      readPendingRowAction: vi.fn(() => Promise.resolve({ projectId: 7, stepId: 'sec#2', delta: -1 })),
      clearPendingRowAction: vi.fn(() => Promise.resolve()),
    }
    const mod = await importerAvecMock(plugin)
    await expect(mod.readPendingRowAction()).resolves.toEqual({ projectId: 7, stepId: 'sec#2', delta: -1 })
    expect(plugin.readPendingRowAction).toHaveBeenCalledTimes(1)
    await expect(mod.clearPendingRowAction()).resolves.toBeUndefined()
    expect(plugin.clearPendingRowAction).toHaveBeenCalledTimes(1)
  })

  it('readPendingRowAction : rien de retenu (objet vide), rejet du plugin, hors natif : null sans lever', async () => {
    const vide = await importerAvecMock({ readPendingRowAction: vi.fn(() => Promise.resolve({})) })
    await expect(vide.readPendingRowAction()).resolves.toBeNull()

    const rejet = await importerAvecMock({ readPendingRowAction: vi.fn(() => Promise.reject(new Error('absent'))) })
    await expect(rejet.readPendingRowAction()).resolves.toBeNull()

    const hors = await importerAvecMock(
      { readPendingRowAction: vi.fn(() => Promise.resolve({ stepId: 'x' })) },
      { natif: false },
    )
    await expect(hors.readPendingRowAction()).resolves.toBeNull()
  })

  it('readPendingRowAction : le tapId est transmis quand le natif en fournit un, absent sinon', async () => {
    const avec = await importerAvecMock({
      readPendingRowAction: vi.fn(() => Promise.resolve({ projectId: 7, stepId: 'sec#2', delta: 1, tapId: '17-3' })),
    })
    await expect(avec.readPendingRowAction()).resolves.toEqual({ projectId: 7, stepId: 'sec#2', delta: 1, tapId: '17-3' })
    const sans = await importerAvecMock({
      readPendingRowAction: vi.fn(() => Promise.resolve({ projectId: 7, stepId: 'sec#2', delta: 1, tapId: '' })),
    })
    const lu = await sans.readPendingRowAction()
    expect(lu).toEqual({ projectId: 7, stepId: 'sec#2', delta: 1 })
    expect('tapId' in lu).toBe(false)
  })

  it('ackRowAction : transmet tapId et keep au plugin ; no-op hors natif, sans tapId, plugin absent ou rejet', async () => {
    const plugin = { ackRowAction: vi.fn(() => Promise.resolve()) }
    const mod = await importerAvecMock(plugin)
    await mod.ackRowAction('17-3')
    expect(plugin.ackRowAction).toHaveBeenLastCalledWith({ tapId: '17-3', keep: false })
    await mod.ackRowAction('17-4', { keep: true })
    expect(plugin.ackRowAction).toHaveBeenLastCalledWith({ tapId: '17-4', keep: true })
    plugin.ackRowAction.mockClear()
    await expect(mod.ackRowAction('')).resolves.toBeUndefined()
    await expect(mod.ackRowAction(undefined)).resolves.toBeUndefined()
    expect(plugin.ackRowAction).not.toHaveBeenCalled()

    const hors = { ackRowAction: vi.fn(() => Promise.resolve()) }
    const modHors = await importerAvecMock(hors, { natif: false })
    await expect(modHors.ackRowAction('17-3')).resolves.toBeUndefined()
    expect(hors.ackRowAction).not.toHaveBeenCalled()

    const rejet = await importerAvecMock({ ackRowAction: vi.fn(() => Promise.reject(new Error('absent'))) })
    await expect(rejet.ackRowAction('17-3')).resolves.toBeUndefined()
  })

  it('hors natif : la contrainte batterie n\'existe pas, tout se résout « ignoré »', async () => {
    const plugin = {
      isIgnoringBatteryOptimizations: vi.fn(() => Promise.resolve({ ignoring: false })),
      requestIgnoreBatteryOptimizations: vi.fn(() => Promise.resolve({ ignoring: false, fallback: true })),
    }
    const mod = await importerAvecMock(plugin, { natif: false })
    await expect(mod.isBatteryOptimizationIgnored()).resolves.toEqual({ ignoring: true })
    await expect(mod.requestIgnoreBatteryOptimizations()).resolves.toEqual({ ignoring: true, fallback: false })
    expect(plugin.isIgnoringBatteryOptimizations).not.toHaveBeenCalled()
    expect(plugin.requestIgnoreBatteryOptimizations).not.toHaveBeenCalled()
  })

  it('en natif : les réponses du plugin passent telles quelles', async () => {
    const plugin = {
      isIgnoringBatteryOptimizations: vi.fn(() => Promise.resolve({ ignoring: false })),
      requestIgnoreBatteryOptimizations: vi.fn(() => Promise.resolve({ ignoring: true, fallback: false })),
    }
    const mod = await importerAvecMock(plugin)
    await expect(mod.isBatteryOptimizationIgnored()).resolves.toEqual({ ignoring: false })
    await expect(mod.requestIgnoreBatteryOptimizations()).resolves.toEqual({ ignoring: true, fallback: false })
  })

  it('plugin d\'avant ce lot (méthode absente) ou rejet : lu « ignoré », jamais de blocage fantôme', async () => {
    const absent = await importerAvecMock({}) // ni l'une ni l'autre : call() rend undefined
    await expect(absent.isBatteryOptimizationIgnored()).resolves.toEqual({ ignoring: true })
    await expect(absent.requestIgnoreBatteryOptimizations()).resolves.toEqual({ ignoring: true, fallback: false })

    const rejet = await importerAvecMock(pluginQuiRejette())
    await expect(rejet.isBatteryOptimizationIgnored()).resolves.toEqual({ ignoring: true })
    await expect(rejet.requestIgnoreBatteryOptimizations()).resolves.toEqual({ ignoring: true, fallback: false })
  })
})
