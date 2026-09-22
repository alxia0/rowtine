import { describe, it, expect } from 'vitest'
import { photosOf, coverPhotoOf } from '@/utils/yarn-photos'

describe('yarn-photos', () => {
  describe('photosOf', () => {
    it("renvoie le tableau photos tel quel quand il existe", () => {
      expect(photosOf({ photos: ['a', 'b'] })).toEqual(['a', 'b'])
    })

    it("lit l'ancien champ photo (chaîne) si photos est absent", () => {
      expect(photosOf({ photo: 'data:image/png;base64,xxx' })).toEqual(['data:image/png;base64,xxx'])
    })

    it("un ancien champ photo vide ne produit aucune entrée fantôme", () => {
      expect(photosOf({ photo: '' })).toEqual([])
    })

    it("ni photos ni photo : tableau vide", () => {
      expect(photosOf({})).toEqual([])
      expect(photosOf(null)).toEqual([])
      expect(photosOf(undefined)).toEqual([])
    })

    it("photos vide mais photo (ancien) rempli : retombe sur l'ancien champ", () => {
      // Cas d'une fiche migrée par erreur avec un tableau vide explicite mais un
      // ancien champ encore présent — ne doit jamais faire disparaître une photo réelle.
      expect(photosOf({ photos: [], photo: 'x' })).toEqual(['x'])
    })
  })

  describe('coverPhotoOf', () => {
    it("renvoie la photo à coverIndex", () => {
      expect(coverPhotoOf({ photos: ['a', 'b', 'c'], coverIndex: 2 })).toBe('c')
    })

    it("coverIndex absent : retombe sur la 1re photo", () => {
      expect(coverPhotoOf({ photos: ['a', 'b'] })).toBe('a')
    })

    it("coverIndex hors bornes : retombe sur la 1re photo, ne plante pas", () => {
      expect(coverPhotoOf({ photos: ['a', 'b'], coverIndex: 9 })).toBe('a')
      expect(coverPhotoOf({ photos: ['a', 'b'], coverIndex: -1 })).toBe('a')
    })

    it("aucune photo : chaîne vide", () => {
      expect(coverPhotoOf({ photos: [] })).toBe('')
      expect(coverPhotoOf({})).toBe('')
    })

    it("retombe sur l'ancien champ photo via photosOf", () => {
      expect(coverPhotoOf({ photo: 'legacy.jpg' })).toBe('legacy.jpg')
    })
  })
})
