// Décision produit du 04/09/2026, option (a) : pickImage() ne passe PLUS par le prompt
// natif CameraSource.Prompt du plugin @capacitor/camera. Cause racine (mesurée sur le
// Huawei le 04/09) : sur le chemin galerie, LegacyCameraFlow.java (v8.2.2) ré-encode TOUT
// en JPEG côté natif SANS remplissage — un PNG transparent devient un JPEG opaque fond
// noir AVANT d'atteindre la webview (octets identiques avec et sans fillRect en aval :
// l'alpha est cuite dans les pixels). Le geste « galerie » passe donc par un input
// fichier (le sélecteur système livre les octets D'ORIGINE), le geste « appareil photo »
// reste au plugin natif (photos opaques, pas de problème d'alpha). Les anciens tests de
// localisation des promptLabel* sont caducs : la feuille de choix est désormais MAISON
// (PhotoSourceSheet.vue, libellés vue-i18n couverts par photo-source-sheet.spec.js) et
// le plugin est appelé SANS aucun promptLabel*. Le seam e2e (VITE_E2E/__E2E_PHOTO__)
// reste EN TÊTE de pickImage, inchangé — non testable ici (VITE_E2E undefined en test),
// vérifié à la relecture.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'

const getPhotoMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ dataUrl: 'data:image/jpeg;base64,AAAA' }),
)
vi.mock('@capacitor/camera', () => ({
  Camera: { getPhoto: (...args) => getPhotoMock(...args) },
  CameraResultType: { DataUrl: 'dataUrl' },
  CameraSource: { Camera: 'CAMERA' },
}))
// Store photo-source mocké : la feuille maison (askSource → 'gallery' | 'camera' | null)
// est couverte en isolation par photo-source-store.spec.js et photo-source-sheet.spec.js.
const askSourceMock = vi.hoisted(() => vi.fn())
vi.mock('@/stores/photo-source', () => ({
  usePhotoSourceStore: () => ({ askSource: (...args) => askSourceMock(...args) }),
}))
// resizeDataUrl réel non nécessaire ici : on vérifie les arguments de l'appel, pas le
// pipeline de redimensionnement (déjà couvert par tests/unit/image-resize.spec.js).
const resizeDataUrlMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue('data:image/jpeg;base64,RESIZED'),
)
vi.mock('@/utils/image-resize', () => ({ resizeDataUrl: (...args) => resizeDataUrlMock(...args) }))

import { fileToDataUrl, pickImage } from '@/utils/photo'

// Stub de l'input fichier, au motif du stub canvas d'image-resize.spec.js : createElement
// espionné ne remplace QUE l'input — le rendu Vue (et tout autre createElement) continue
// de créer ses vrais éléments. Le faux input capture les écouteurs change/cancel posés
// par pickImage ; le test les déclenche avec un `files` factice.
const realCreateElement = document.createElement.bind(document)

function stubFileInput(files) {
  const listeners = {}
  const fake = {
    type: '',
    accept: '',
    files,
    click: vi.fn(),
    addEventListener: (ev, fn) => {
      listeners[ev] = fn
    },
  }
  vi.spyOn(document, 'createElement').mockImplementation((tag, ...rest) =>
    tag === 'input' ? fake : realCreateElement(tag, ...rest),
  )
  return { fake, listeners }
}

// FileReader stubé : readAsDataURL résout en microtask avec une data URL factice —
// jsdom ne lit pas les vrais octets (et le fichier du test n'en a pas).
class FakeFileReader {
  readAsDataURL(_file) {
    this.result = 'data:image/png;base64,ORIG'
    queueMicrotask(() => this.onload?.())
  }
}

beforeEach(() => {
  getPhotoMock.mockClear().mockResolvedValue({ dataUrl: 'data:image/jpeg;base64,AAAA' })
  resizeDataUrlMock.mockClear().mockResolvedValue('data:image/jpeg;base64,RESIZED')
  askSourceMock.mockReset()
  vi.stubGlobal('FileReader', FakeFileReader)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('pickImage — chemin « appareil photo » (plugin natif, sans prompt natif)', () => {
  it("askSource → 'camera' : getPhoto en source Camera, AUCUN promptLabel*, puis resizeDataUrl", async () => {
    askSourceMock.mockResolvedValue('camera')

    const result = await pickImage()

    expect(askSourceMock).toHaveBeenCalledTimes(1)
    expect(getPhotoMock).toHaveBeenCalledTimes(1)
    const opts = getPhotoMock.mock.calls[0][0]
    expect(opts.source).toBe('CAMERA') // CameraSource.Camera du mock
    expect(opts.allowEditing).toBe(false)
    expect(opts.resultType).toBe('dataUrl')
    expect(opts.quality).toBe(80)
    expect(opts.width).toBe(1600)
    // La feuille maison remplace le prompt natif : plus AUCUN libellé à passer au plugin.
    expect('promptLabelHeader' in opts).toBe(false)
    expect('promptLabelPhoto' in opts).toBe(false)
    expect('promptLabelPicture' in opts).toBe(false)
    expect('promptLabelCancel' in opts).toBe(false)
    expect(resizeDataUrlMock).toHaveBeenCalledWith('data:image/jpeg;base64,AAAA', 1280, 0.8)
    expect(result).toBe('data:image/jpeg;base64,RESIZED')
  })

  it('échec/annulation du plugin → null (le try/catch tient toujours)', async () => {
    askSourceMock.mockResolvedValue('camera')
    getPhotoMock.mockRejectedValueOnce(new Error('cancelled'))
    await expect(pickImage()).resolves.toBeNull()
  })

  it('photo sans dataUrl → null', async () => {
    askSourceMock.mockResolvedValue('camera')
    getPhotoMock.mockResolvedValueOnce({})
    await expect(pickImage()).resolves.toBeNull()
    expect(resizeDataUrlMock).not.toHaveBeenCalled()
  })
})

describe('pickImage — annulation à la feuille maison', () => {
  it('askSource → null : renvoie null sans toucher au plugin ni au redimensionneur', async () => {
    askSourceMock.mockResolvedValue(null)

    await expect(pickImage()).resolves.toBeNull()

    expect(getPhotoMock).not.toHaveBeenCalled()
    expect(resizeDataUrlMock).not.toHaveBeenCalled()
  })
})

describe('pickImage — chemin « galerie » (input fichier, octets d’origine)', () => {
  it('crée un input file accept image/*, le clique ; change+File → lecture puis resizeDataUrl(…, 1280, 0.8)', async () => {
    askSourceMock.mockResolvedValue('gallery')
    const { fake, listeners } = stubFileInput([{ name: 'croquis.png', type: 'image/png' }])

    const promise = pickImage()
    await flushPromises() // laisse askSource résoudre, l'input se créer et se cliquer

    expect(fake.type).toBe('file')
    expect(fake.accept).toBe('image/*')
    expect(fake.click).toHaveBeenCalledTimes(1)
    expect(getPhotoMock).not.toHaveBeenCalled() // la galerie ne passe PAS par le plugin

    listeners.change()
    await expect(promise).resolves.toBe('data:image/jpeg;base64,RESIZED')
    // Le dataUrl LIT le fichier d'origine (FileReader stubé), puis borne/aplatit :
    expect(resizeDataUrlMock).toHaveBeenCalledWith('data:image/png;base64,ORIG', 1280, 0.8)
  })

  it('cancel du sélecteur système → null, aucun redimensionnement', async () => {
    askSourceMock.mockResolvedValue('gallery')
    const { listeners } = stubFileInput([])

    const promise = pickImage()
    await flushPromises()

    listeners.cancel()
    await expect(promise).resolves.toBeNull()
    expect(resizeDataUrlMock).not.toHaveBeenCalled()
  })

  it('change sans fichier → null (garde files vide)', async () => {
    askSourceMock.mockResolvedValue('gallery')
    const { listeners } = stubFileInput([])

    const promise = pickImage()
    await flushPromises()

    listeners.change()
    await expect(promise).resolves.toBeNull()
    expect(resizeDataUrlMock).not.toHaveBeenCalled()
  })

  it('échec de lecture du fichier → null (try/catch global du chemin galerie)', async () => {
    askSourceMock.mockResolvedValue('gallery')
    class FailingReader {
      readAsDataURL(_file) {
        queueMicrotask(() => this.onerror?.())
      }
    }
    vi.stubGlobal('FileReader', FailingReader)
    const { listeners } = stubFileInput([{ name: 'corrompu.png', type: 'image/png' }])

    const promise = pickImage()
    await flushPromises()

    listeners.change()
    await expect(promise).resolves.toBeNull()
    expect(resizeDataUrlMock).not.toHaveBeenCalled()
  })
})

describe('fileToDataUrl — lecture du File en data URL (seam DOM du chemin galerie)', () => {
  it('résout avec reader.result après readAsDataURL(file)', async () => {
    const file = { name: 'croquis.png', type: 'image/png' }
    await expect(fileToDataUrl(file)).resolves.toBe('data:image/png;base64,ORIG')
  })
})
