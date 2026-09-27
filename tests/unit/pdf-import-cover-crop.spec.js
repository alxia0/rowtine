import { describe, it, expect } from 'vitest'
import { coverCropBox } from '@/utils/pdf-import/cover-crop'

const L = (text, size, y, x = 20) => ({ text, size, bold: false, y, parts: [{ x, text }] })
// Photo de page 1 (x, y = bord haut en points ; w, h en px CSS affichés).
const IMG = (x, y, wPt, hPt, extra = {}) => ({ page: 1, x, y, w: Math.round(wPt * 96 / 72), h: Math.round(hPt * 96 / 72), ...extra })
const PAGE = { pageWidth: 391, pageHeight: 595 }

// Géométrie réelle de la page 1 de Katia Merino Aran : photo en haut à gauche, titre et
// descriptif dessous, instructions en dessous et dans toute la colonne de droite.
const body = (x, fromY, n) => Array.from({ length: n }, (_, i) => L(`Col. ${i} verde botella: –a) 2 –b) 2 –c) 3 ovillos`, 8, fromY - i * 10.5, x))
const MERINO = [
  L('M E R I N O A R A N', 15, 239, 44),
  L('JERSEY MUJER / PULL FEMME /', 9, 217, 41),
  L("WOMAN'S JUMPER / DAMESTRUI /", 9, 207, 34),
  L('DAMEN PULLOVER / MAGLIONE DONNA', 9, 196, 22),
  L('ES JERSEY MUJER', 8, 164, 24),
  ...body(20, 143, 10),
  ...body(201, 542, 48),
]
const HERO = IMG(-1, 596, 193, 328)

describe('coverCropBox', () => {
  // Protège la couverture d'une page 1 qui porte aussi les instructions : photo, titre et descriptif seuls.
  it('cadre la photo et le bloc titre-descriptif collé dessous, sans les instructions', () => {
    const box = coverCropBox({ lines: MERINO, images: [HERO], ...PAGE })
    expect(box).not.toBeNull()
    expect(box.x0).toBe(0)
    expect(box.x1).toBeLessThan(201)
    expect(box.y1).toBe(595)
    expect(box.y0).toBeLessThan(196)
    expect(box.y0).toBeGreaterThan(164)
  })

  it('garde la page entière quand la page 1 est une vraie couverture', () => {
    const lines = [L('M E R I N O A R A N', 15, 239, 44), L('Katia 2024', 8, 30, 20)]
    expect(coverCropBox({ lines, images: [HERO], ...PAGE })).toBeNull()
  })

  it('garde la page entière sans photo assez grande', () => {
    expect(coverCropBox({ lines: MERINO, images: [IMG(10, 590, 60, 40)], ...PAGE })).toBeNull()
  })

  it('écarte un logo répété et un diagramme', () => {
    expect(coverCropBox({ lines: MERINO, images: [{ ...HERO, repeated: true }], ...PAGE })).toBeNull()
    expect(coverCropBox({ lines: MERINO, images: [{ ...HERO, kind: 'grid' }], ...PAGE })).toBeNull()
  })

  it('reprend un titre posé au-dessus de la photo', () => {
    const lines = [L('Pull Aran', 20, 570, 30), ...body(20, 200, 12), ...body(201, 560, 40)]
    const box = coverCropBox({ lines, images: [IMG(0, 545, 190, 300)], ...PAGE })
    expect(box.y1).toBeGreaterThan(585)
    expect(box.y0).toBeGreaterThan(200)
  })

  it('réunit deux photos côte à côte avec le titre au-dessus et le descriptif dessous', () => {
    // Géométrie réelle de DROPS Lisbon Tiles (page A4).
    const A4 = { pageWidth: 596, pageHeight: 843 }
    const lines = [
      L('Lisbon Tiles', 19.2, 703, 240),
      L('#lisbontilesshawl', 12.3, 688, 246),
      L('Szal na szydełku składający się z kwadratów, z włóczki DROPS Kid-Silk.', 12.3, 315, 63),
      ...body(63, 284, 20),
    ]
    const box = coverCropBox({ lines, images: [IMG(77, 671, 203, 313), IMG(306, 671, 203, 313)], ...A4 })
    expect(box.x0).toBeLessThan(63)
    expect(box.x1).toBeGreaterThan(509)
    expect(box.y1).toBeGreaterThan(703)
    expect(box.y0).toBeLessThan(315)
    expect(box.y0).toBeGreaterThan(284)
  })

  it('s’arrête à la première ligne du corps de texte, même collée au titre', () => {
    // Géométrie réelle de Hobbii Delight - Col : le matériel suit le titre à 25 pt.
    const A4 = { pageWidth: 595, pageHeight: 842 }
    const lines = [
      L('Delight - Col', 28.1, 347, 221),
      L('No. 1001-203-5288', 10.1, 320, 255),
      L('Matériel:', 12, 295, 51),
      ...Array.from({ length: 30 }, (_, i) => L(`Circonférence : environ ${i} cm, longueur environ 36 cm`, 12, 279 - i * 16, 51)),
    ]
    const box = coverCropBox({ lines, images: [IMG(51, 755, 495, 371)], ...A4 })
    expect(box.y0).toBeLessThan(320)
    expect(box.y0).toBeGreaterThan(295)
  })

  it('ne prend pas pour photo un bandeau qui déborde de la page', () => {
    // Géométrie réelle de Sola Sweater : bandeau de 2 471 pt de large, visible sur 99 pt de haut.
    const A4 = { pageWidth: 595, pageHeight: 842 }
    const lines = [L('Sola sweater', 20, 705, 245), ...body(315, 579, 40)]
    const box = coverCropBox({ lines, images: [IMG(209, 1057, 2471, 314), IMG(72, 679, 208, 270)], ...A4 })
    expect(box.x0).toBe(72)
    expect(box.y1).toBeLessThan(705)
  })

  it('n’englobe pas le texte posé entre deux photos décalées', () => {
    // Géométrie réelle de Filcolana Erik : colonne de matériel au-dessus de la photo de gauche.
    const A4 = { pageWidth: 595, pageHeight: 842 }
    const lines = [...body(42, 420, 12), ...body(305, 780, 4)]
    const box = coverCropBox({ lines, images: [IMG(305, 422, 249, 332), IMG(41, 280, 249, 191)], ...A4 })
    expect(box.x0).toBeGreaterThanOrEqual(300)
  })

  it('photo seule quand le texte collé est un long bloc d’instructions', () => {
    const lines = [...body(20, 255, 20), ...body(201, 560, 40)]
    const box = coverCropBox({ lines, images: [HERO], ...PAGE })
    expect(box.y0).toBeGreaterThanOrEqual(255)
  })
})
