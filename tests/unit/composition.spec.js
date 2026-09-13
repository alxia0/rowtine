// Unitaire — constante COMPOSITIONS + normalisation (stock/laines).
import { describe, it, expect } from 'vitest'
import {
  COMPOSITIONS, normalizeComposition, compositionToText,
  compositionLabel, compositionText,
} from '@/constants/compositions'

// Faux `t` de test : préfixe la clé plutôt que de la renvoyer telle quelle (identité). Avec
// une identité, un test « c'est traduit » resterait vert même si le code ne traduisait rien
// — exactement le défaut « assertion qui ne peut pas échouer » que ce dépôt proscrit
// (06/08/2026 : la fiche laine affichait la clé française brute dans les 3 autres
// langues, et un `t` identité n'aurait rien détecté).
const fakeT = (key) => `T:${key}`

describe('COMPOSITIONS', () => {
  it('contient les 11 matériaux connus, en minuscules, sans « Autre »', () => {
    expect(COMPOSITIONS).toEqual([
      'laine', 'coton', 'acrylique', 'alpaga', 'mohair', 'soie',
      'lin', 'bambou', 'cachemire', 'polyamide', 'viscose',
    ])
    expect(COMPOSITIONS).not.toContain('Autre')
    expect(COMPOSITIONS).not.toContain('autre')
  })
})

describe('normalizeComposition', () => {
  // La tolérance à l'ancien format chaîne (« laine, coton ») a été retirée le 13/08/2026
  // (travaux de nettoyage avant la 1.0, réserve produit acceptée) : une chaîne, même non vide, ne produit
  // plus de découpage — elle est désormais traitée comme n'importe quel type inattendu.
  it('renvoie [] pour une chaîne (ancien format retiré, plus aucun découpage)', () => {
    expect(normalizeComposition('laine, coton')).toEqual([])
  })

  it('nettoie un tableau : trim, non vides, dédup', () => {
    expect(normalizeComposition(['laine', '', 'laine'])).toEqual(['laine'])
  })

  it('renvoie [] pour null', () => {
    expect(normalizeComposition(null)).toEqual([])
  })

  it('renvoie [] pour une chaîne vide', () => {
    expect(normalizeComposition('')).toEqual([])
  })

  it('renvoie [] pour undefined', () => {
    expect(normalizeComposition(undefined)).toEqual([])
  })

  it('renvoie [] pour un tableau vide', () => {
    expect(normalizeComposition([])).toEqual([])
  })

  it('trim les éléments d’un tableau', () => {
    expect(normalizeComposition([' laine ', 'coton '])).toEqual(['laine', 'coton'])
  })

  it('conserve l’ordre d’apparition (première occurrence)', () => {
    expect(normalizeComposition(['soie', 'laine', 'soie', 'coton'])).toEqual(['soie', 'laine', 'coton'])
  })

  it('accepte un tableau à un seul élément', () => {
    expect(normalizeComposition(['laine'])).toEqual(['laine'])
  })

  it('renvoie [] pour un nombre (type inattendu, ni tableau ni chaîne acceptée)', () => {
    expect(normalizeComposition(42)).toEqual([])
  })
})

describe('compositionToText', () => {
  it('joint un tableau avec « , »', () => {
    expect(compositionToText(['laine', 'soie'])).toBe('laine, soie')
  })

  it('renvoie une chaîne vide pour un tableau vide', () => {
    expect(compositionToText([])).toBe('')
  })

  it('renvoie une chaîne vide pour null/undefined', () => {
    expect(compositionToText(null)).toBe('')
    expect(compositionToText(undefined)).toBe('')
  })

  it('gère un seul élément sans virgule', () => {
    expect(compositionToText(['laine'])).toBe('laine')
  })

  it('nettoie défensivement (trim, non vides, dédup) avant de joindre', () => {
    expect(compositionToText([' laine ', '', 'laine', 'coton'])).toBe('laine, coton')
  })
})

// Régression (06/08/2026) : logique extraite de StashView.compositionLabel et
// consommée aussi par YarnDetailDialog, qui poussait jusque-là la clé de catalogue brute
// (toujours en français) au lieu de la traduire dans la langue active.
describe('compositionLabel', () => {
  it('traduit un matériau du catalogue via t (pas la clé identité)', () => {
    expect(compositionLabel('coton', fakeT)).toBe('T:yarn.compositions.coton')
  })

  it('renvoie une composition personnalisée telle quelle, sans appeler t', () => {
    let called = false
    const t = () => { called = true; return 'ne devrait jamais être vu' }
    expect(compositionLabel('soie de bambou', t)).toBe('soie de bambou')
    expect(called).toBe(false)
  })
})

describe('compositionText', () => {
  it('traduit une composition du catalogue dans une langue non française', () => {
    expect(compositionText(['coton'], fakeT)).toBe('T:yarn.compositions.coton')
  })

  it('laisse une composition personnalisée hors catalogue inchangée', () => {
    expect(compositionText(['soie de bambou'], fakeT)).toBe('soie de bambou')
  })

  it('mélange catalogue + personnalisée : ordre préservé, traduction sélective, séparateur « , »', () => {
    expect(compositionText(['laine', 'soie de bambou', 'coton'], fakeT))
      .toBe('T:yarn.compositions.laine, soie de bambou, T:yarn.compositions.coton')
  })

  it('renvoie une chaîne vide pour une composition vide ou absente (pas de ligne parasite)', () => {
    expect(compositionText([], fakeT)).toBe('')
    expect(compositionText(null, fakeT)).toBe('')
    expect(compositionText(undefined, fakeT)).toBe('')
    expect(compositionText('', fakeT)).toBe('')
  })
})
