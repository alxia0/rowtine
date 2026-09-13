import { describe, it, expect } from 'vitest'
import { emitFrontMatter, parseFrontMatter } from '@/utils/pattern-md/meta'
import { WARNING_CODES } from '@/utils/pattern-md/warning-codes'

const PATTERN = {
  name: 'SABAI Top N° 2',
  author: 'Paula_m',
  authorUrl: 'https://www.instagram.com/paulastrickt',
  reader: {
    sizeLabels: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
    sizeSub: ['74-81', '82-89', '90-97', '98-107', '108-117', '118-127'],
    sizeSubLabel: 'tour de poitrine (cm)',
    easeHint: "Aisance positive d'environ 0-2 cm.",
  },
}

describe('front-matter', () => {
  it('emet toutes les cles renseignees en anglais (dialecte), rowtine toujours en tête', () => {
    const fm = emitFrontMatter(PATTERN)
    expect(fm.split('\n')[1]).toBe('rowtine: 1')
    expect(fm).toContain('title: SABAI Top N° 2')
    expect(fm).toContain('author: Paula_m')
    expect(fm).toContain('link: https://www.instagram.com/paulastrickt')
    expect(fm).toContain('sizes: XS · S · M · L · XL · XXL')
    expect(fm).toContain('subsizes: 74-81 · 82-89 · 90-97 · 98-107 · 108-117 · 118-127 (tour de poitrine (cm))')
    expect(fm).toContain('ease: Aisance positive')
    expect(fm).not.toContain('titre:')
    expect(fm).not.toContain('auteur:')
    expect(fm).not.toContain('lien:')
    expect(fm).not.toContain('aisance:')
  })
  it("n'emet pas les cles vides", () => {
    const fm = emitFrontMatter({ name: 'X', reader: { sizeLabels: [] } })
    expect(fm).not.toContain('author:')
    expect(fm).not.toContain('sizes:')
    expect(fm).not.toContain('subsizes:')
  })
  it('aller-retour', () => {
    const { meta, body, warnings } = parseFrontMatter(emitFrontMatter(PATTERN) + 'corps du fichier\n')
    expect(warnings).toEqual([])
    expect(body.trim()).toBe('corps du fichier')
    expect(meta.titre).toBe('SABAI Top N° 2')
    expect(meta.lien).toBe('https://www.instagram.com/paulastrickt')
    expect(meta.tailles).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL'])
    expect(meta.sousTailles).toEqual(['74-81', '82-89', '90-97', '98-107', '108-117', '118-127'])
    expect(meta.sousTaillesLabel).toBe('tour de poitrine (cm)')
  })
  it('front-matter absent => meta vide + avertissement CODÉ (pas une phrase française), corps intact', () => {
    const { meta, body, warnings } = parseFrontMatter('## Corps\n- tric.\n')
    expect(meta.tailles).toEqual([])
    expect(body).toContain('## Corps')
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toEqual({ code: WARNING_CODES.META_NO_FRONTMATTER, params: {} })
    expect(warnings.every((w) => typeof w !== 'string')).toBe(true)
  })
  it('ligne illisible (sans « : ») => avertissement CODÉ avec la ligne en paramètre', () => {
    const { warnings } = parseFrontMatter('---\nrowtine: 1\nbadline sans deux-points\n---\n')
    const w = warnings.find((w) => w.code === WARNING_CODES.META_UNREADABLE_LINE)
    expect(w).toBeTruthy()
    expect(w.params.line).toBe('badline sans deux-points')
    expect(warnings.every((w) => typeof w !== 'string')).toBe(true)
  })
  it('cle inconnue => avertissement CODÉ avec la clé en paramètre, parsing continue', () => {
    const { warnings } = parseFrontMatter('---\nrowtine: 1\nfoo: bar\n---\n')
    const w = warnings.find((w) => w.code === WARNING_CODES.META_UNKNOWN_KEY)
    expect(w).toBeTruthy()
    expect(w.params.key).toBe('foo')
    expect(warnings.every((w) => typeof w !== 'string')).toBe(true)
  })
  it('tolère les fins de ligne CRLF (Windows)', () => {
    const { meta, warnings } = parseFrontMatter('---\r\nrowtine: 1\r\ntitle: X\r\n---\r\ncorps\r\n')
    expect(warnings).toEqual([])
    expect(meta.titre).toBe('X')
  })
  it('clés de champ FR héritées refusées (décision 07/09/2026) : avertissement clé inconnue par clé, champs EN voisins toujours lus', () => {
    // Même traitement que `tricoche` depuis le 16/08 : la tolérance de lecture aux
    // clés FR historiques (titre, auteur, lien, tailles, sous-tailles, aisance) est
    // retirée — zéro occurrence sur les 103 patron.md du corpus (mesure du 13/08).
    const md = '---\nrowtine: 1\ntitre: Mini\nauteur: A\nlien: https://exemple.test\ntailles: S · M\nsous-tailles: 74-81 · 82-89 (poitrine)\naisance: positive\ntitle: Vrai\nsizes: T · U\n---\ncorps\n'
    const { meta, warnings } = parseFrontMatter(md)
    const unknownKeys = warnings
      .filter((w) => w.code === WARNING_CODES.META_UNKNOWN_KEY)
      .map((w) => w.params.key)
    expect(unknownKeys).toEqual(['titre', 'auteur', 'lien', 'tailles', 'sous-tailles', 'aisance'])
    expect(meta.titre).toBe('Vrai')
    expect(meta.tailles).toEqual(['T', 'U'])
  })
})

describe('clé de version du format : rowtine en écriture, ancienne clé refusée en lecture', () => {
  it('émet `rowtine: 1` en première ligne', () => {
    const md = emitFrontMatter({ name: 'T' })
    expect(md.split('\n')[1]).toBe('rowtine: 1')
  })

  it('une clé de version inventée reste signalée (comme toute clé inconnue)', () => {
    const { warnings } = parseFrontMatter('---\nknitcraft: 1\ntitle: T\n---\n\nx\n')
    expect(warnings.map((w) => w.code)).toContain('meta.unknownKey')
  })

  it('un fichier resté en ancienne clé `tricoche:` est désormais signalé, comme toute clé inconnue', () => {
    const { warnings } = parseFrontMatter('---\ntricoche: 1\ntitle: T\n---\n\nx\n')
    expect(warnings.map((w) => w.code)).toContain('meta.unknownKey')
  })
})
