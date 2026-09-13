import { describe, it, expect } from 'vitest'
import { associateImages } from '@/utils/pdf-import/associate'

// Page 0 : deux lignes de texte, y décroissant vers le bas de page.
const linesByPage = [
  [
    { text: 'Rép. les rangs 2-3, encore 10 fois.', y: 500 },
    { text: 'Monter 96 mailles.', y: 700 },
  ],
]

const sections = [
  {
    id: 's1',
    steps: [
      { t: 'Monter {{0}} mailles.', c: [[96]] },
      { t: 'Rép. les rangs 2-3, encore 10 fois.', c: [] },
    ],
  },
]

const img = (o) => ({ src: 'data:image/png;base64,AAA', page: 1, x: 40, y: 470, w: 300, h: 200, ...o })

describe('associateImages', () => {
  it('ancre l’image à la ligne juste au-dessus et la relie au bon step', () => {
    const { sections: out, gallery } = associateImages(sections, [img()], linesByPage)
    // image (y_top=470) → ligne la plus proche AU-DESSUS = "Rép..." (y=500)
    expect(out[0].steps[1].imgs).toEqual(['data:image/png;base64,AAA'])
    expect(out[0].steps[0].imgs).toBeUndefined()
    // reliée ⇒ absente de la galerie
    expect(gallery).toEqual([])
  })

  it('matching insensible aux accents et aux marqueurs {{i}}', () => {
    const secs = [{ id: 's', steps: [{ t: 'Tricoter {{0}} m. à l’endroit', c: [[10]] }] }]
    const pages = [[{ text: 'Tricoter 10 m. a l endroit', y: 600 }]]
    const { sections: out, gallery } = associateImages(secs, [img({ y: 560 })], pages)
    expect(out[0].steps[0].imgs).toHaveLength(1)
    expect(gallery).toHaveLength(0)
  })

  it('sans ligne d’ancrage sûre → image en galerie, aucun imgs', () => {
    // image très haut (y_top=1200), aucune ligne au-dessus dans la limite → galerie
    const { sections: out, gallery } = associateImages(sections, [img({ y: 1200 })], linesByPage)
    expect(out[0].steps.every((s) => !s.imgs)).toBe(true)
    expect(gallery).toEqual([{ src: 'data:image/png;base64,AAA', page: 1, w: 300, h: 200 }])
  })

  it('ligne sans step correspondant → galerie', () => {
    const pages = [[{ text: 'Texte sans équivalent dans le reader', y: 500 }]]
    const { sections: out, gallery } = associateImages(sections, [img()], pages)
    expect(out[0].steps.every((s) => !s.imgs)).toBe(true)
    expect(gallery).toHaveLength(1)
  })

  it('plusieurs images sous une même ligne s’empilent dans imgs', () => {
    const imgs = [img({ src: 'data:image/png;base64,A' }), img({ src: 'data:image/png;base64,B', x: 200 })]
    const { sections: out } = associateImages(sections, imgs, linesByPage)
    expect(out[0].steps[1].imgs).toEqual(['data:image/png;base64,A', 'data:image/png;base64,B'])
  })

  it('entrées vides → sections copiées, galerie vide', () => {
    const { sections: out, gallery } = associateImages(sections, [], [])
    expect(gallery).toEqual([])
    expect(out).toHaveLength(1)
    expect(out).not.toBe(sections)
  })
})
