import { describe, it, expect, vi } from 'vitest'
import { activateRowNotification, verifyRowNotificationAuthorization } from '@/utils/row-notification-activation'

function ports(over = {}) {
  return {
    checkPermission: vi.fn(async () => 'granted'),
    requestPermission: vi.fn(async () => 'granted'),
    markAsked: vi.fn(async () => {}),
    checkBattery: vi.fn(async () => ({ ignoring: true })),
    requestBattery: vi.fn(async () => ({ ignoring: true, fallback: false })),
    saveEnabled: vi.fn(async () => {}),
    ...over,
  }
}

describe('activateRowNotification', () => {
  it('tout est déjà accordé : activé, aucune demande', async () => {
    const p = ports()
    await expect(activateRowNotification(p)).resolves.toEqual({ enabled: true, reason: 'granted' })
    expect(p.requestPermission).not.toHaveBeenCalled()
    expect(p.requestBattery).not.toHaveBeenCalled()
    expect(p.saveEnabled).toHaveBeenCalledWith(true)
  })

  it('POST à demander : request puis markAsked, puis batterie', async () => {
    const p = ports({ checkPermission: vi.fn(async () => 'prompt') })
    await expect(activateRowNotification(p)).resolves.toEqual({ enabled: true, reason: 'granted' })
    expect(p.requestPermission).toHaveBeenCalledTimes(1)
    expect(p.markAsked).toHaveBeenCalledTimes(1)
    expect(p.saveEnabled).toHaveBeenLastCalledWith(true)
  })

  it('POST refusée (refus direct ou après demande) : désactivée, arrêt avant la batterie', async () => {
    for (const initial of ['denied', 'prompt']) {
      const p = ports({ checkPermission: vi.fn(async () => initial), requestPermission: vi.fn(async () => 'denied') })
      await expect(activateRowNotification(p)).resolves.toEqual({ enabled: false, reason: 'permission' })
      expect(p.saveEnabled).toHaveBeenCalledWith(false)
      expect(p.requestBattery).not.toHaveBeenCalled()
    }
  })

  it('dialogue batterie refusé : désactivée', async () => {
    const p = ports({
      checkBattery: vi.fn(async () => ({ ignoring: false })),
      requestBattery: vi.fn(async () => ({ ignoring: false, fallback: false })),
    })
    await expect(activateRowNotification(p)).resolves.toEqual({ enabled: false, reason: 'battery' })
    expect(p.saveEnabled).toHaveBeenLastCalledWith(false)
  })

  it('dialogue batterie accepté : activée', async () => {
    const p = ports({
      checkBattery: vi.fn(async () => ({ ignoring: false })),
      requestBattery: vi.fn(async () => ({ ignoring: true, fallback: false })),
    })
    await expect(activateRowNotification(p)).resolves.toEqual({ enabled: true, reason: 'granted' })
    expect(p.saveEnabled).toHaveBeenLastCalledWith(true)
  })

  it('chemin repli (liste) : RIEN n\'est écrit sur le résultat immédiat, activation en attente', async () => {
    const p = ports({
      checkBattery: vi.fn(async () => ({ ignoring: false })),
      requestBattery: vi.fn(async () => ({ ignoring: false, fallback: true })),
    })
    await expect(activateRowNotification(p)).resolves.toEqual({ enabled: false, reason: 'battery-pending' })
    expect(p.saveEnabled).not.toHaveBeenCalled()
  })

  it('chemin repli qui lit l\'exemption vraie au retour : accord immédiat (la relecture décide)', async () => {
    const p = ports({
      checkBattery: vi.fn(async () => ({ ignoring: false })),
      requestBattery: vi.fn(async () => ({ ignoring: true, fallback: true })),
    })
    await expect(activateRowNotification(p)).resolves.toEqual({ enabled: true, reason: 'granted' })
    expect(p.saveEnabled).toHaveBeenLastCalledWith(true)
  })

  it('markAsked reste réservé à la demande : jamais appelé si déjà accordé ou si refus direct', async () => {
    const accorde = ports()
    await activateRowNotification(accorde)
    expect(accorde.markAsked).not.toHaveBeenCalled()
    const refuse = ports({ checkPermission: vi.fn(async () => 'denied') })
    await activateRowNotification(refuse)
    expect(refuse.markAsked).not.toHaveBeenCalled()
  })
})

describe('verifyRowNotificationAuthorization', () => {
  it('complet : ok ; POST manquante : pas ok ; exemption absente : pas ok', async () => {
    await expect(
      verifyRowNotificationAuthorization({
        checkPermission: async () => 'granted',
        checkBattery: async () => ({ ignoring: true }),
      }),
    ).resolves.toEqual({ ok: true, permission: 'granted', battery: { ignoring: true } })
    await expect(
      verifyRowNotificationAuthorization({
        checkPermission: async () => 'prompt',
        checkBattery: async () => ({ ignoring: true }),
      }),
    ).resolves.toMatchObject({ ok: false })
    await expect(
      verifyRowNotificationAuthorization({
        checkPermission: async () => 'granted',
        checkBattery: async () => ({ ignoring: false }),
      }),
    ).resolves.toMatchObject({ ok: false })
  })
})
