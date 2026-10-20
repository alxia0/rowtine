// Protège la table US / UK : ids uniques, renvois valides vers le catalogue, texte sans glyphe ni URL.
import { describe, it, expect } from 'vitest'
import { STITCH_CATALOG } from '@/content/stitch-memo/catalog'
import { US_UK_TERMS, usUkTerms } from '@/content/stitch-memo'

const EMOJI = /\p{Extended_Pictographic}/u
const GLYPH = /[←-⇿•■-◿☀-➿—–]/

describe('table US / UK', () => {
  it('ids uniques', () => {
    const ids = US_UK_TERMS.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('toute ligne avec stitch pointe une fiche du catalogue, de la même technique', () => {
    for (const r of US_UK_TERMS.filter((x) => x.stitch)) {
      const s = STITCH_CATALOG.find((c) => c.id === r.stitch)
      expect(s, r.id).toBeTruthy()
      expect(s.craft, r.id).toBe(r.craft)
    }
  })

  it('aucun emoji, glyphe, URL ni tiret cadratin dans les noms et abréviations', () => {
    for (const r of US_UK_TERMS) {
      for (const side of [r.us, r.uk]) {
        for (const t of [side.name, ...side.abbr]) {
          expect(t, r.id).not.toMatch(EMOJI)
          expect(t, r.id).not.toMatch(GLYPH)
          expect(t, r.id).not.toMatch(/https?:|www\./)
        }
      }
    }
  })

  it('filtre par technique, dans l\'ordre de la table', () => {
    const general = usUkTerms('general').map((r) => r.id)
    expect(general).toEqual(expect.arrayContaining(['gauge', 'yarn']))
    expect(usUkTerms('crochet').some((r) => r.craft === 'knitting')).toBe(false)
    expect(usUkTerms('crochet').map((r) => r.id)).toEqual(US_UK_TERMS.filter((r) => r.craft === 'crochet').map((r) => r.id))
  })

  it('la ligne dc2tog n\'a pas de stitch', () => {
    expect(US_UK_TERMS.find((r) => r.id === 'dc2tog').stitch).toBeUndefined()
  })
})
