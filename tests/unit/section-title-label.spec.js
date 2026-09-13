// sectionTitleLabel (reader.js) : id d'abord (clé stable posée par parseIntro), repli sur
// le titre FR historique 'Présentation' quand id est absent (patrons antérieurs au lot
// précédent, et import PDF — assemble.js, hors périmètre — qui ne pose jamais cet id).
// Intent 2026-09-07-titres-francais-donnees-generes.
import { describe, it, expect } from 'vitest'
import { sectionTitleLabel } from '@/utils/reader'

const t = (key) => (key === 'reader.section.intro' ? 'Presentación' : key)

describe('sectionTitleLabel', () => {
  it('id === "presentation" (sortie fraîche de parseIntro, title === "presentation") : traduit', () => {
    expect(sectionTitleLabel({ id: 'presentation', title: 'presentation' }, t)).toBe('Presentación')
  })

  it('id absent, title === "Présentation" (patron antérieur / import PDF) : traduit par repli', () => {
    expect(sectionTitleLabel({ id: '', title: 'Présentation' }, t)).toBe('Presentación')
  })

  it('id distinct et non vide, title === "Présentation" : PAS traduit (section de travail homonyme, non-régression du lot précédent)', () => {
    expect(sectionTitleLabel({ id: 'sec-abc123', title: 'Présentation' }, t)).toBe('Présentation')
  })

  it('section ordinaire : titre passé tel quel', () => {
    expect(sectionTitleLabel({ id: 'corps', title: 'Corps' }, t)).toBe('Corps')
  })
})
