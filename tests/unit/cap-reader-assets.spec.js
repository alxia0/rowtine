import { describe, it, expect, vi, afterEach } from 'vitest'
import { capDataUrlIfOversized } from '@/utils/image-resize'
import { capReaderAssets } from '@/backup/cap-reader-assets'

// Même stub qu'image-resize.spec.js : décodage synchrone-ish (microtask) avec
// dimensions contrôlées par le test, sans dépendre du décodage réel (absent sous jsdom).
function stubImage(width, height) {
  class FakeImage {
    set src(_v) {
      this.width = width
      this.height = height
      queueMicrotask(() => this.onload?.())
    }
  }
  vi.stubGlobal('Image', FakeImage)
}

function dataUrlOfSize(bytes) {
  // base64 : 4 caractères encodent 3 octets ; longueur choisie pour approcher `bytes`.
  return 'data:image/jpeg;base64,' + 'A'.repeat(Math.ceil((bytes * 4) / 3))
}

// Même stub qu'image-resize.spec.js : sans lui, `resizeDataUrl` échoue en silence
// sous jsdom (`canvas.getContext('2d')` renvoie null, pas de package `canvas`
// installé) et renvoie la dataURL D'ORIGINE — ce qui masquerait exactement le
// comportement de délégation qu'on veut vérifier ici (pas besoin de re-tester le
// détail du dessin canvas, déjà couvert par image-resize.spec.js).
function stubCanvas() {
  const ctx = { fillStyle: '#000', fillRect() {}, drawImage() {} }
  const fake = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toDataURL: () => 'data:image/jpeg;base64,RESIZED',
  }
  vi.spyOn(document, 'createElement').mockImplementation((tag) => (tag === 'canvas' ? fake : {}))
}

describe('capDataUrlIfOversized', () => {
  afterEach(() => vi.restoreAllMocks())

  it('sous le plafond poids ET dimensions : renvoyée intacte, resizeDataUrl jamais appelé', async () => {
    stubImage(400, 300) // bien sous maxDim=1280
    const small = dataUrlOfSize(1000)
    const out = await capDataUrlIfOversized(small, 1280, 0.8, 600_000)
    expect(out).toBe(small)
  })

  it('dimensions au-delà du plafond : plafonnée (délégué à resizeDataUrl)', async () => {
    stubImage(2560, 1280) // grand côté 2560 > 1280
    stubCanvas()
    const small = dataUrlOfSize(1000)
    const out = await capDataUrlIfOversized(small, 1280, 0.8, 600_000)
    expect(out).not.toBe(small)
  })

  it('poids au-delà du seuil (même si dimensions inconnues/petites) : plafonnée sans même décoder', async () => {
    // Pas de stub Image : le chemin poids doit résoudre AVANT toute tentative de `new Image()`.
    stubCanvas()
    const heavy = dataUrlOfSize(700_000)
    const out = await capDataUrlIfOversized(heavy, 1280, 0.8, 600_000)
    expect(out).not.toBe(heavy) // délégué à resizeDataUrl
  })

  it("chemin manquant (pas une data URL, ex. laissé tel quel par resolveReaderAssets) : renvoyé intact", async () => {
    const out = await capDataUrlIfOversized('gallery-x.png', 1280, 0.8, 600_000)
    expect(out).toBe('gallery-x.png')
  })
})

describe('capReaderAssets', () => {
  afterEach(() => vi.restoreAllMocks())

  it('parcourt sections/steps/chart/galerie et plafonne seulement les images hors gabarit', async () => {
    stubImage(400, 300) // toute image décodée est sous maxDim : seul le poids déclenche le plafond ici
    stubCanvas()
    const entity = {
      reader: {
        sections: [{ chart: { img: dataUrlOfSize(700_000) }, steps: [{ imgs: [dataUrlOfSize(1000)] }] }],
        chart: { img: dataUrlOfSize(1000) },
      },
      gallery: [{ src: dataUrlOfSize(700_000), page: 1, w: 10, h: 10 }],
    }
    const out = await capReaderAssets(entity)
    expect(out.reader.sections[0].chart.img).not.toBe(entity.reader.sections[0].chart.img)
    expect(out.reader.sections[0].steps[0].imgs[0]).toBe(entity.reader.sections[0].steps[0].imgs[0])
    expect(out.gallery[0].src).not.toBe(entity.gallery[0].src)
  })

  it('entity sans reader ni gallery : renvoyée telle quelle, pas de plantage', async () => {
    const out = await capReaderAssets({ id: 1, name: 'x' })
    expect(out).toEqual({ id: 1, name: 'x' })
  })
})
