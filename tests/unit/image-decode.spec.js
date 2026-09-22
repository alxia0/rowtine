import { describe, it, expect, vi, afterEach } from 'vitest'

const pickAndDecodeMock = vi.hoisted(() => vi.fn())
vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({ pickAndDecode: (...args) => pickAndDecodeMock(...args) }),
  Capacitor: { isNativePlatform: () => true },
}))

import { pickAndDecodeGalleryImage } from '@/native/image-decode'

afterEach(() => {
  vi.clearAllMocks()
})

describe('pickAndDecodeGalleryImage', () => {
  it('renvoie la dataUrl du plugin', async () => {
    pickAndDecodeMock.mockResolvedValue({ dataUrl: 'data:image/jpeg;base64,AAAA' })
    await expect(pickAndDecodeGalleryImage()).resolves.toBe('data:image/jpeg;base64,AAAA')
  })

  it('sélecteur annulé (dataUrl null) → null', async () => {
    pickAndDecodeMock.mockResolvedValue({ dataUrl: null })
    await expect(pickAndDecodeGalleryImage()).resolves.toBeNull()
  })

  it('échec de décodage du plugin → propage le rejet', async () => {
    pickAndDecodeMock.mockRejectedValue(new Error('décodage impossible'))
    await expect(pickAndDecodeGalleryImage()).rejects.toThrow('décodage impossible')
  })
})
