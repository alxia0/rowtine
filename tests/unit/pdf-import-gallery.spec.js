import { describe, it, expect } from 'vitest'
import { filterGalleryImages } from '@/utils/pdf-import/gallery'

const img = (o = {}) => ({ src: 'data:image/jpeg;base64,AAAA', page: 1, w: 400, h: 300, ...o })

describe('filterGalleryImages', () => {
  it('ignore les images dont le plus petit cote < 96 px', () => {
    const out = filterGalleryImages([img({ w: 400, h: 80 }), img({ w: 95, h: 200 }), img({ w: 96, h: 300 })])
    expect(out).toHaveLength(1)
    expect(out[0].w).toBe(96)
  })
  it('deduplique les images identiques (meme signature)', () => {
    const dup = { src: 'data:image/png;base64,ZZZZZZZZ', page: 2, w: 200, h: 200 }
    const out = filterGalleryImages([dup, { ...dup, page: 5 }])
    expect(out).toHaveLength(1)
    expect(out[0].page).toBe(2) // 1re occurrence conservee
  })
  it('distingue deux images differentes de memes dimensions', () => {
    const a = { src: 'data:image/png;base64,AAAAAAAA', page: 1, w: 200, h: 200 }
    const b = { src: 'data:image/png;base64,BBBBBBBB', page: 1, w: 200, h: 200 }
    expect(filterGalleryImages([a, b])).toHaveLength(2)
  })
  it('plafonne a 64 images en gardant l ordre', () => {
    // Plafond relevé 24→64 (fusion moteur unique, retour terrain #5 poncho : tutoriels photo ~54 clichés).
    const many = Array.from({ length: 80 }, (_, i) => img({ src: `data:image/jpeg;base64,IMG${i}`, page: i + 1 }))
    const out = filterGalleryImages(many)
    expect(out).toHaveLength(64)
    expect(out[0].page).toBe(1)
    expect(out[63].page).toBe(64)
  })
  it('preserve x,y quand fournis (positionnement image-par-ligne)', () => {
    const out = filterGalleryImages([{ src: 'data:image/png;base64,PPPP', page: 3, x: 12, y: 720, w: 200, h: 200 }])
    expect(out[0]).toMatchObject({ page: 3, x: 12, y: 720, w: 200, h: 200 })
  })
  it('entree vide ou non-tableau -> []', () => {
    expect(filterGalleryImages([])).toEqual([])
    expect(filterGalleryImages(null)).toEqual([])
  })
  it("ne supprime pas une image kind:'grid' sous la barre des 96 px (classée à la résolution intrinsèque, affichée petite)", () => {
    const out = filterGalleryImages([img({ w: 50, h: 50, kind: 'grid' })])
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('grid')
  })
  it("une image kind:'grid' echappe au plafond MAX_IMAGES (jamais perdre un diagramme)", () => {
    const many = Array.from({ length: 80 }, (_, i) => img({ src: `data:image/jpeg;base64,IMG${i}`, page: i + 1 }))
    const grid = img({ src: 'data:image/jpeg;base64,GRID', page: 999, kind: 'grid' })
    const out = filterGalleryImages([...many, grid])
    const gridOut = out.filter((c) => c.kind === 'grid')
    const nonGridOut = out.filter((c) => c.kind !== 'grid')
    expect(gridOut).toHaveLength(1)
    expect(gridOut[0].page).toBe(999)
    expect(nonGridOut).toHaveLength(64)
  })
})
