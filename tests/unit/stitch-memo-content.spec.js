// Protège la parité du contenu du mémo entre les 4 langues et le repli par fiche.
import { describe, it, expect } from 'vitest'
import { STITCH_CATALOG, GROUPS } from '@/content/stitch-memo/catalog'
import { STITCH_CONTENT, resolveStitch, resolveStitches, suggestStitches, stitchesByGroup, matchesQuery } from '@/content/stitch-memo'

const LANGS = ['fr', 'en', 'de', 'es']
const EMOJI = /\p{Extended_Pictographic}/u
const GLYPH = /[←-⇿•■-◿☀-➿—–]/

describe('catalogue du mémo', () => {
  it('identifiants uniques, groupe connu pour la technique', () => {
    const ids = STITCH_CATALOG.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of STITCH_CATALOG) expect(GROUPS[s.craft]).toContain(s.group)
  })
})

describe.each(LANGS)('contenu %s', (lang) => {
  const dict = STITCH_CONTENT[lang]
  it('couvre exactement le catalogue', () => {
    expect(Object.keys(dict).sort()).toEqual(STITCH_CATALOG.map((s) => s.id).sort())
  })
  it('chaque fiche : nom, abréviations, 3 à 10 étapes non vides, ni URL, ni emoji, ni glyphe', () => {
    for (const [id, f] of Object.entries(dict)) {
      expect(f.name, id).toMatch(/\S/)
      expect(Array.isArray(f.abbr), id).toBe(true)
      expect(f.steps.length, id).toBeGreaterThanOrEqual(3)
      expect(f.steps.length, id).toBeLessThanOrEqual(10)
      const texts = [f.name, ...f.abbr, ...f.steps, f.tip || '']
      for (const t of texts) {
        expect(t, id).not.toMatch(/https?:|www\./)
        expect(t, id).not.toMatch(EMOJI)
        expect(t, id).not.toMatch(GLYPH)
      }
      for (const s of f.steps) expect(s.trim(), id).not.toBe('')
    }
  })
})

describe('résolution', () => {
  it('résout une fiche dans la langue demandée', () => {
    const f = resolveStitch('cr-sc', 'fr')
    expect(f).toMatchObject({ id: 'cr-sc', craft: 'crochet', group: 'base', name: STITCH_CONTENT.fr['cr-sc'].name })
  })
  it('replie par fiche sur l’anglais quand la langue ne l’a pas', () => {
    const f = resolveStitch('cr-sc', 'it')
    expect(f.name).toBe(STITCH_CONTENT.en['cr-sc'].name)
  })
  it('renvoie null pour un identifiant inconnu', () => {
    expect(resolveStitch('xx-nope', 'fr')).toBeNull()
  })
  it('resolveStitches : ordre du catalogue, inconnus et doublons ignorés, non-tableau accepté', () => {
    const order = STITCH_CATALOG.map((s) => s.id)
    const ids = resolveStitches(['kn-k2tog', 'xx-nope', 'cr-sc', 'cr-sc'], 'fr').map((f) => f.id)
    expect(ids).toEqual(['cr-sc', 'kn-k2tog'].sort((a, b) => order.indexOf(a) - order.indexOf(b)))
    expect(resolveStitches(undefined, 'fr')).toEqual([])
  })
  it('stitchesByGroup : groupes de la technique, dans l’ordre, vides omis', () => {
    const groups = stitchesByGroup('knitting', 'fr')
    expect(groups.map((g) => g.group)).toEqual(GROUPS.knitting.filter((g) => STITCH_CATALOG.some((s) => s.craft === 'knitting' && s.group === g)))
    expect(groups.flatMap((g) => g.stitches).every((f) => f.craft === 'knitting')).toBe(true)
  })
})

describe('suggestions depuis le glossaire du patron', () => {
  it('ignore casse, espaces et points', () => {
    expect(suggestStitches(['MS'])).toContain('cr-sc')
    expect(suggestStitches(['2 m. ens.'])).toContain('kn-k2tog')
  })
  it('reconnaît une abréviation d’une autre langue que celle de l’app', () => {
    expect(suggestStitches(['sc'])).toContain('cr-sc')
    expect(suggestStitches(['k2tog'])).toContain('kn-k2tog')
  })
  it('« AM » (anneau marqueur tricot) ne suggère pas l\'anneau magique', () => {
    expect(suggestStitches(['AM'])).not.toContain('cr-magic-ring')
  })
  it('liste vide ou absente : aucune suggestion', () => {
    expect(suggestStitches([])).toEqual([])
    expect(suggestStitches(undefined)).toEqual([])
  })
})

describe('matchesQuery', () => {
  const sc = { name: 'Maille serrée', abbr: ['ms', 'sc (US)'] }
  it('ignore casse et accents, cherche dans le nom et les abréviations', () => {
    expect(matchesQuery(sc, 'SERREE')).toBe(true)
    expect(matchesQuery(sc, ' sc ')).toBe(true)
    expect(matchesQuery(sc, 'jeté')).toBe(false)
  })
  it('requête vide : tout correspond', () => {
    expect(matchesQuery(sc, '')).toBe(true)
    expect(matchesQuery(sc, undefined)).toBe(true)
  })
})
