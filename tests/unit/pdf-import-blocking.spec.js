import { describe, it, expect } from 'vitest'
import { countMultiColPages, computeBlocking, detectMultiPattern } from '@/utils/pdf-import/blocking'

describe('blocking — colonnes', () => {
  it('countMultiColPages compte les pages portant une ligne multiCol', () => {
    const pages = [
      [{ text: 'a' }, { text: 'b', multiCol: true }],
      [{ text: 'c' }],
      [{ text: 'd', multiCol: true }],
    ]
    expect(countMultiColPages(pages)).toBe(2)
  })
  it('computeBlocking bloque avec raison columns si ≥1 page multiCol', () => {
    const pages = [[{ text: 'x', multiCol: true }]]
    const b = computeBlocking(pages)
    expect(b.blocked).toBe(true)
    expect(b.reasons).toContain('columns')
  })
  it('ne bloque pas une page normale', () => {
    expect(computeBlocking([[{ text: 'x' }]]).blocked).toBe(false)
  })
})

describe('blocking — multi-patrons (best-effort)', () => {
  const heading = (t) => ({ text: t })
  it('détecte ≥2 sections « Matériel » sur un document long', () => {
    const pages = [
      [heading('Materials'), heading('Rang 1 : ...')],
      [heading('Corps')],
      [heading('Fournitures'), heading('Rang 1 : ...')],
      [heading('Fin')],
    ]
    expect(detectMultiPattern(pages)).toBe(true)
  })
  it('ne se déclenche pas sur un patron unique (une seule section Matériel)', () => {
    const pages = [[heading('Matériel')], [heading('Corps')], [heading('Manches')]]
    expect(detectMultiPattern(pages)).toBe(false)
  })
  it('ne se déclenche pas sur un document court même avec 2 en-têtes', () => {
    const pages = [[heading('Materials')], [heading('Materials')]]
    expect(detectMultiPattern(pages)).toBe(false) // < seuil de pages
  })
  it('ne se déclenche pas avec UN seul en-tête matériel sur un document long (≥4 pages)', () => {
    // Discriminant du seuil count >= 2 : à la différence du test « patron unique » ci-dessus
    // (3 pages, court-circuité par la garde MIN_BOOK_PAGES avant d'atteindre le comptage),
    // ce document a 4 pages (>= MIN_BOOK_PAGES) et count === 1 : seule la comparaison
    // `count >= 2` protège ce cas. Une régression `>= 2` → `>= 1` fait tomber ce test.
    const pages = [[heading('Matériel')], [heading('Corps')], [heading('Manches')], [heading('Finitions')]]
    expect(detectMultiPattern(pages)).toBe(false)
  })
})

describe('blocking — cumul de raisons', () => {
  const heading = (t) => ({ text: t })
  it('computeBlocking cumule columns ET multiPattern quand les deux signaux sont présents', () => {
    const pages = [
      [heading('Materials'), { text: 'x', multiCol: true }],
      [heading('Corps')],
      [heading('Fournitures')],
      [heading('Fin')],
    ]
    const b = computeBlocking(pages)
    expect(b.reasons).toContain('columns')
    expect(b.reasons).toContain('multiPattern')
  })
})
