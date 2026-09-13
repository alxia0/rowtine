// Unitaire — mergePatternFromMd / isMdSafeToMerge. Fusion pure
// d'un patron reparsé depuis patron.md dans l'entité live : le MD gagne sur
// reader/nom/auteur/tailles (via reader.sizeLabels ET le champ top-level
// `sizes`, même source, lu directement par plusieurs vues)/galerie/lien, le
// live garde id/photos/notes/pdf/type/patternId/ownerProjectId et tout le
// reste. La garde
// refuse un MD dégradé (vide, réduction drastique, trop d'avertissements) pour
// que `mdToPattern`, qui ne lève jamais, ne puisse pas écraser silencieusement
// du contenu interne correct.
import { describe, it, expect } from 'vitest'
import { mergePatternFromMd, isMdSafeToMerge } from '@/backup/merge-pattern-md'
import { WARNING_CODES } from '@/utils/pattern-md/warning-codes'

function makeSections(n, stepsPerSection = 2) {
  return Array.from({ length: n }, (_, i) => ({
    id: `sec${i}`,
    title: `Section ${i}`,
    kind: 'texte',
    steps: Array.from({ length: stepsPerSection }, (_, j) => ({ t: `étape ${i}.${j}` })),
  }))
}

function liveEntity(overrides = {}) {
  return {
    id: 42,
    patternId: 7, // champ défensif : ne doit jamais être touché par la fusion
    ownerProjectId: 3,
    photos: ['data:image/jpeg;base64,PHOTO'],
    type: 'knitting',
    category: 'bonnet',
    notes: 'notes internes précieuses',
    pdf: 'data:application/pdf;base64,PDF',
    patronMd: { hash: 'oldhash' },
    name: 'Ancien nom',
    author: 'Ancienne autrice',
    authorUrl: 'https://ancien-lien.example',
    gallery: [{ src: 'data:image/png;base64,OLD', page: 0, w: 1, h: 1 }],
    reader: { sizeLabels: ['S', 'M'], sections: makeSections(10) },
    ...overrides,
  }
}

function mdPattern(overrides = {}) {
  return {
    name: 'Nouveau nom',
    author: 'Nouvelle autrice',
    authorUrl: 'https://nouveau-lien.example',
    sizes: ['S', 'M', 'L'],
    gallery: [{ src: 'data:image/png;base64,NEW', page: 1, w: 2, h: 2 }],
    reader: { sizeLabels: ['S', 'M', 'L'], sections: makeSections(9) },
    ...overrides,
  }
}

describe('mergePatternFromMd', () => {
  it('le MD gagne sur reader, name, author, gallery (tailles via reader.sizeLabels)', () => {
    const merged = mergePatternFromMd(liveEntity(), mdPattern())
    expect(merged.reader).toEqual(mdPattern().reader)
    expect(merged.reader.sizeLabels).toEqual(['S', 'M', 'L'])
    expect(merged.name).toBe('Nouveau nom')
    expect(merged.author).toBe('Nouvelle autrice')
    expect(merged.authorUrl).toBe('https://nouveau-lien.example')
    expect(merged.gallery).toEqual(mdPattern().gallery)
  })

  it('le live garde id, photos, notes, pdf, type, category, patternId, ownerProjectId, patronMd', () => {
    const merged = mergePatternFromMd(liveEntity(), mdPattern())
    expect(merged.id).toBe(42)
    expect(merged.patternId).toBe(7)
    expect(merged.ownerProjectId).toBe(3)
    expect(merged.photos).toEqual(['data:image/jpeg;base64,PHOTO'])
    expect(merged.type).toBe('knitting')
    expect(merged.category).toBe('bonnet')
    expect(merged.notes).toBe('notes internes précieuses')
    expect(merged.pdf).toBe('data:application/pdf;base64,PDF')
    expect(merged.patronMd).toEqual({ hash: 'oldhash' })
  })

  it("MD sans author (vide) : l'auteur live n'est PAS écrasé", () => {
    const merged = mergePatternFromMd(liveEntity(), mdPattern({ author: '' }))
    expect(merged.author).toBe('Ancienne autrice')
  })

  it("MD sans name (vide) : le nom live n'est PAS écrasé", () => {
    const merged = mergePatternFromMd(liveEntity(), mdPattern({ name: '' }))
    expect(merged.name).toBe('Ancien nom')
  })

  it("MD sans lien (authorUrl vide) : le lien live n'est PAS écrasé", () => {
    const merged = mergePatternFromMd(liveEntity(), mdPattern({ authorUrl: '' }))
    expect(merged.authorUrl).toBe('https://ancien-lien.example')
  })

  it('gallery MD vide : écrase quand même (galerie toujours MD-owned)', () => {
    const merged = mergePatternFromMd(liveEntity(), mdPattern({ gallery: [] }))
    expect(merged.gallery).toEqual([])
  })

  it('sizes top-level suit reader.sizeLabels (même source, ne doit pas diverger)', () => {
    const merged = mergePatternFromMd(liveEntity(), mdPattern())
    expect(merged.sizes).toEqual(['S', 'M', 'L'])
    expect(merged.sizes).toEqual(merged.reader.sizeLabels)
  })

  it('ne mute pas les entrées (pur)', () => {
    const live = liveEntity()
    const md = mdPattern()
    const beforeLive = JSON.stringify(live)
    const beforeMd = JSON.stringify(md)
    mergePatternFromMd(live, md)
    expect(JSON.stringify(live)).toBe(beforeLive)
    expect(JSON.stringify(md)).toBe(beforeMd)
  })

  it('ne lève pas sur entrées absentes/malformées', () => {
    expect(() => mergePatternFromMd(null, null)).not.toThrow()
    expect(() => mergePatternFromMd(undefined, undefined)).not.toThrow()
    expect(mergePatternFromMd(null, mdPattern()).reader).toEqual(mdPattern().reader)
  })
})

describe('isMdSafeToMerge', () => {
  it('MD vide (0 section) alors que le live a du contenu → refusé, motif structuré', () => {
    const result = isMdSafeToMerge({ reader: { sections: [] } }, liveEntity(), [])
    expect(result.safe).toBe(false)
    expect(result.reason).toBeTruthy()
    expect(result.reason).toMatchObject({ code: WARNING_CODES.MERGE_NO_SECTIONS })
  })

  it('MD à 1 section vs 10 internes → refusé (réduction drastique), motif structuré', () => {
    const md = { reader: { sizeLabels: ['S'], sections: makeSections(1) } }
    const result = isMdSafeToMerge(md, liveEntity(), [])
    expect(result.safe).toBe(false)
    expect(result.reason).toMatchObject({ code: WARNING_CODES.MERGE_FEWER_SECTIONS })
  })

  it('MD avec autant de sections mais moins de la moitié des steps → refusé, motif structuré', () => {
    // live : 10 sections × 2 steps = 20 steps ; MD : 10 sections × 1 step = 10 steps (= 50%, pas < 50%)
    // on descend à 0.4 en réduisant encore pour être strictement sous le seuil
    const md = { reader: { sizeLabels: ['S'], sections: makeSections(10, 0) } }
    // 10 sections avec 0 step chacune → 0 steps, largement < 50% de 20
    const result = isMdSafeToMerge(md, liveEntity(), [])
    expect(result.safe).toBe(false)
    expect(result.reason).toMatchObject({ code: WARNING_CODES.MERGE_FEWER_STEPS })
  })

  it('MD de taille comparable (léger écart) → accepté', () => {
    const md = { reader: { sizeLabels: ['S', 'M', 'L'], sections: makeSections(9) } }
    const result = isMdSafeToMerge(md, liveEntity(), ['un avertissement bénin'])
    expect(result).toEqual({ safe: true })
  })

  it('trop d\'avertissements (11) → refusé même si le contenu semble correct, motif structuré avec le compte', () => {
    const md = mdPattern()
    const warnings = Array.from({ length: 11 }, (_, i) => `avertissement ${i}`)
    const result = isMdSafeToMerge(md, liveEntity(), warnings)
    expect(result.safe).toBe(false)
    expect(result.reason).toMatchObject({ code: WARNING_CODES.MERGE_TOO_MANY_WARNINGS, params: { count: 11 } })
  })

  it('le refus « trop d\'avertissements » transporte leur nombre (99), avertissements déjà structurés comptés un pour un', () => {
    const md = mdPattern()
    const warnings = Array.from({ length: 99 }, () => ({ code: 'x', params: {} }))
    const result = isMdSafeToMerge(md, liveEntity(), warnings)
    expect(result.safe).toBe(false)
    expect(result.reason).toMatchObject({ code: WARNING_CODES.MERGE_TOO_MANY_WARNINGS, params: { count: 99 } })
  })

  it('exactement 10 avertissements → toléré (seuil strictement > 10)', () => {
    const md = mdPattern()
    const warnings = Array.from({ length: 10 }, (_, i) => `avertissement ${i}`)
    const result = isMdSafeToMerge(md, liveEntity(), warnings)
    expect(result.safe).toBe(true)
  })

  it('live vide (aucune section) → accepté, rien à protéger', () => {
    const live = liveEntity({ reader: { sizeLabels: [], sections: [] } })
    const md = { reader: { sizeLabels: [], sections: [] } }
    const result = isMdSafeToMerge(md, live, [])
    expect(result).toEqual({ safe: true })
  })

  it('ne lève pas sur entrées absentes/malformées', () => {
    expect(() => isMdSafeToMerge(null, null, null)).not.toThrow()
    expect(isMdSafeToMerge(null, null, null).safe).toBe(true)
  })
})
