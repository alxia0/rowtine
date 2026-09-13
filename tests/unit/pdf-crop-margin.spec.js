// tests/unit/pdf-crop-margin.spec.js
// cropCanvas : marge blanche horizontale pour les grilles.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mocke pdfjs-dist pour éviter l'import réel (DOMMatrix absent en jsdom)
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ GlobalWorkerOptions: {}, OPS: {} }))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

import { cropCanvas } from '@/utils/pdf'

// Faux canvas de sortie : enregistre width/height, l'ordre des appels ctx, et
// renvoie une data URL fixe. Pas de vrai <canvas> (non rendu sous Vitest).
function makeFakeCanvas(calls) {
  // méthodes en raccourci (PAS de fonctions fléchées) + référence à `ctx` par closure :
  // au moment du fillRect, on capture la valeur COURANTE de ctx.fillStyle (posée à '#fff'
  // par cropCanvas juste avant). Une fonction fléchée casserait ce `this`.
  const ctx = {
    fillStyle: '#000',
    fillRect(...a) { calls.push(['fillRect', ctx.fillStyle, ...a]) },
    drawImage(...a) { calls.push(['drawImage', ...a]) },
  }
  const out = {
    width: 0, height: 0,
    getContext: () => ctx,
    toDataURL: () => 'data:image/jpeg;base64,ZZ',
  }
  return out
}

describe('cropCanvas — marge blanche horizontale', () => {
  let calls, fake
  beforeEach(() => {
    calls = []
    fake = makeFakeCanvas(calls)
    vi.spyOn(document, 'createElement').mockImplementation((tag) =>
      tag === 'canvas' ? fake : {}
    )
  })
  afterEach(() => vi.restoreAllMocks())

  const cell = { x0: 10, y0: 20, x1: 110, y1: 70 } // 100×50

  it('padXFrac 0.08 : canvas élargi de 2×8 px, fond blanc peint avant le crop, crop décalé de padX', () => {
    cropCanvas({}, cell, 0.08)
    expect(fake.width).toBe(116) // 100 + 2*round(100*0.08)=100+16
    expect(fake.height).toBe(50)
    // 1er appel ctx = remplissage blanc pleine surface
    const fill = calls.find((c) => c[0] === 'fillRect')
    const draw = calls.find((c) => c[0] === 'drawImage')
    expect(fill).toEqual(['fillRect', '#fff', 0, 0, 116, 50])
    expect(calls.indexOf(fill)).toBeLessThan(calls.indexOf(draw)) // blanc AVANT crop
    // drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh) : dx = padX = 8
    expect(draw.slice(2)).toEqual([10, 20, 100, 50, 8, 0, 100, 50])
  })

  it('padXFrac 0 (défaut) : canvas exactement w×h, crop non décalé', () => {
    cropCanvas({}, cell)
    expect(fake.width).toBe(100)
    expect(fake.height).toBe(50)
    const draw = calls.find((c) => c[0] === 'drawImage')
    expect(draw.slice(2)).toEqual([10, 20, 100, 50, 0, 0, 100, 50])
  })

  it('plafonne à 1280px de long côté un crop qui le dépasse (diagramme large)', () => {
    // Deux canvas nécessaires : celui du crop initial (2000×400, dépasse 1280), puis celui du
    // downscale final. `document.createElement('canvas')` doit donc renvoyer un NOUVEL objet
    // à chaque appel (contrairement au `fake` unique des tests ci-dessus).
    const built = []
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag !== 'canvas') return {}
      const c = makeFakeCanvas([])
      built.push(c)
      return c
    })
    const bigCell = { x0: 0, y0: 0, x1: 2000, y1: 400 }
    const result = cropCanvas({}, bigCell, 0, 1280, 0.8)
    expect(built).toHaveLength(2) // canvas de crop + canvas de downscale
    const final = built[1]
    expect(final.width).toBe(1280)
    expect(final.height).toBe(256) // 400 * (1280/2000)
    expect(result).toBe('data:image/jpeg;base64,ZZ')
  })

  it('ne downscale pas un crop déjà sous le plafond (comportement inchangé)', () => {
    const built = []
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag !== 'canvas') return {}
      const c = makeFakeCanvas([])
      built.push(c)
      return c
    })
    cropCanvas({}, { x0: 10, y0: 20, x1: 110, y1: 70 }, 0, 1280, 0.8)
    expect(built).toHaveLength(1) // un seul canvas : pas de downscale nécessaire
  })
})
