import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock est hoisté en tête de fichier : les mocks référencés dans ses factories doivent
// l'être aussi (vi.hoisted), sinon TDZ sur les `const` — cf. doc Vitest.
const { writeFile, getUri, openFn, isNativePlatform } = vi.hoisted(() => ({
  writeFile: vi.fn().mockResolvedValue({ uri: 'file:///cache/patron.pdf' }),
  getUri: vi.fn().mockResolvedValue({ uri: 'file:///cache/patron.pdf' }),
  openFn: vi.fn().mockResolvedValue(undefined),
  isNativePlatform: vi.fn().mockReturnValue(true),
}))
vi.mock('@capacitor/filesystem', () => ({ Filesystem: { writeFile, getUri }, Directory: { Cache: 'CACHE' } }))
vi.mock('@capacitor-community/file-opener', () => ({ FileOpener: { open: openFn } }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform } }))

import { openPdfExternally } from '@/utils/open-pdf'

beforeEach(() => {
  vi.clearAllMocks()
  isNativePlatform.mockReturnValue(true)
})

describe('openPdfExternally', () => {
  it('natif : écrit le PDF en cache puis l’ouvre', async () => {
    await openPdfExternally('data:application/pdf;base64,QUJDRA==', 'mon.pdf')
    expect(writeFile).toHaveBeenCalledWith(expect.objectContaining({ directory: 'CACHE', path: 'mon.pdf' }))
    expect(getUri).toHaveBeenCalledWith(expect.objectContaining({ directory: 'CACHE', path: 'mon.pdf' }))
    // Le plugin @capacitor-community/file-opener attend `contentType` (pas `mimeType`, cf. son
    // FileOpenerOptions) : c'est le nom de champ réel de l'API installée, vérifié dans node_modules.
    expect(openFn).toHaveBeenCalledWith(expect.objectContaining({ filePath: 'file:///cache/patron.pdf', contentType: 'application/pdf' }))
  })

  it('web/dev : ouvre le data URL dans un nouvel onglet sans toucher au cache natif', async () => {
    isNativePlatform.mockReturnValue(false)
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => {})

    await openPdfExternally('data:application/pdf;base64,QUJDRA==', 'mon.pdf')

    expect(openSpy).toHaveBeenCalledWith('data:application/pdf;base64,QUJDRA==', '_blank')
    expect(writeFile).not.toHaveBeenCalled()
    openSpy.mockRestore()
  })
})
