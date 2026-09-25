// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { resizeDataUrl } from '@/utils/image-resize'

// Stub minimal d'Image : simule un décodage synchrone-ish (microtask) avec des
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

function stubCanvas() {
  const calls = []
  // méthodes en raccourci (PAS de fonctions fléchées) + référence à `ctx` par closure :
  // au moment du fillRect, on capture la valeur COURANTE de ctx.fillStyle (posée à '#fff'
  // par resizeDataUrl juste avant) — même technique que pdf-crop-margin.spec.js.
  const ctx = {
    fillStyle: '#000',
    fillRect(...a) { calls.push(['fillRect', ctx.fillStyle, ...a]) },
    drawImage(...a) { calls.push(['drawImage', ...a]) },
  }
  const fake = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toDataURL: (mime, quality) => {
      calls.push(['toDataURL', mime, quality])
      return 'data:image/jpeg;base64,ZZ'
    },
  }
  vi.spyOn(document, 'createElement').mockImplementation((tag) => (tag === 'canvas' ? fake : {}))
  return { fake, calls }
}

describe('resizeDataUrl', () => {
  afterEach(() => vi.restoreAllMocks())

  it("réencode TOUJOURS en JPEG, même si l'image est déjà sous le plafond (ferme le trou PNG)", async () => {
    stubImage(400, 300) // bien en dessous de 1280
    const { fake, calls } = stubCanvas()
    const result = await resizeDataUrl('data:image/png;base64,AA==', 1280, 0.8)
    expect(fake.width).toBe(400) // pas d'agrandissement ni de réduction : scale = 1
    expect(fake.height).toBe(300)
    expect(calls).toContainEqual(['toDataURL', 'image/jpeg', 0.8])
    expect(result).toBe('data:image/jpeg;base64,ZZ')
  })

  it('redimensionne au plafond quand le grand côté le dépasse', async () => {
    stubImage(2560, 1280) // grand côté 2560 → scale 0.5
    const { fake } = stubCanvas()
    await resizeDataUrl('data:image/jpeg;base64,AA==', 1280, 0.8)
    expect(fake.width).toBe(1280)
    expect(fake.height).toBe(640)
  })

  it('peint un fond blanc AVANT de dessiner (PNG transparent → pas de bandes noires, même règle que cropCanvas/pdf.js)', async () => {
    stubImage(400, 300)
    const { calls } = stubCanvas()
    await resizeDataUrl('data:image/png;base64,AA==', 1280, 0.8)
    const fill = calls.find((c) => c[0] === 'fillRect')
    const draw = calls.find((c) => c[0] === 'drawImage')
    expect(fill).toEqual(['fillRect', '#fff', 0, 0, 400, 300])
    expect(calls.indexOf(fill)).toBeLessThan(calls.indexOf(draw)) // blanc AVANT le dessin
  })

  it("renvoie la donnée d'origine si le décodage échoue", async () => {
    class FailingImage {
      set src(_v) {
        queueMicrotask(() => this.onerror?.())
      }
    }
    vi.stubGlobal('Image', FailingImage)
    const result = await resizeDataUrl('data:image/png;base64,AA==', 1280, 0.8)
    expect(result).toBe('data:image/png;base64,AA==')
  })
})
