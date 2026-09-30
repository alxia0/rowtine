// Protège la fusion du mémo dans l'aide-mémoire : référence du patron intacte, tuile toujours présente.
import { describe, it, expect } from 'vitest'
import { buildReference } from '@/utils/reader-reference'
import { withStitchMemo } from '@/utils/stitch-memo'

const SC = { id: 'cr-sc', name: 'Maille serrée', abbr: ['ms'], steps: ['a', 'b', 'c'], tip: 'astuce' }

describe('withStitchMemo', () => {
  it('ajoute la tuile et l\'onglet à la fin sans toucher la référence du patron', () => {
    const ref = buildReference({ abbr: [{ key: 'ms', def: 'maille serrée' }], techniques: [{ title: 'Picot', body: 'x' }] })
    const snapshot = JSON.parse(JSON.stringify(ref))
    const out = withStitchMemo(ref, [SC])
    expect(ref).toEqual(snapshot)
    expect(out.tabs.slice(0, ref.tabs.length)).toEqual(ref.tabs)
    expect(out.tabs.at(-1).id).toBe('stitches')
    expect(out.tiles.at(-1)).toMatchObject({ tab: 'stitches', subKey: 'reader.reference.stitches.sub', feature: true })
    expect(out.abbr).toEqual(ref.abbr)
  })
  it('avec des fiches : « Modifier les points » en tête, puis un bloc par fiche', () => {
    const { blocks } = withStitchMemo(null, [SC]).tabs.at(-1)
    expect(blocks).toEqual([
      { action: { event: 'pick-stitches', labelKey: 'stitchMemo.edit' } },
      { h3: 'Maille serrée', muted: ['ms'], steps: ['a', 'b', 'c'], tip: 'astuce' },
    ])
  })
  it('référence absente et aucune fiche : tuile présente, explication puis action', () => {
    const out = withStitchMemo(null, [])
    expect(out.tiles).toHaveLength(1)
    expect(out.tiles[0].subKey).toBe('reader.reference.stitches.subEmpty')
    expect(out.tabs[0].blocks).toEqual([{ mutedKey: 'stitchMemo.empty' }, { action: { event: 'pick-stitches', labelKey: 'stitchMemo.pick' } }])
    expect(out.abbr).toEqual({})
    expect(out.abbrFull).toEqual([])
  })
})
