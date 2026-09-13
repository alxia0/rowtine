import { describe, it, expect } from 'vitest'
import { buildReference } from '@/utils/reader-reference'

describe('buildReference', () => {
  it('construit abbr/abbrFull/tabs/tiles depuis la forme plate', () => {
    const out = buildReference({
      abbr: [{ key: 'm.', def: 'maille(s)' }, { key: 'end.', def: 'à l\'endroit' }],
      gauge: '20 m x 28 rangs = 10 cm',
      yarn: 'Silk Mohair, 2 fils',
      sizeTable: [{ label: 'Poitrine (cm)', values: ['90', '100'] }],
    })
    expect(out.abbr).toEqual({ 'm.': 'maille(s)', 'end.': 'à l\'endroit' })
    expect(out.abbrFull).toEqual([['m.', 'maille(s)'], ['end.', 'à l\'endroit']])
    expect(out.tabs.map((t) => t.id)).toEqual(['materiel', 'tailles', 'abbr'])
    expect(out.tiles.length).toBe(3)
  })
  it('objet vide → structures vides sans erreur', () => {
    const out = buildReference()
    expect(out.tabs).toEqual([])
    expect(out.abbrFull).toEqual([])
  })
  it('bloc aiguilles distinct du bloc matériel : titre "Aiguilles" seul (pas de faux doublon)', () => {
    const out = buildReference({ needles: 'Aiguilles circulaires n° 4', materials: ['Anneaux marqueurs'] })
    const mat = out.tabs.find((t) => t.id === 'materiel')
    expect(mat.blocks.find((b) => b.h3Key === 'reader.reference.h3.needles').h3).toBe('Aiguilles/Crochet')
    expect(mat.blocks.find((b) => b.h3 === 'Matériel')).toBeTruthy()
  })

  // Bloc « Conseils » : sa PROPRE tuile/onglet (pas rattaché à Matériel &
  // échantillon), sur le modèle exact de `tech` (mêmes formes {id, label, labelKey,
  // blocks} / {tab, title, titleKey, sub, subKey}), affiché seulement si non vide.
  it('bloc `tips` non vide → onglet et tuile dédiés, sur le modèle de `tech`', () => {
    const out = buildReference({ tips: ['Conseils', 'Voir la vidéo de montage.'] })
    const tab = out.tabs.find((t) => t.id === 'tips')
    expect(tab).toBeTruthy()
    expect(tab.label).toBe('Conseils')
    expect(tab.labelKey).toBe('reader.reference.tips.label')
    expect(tab.blocks).toEqual([{ h3: 'Conseils', h3Key: 'reader.reference.h3.tips', p: ['Conseils', 'Voir la vidéo de montage.'] }])
    const tile = out.tiles.find((t) => t.tab === 'tips')
    expect(tile).toEqual({
      tab: 'tips',
      title: 'Conseils',
      titleKey: 'reader.reference.tips.label',
      sub: 'Astuces du patron',
      subKey: 'reader.reference.tips.sub',
    })
  })

  it('bloc `tips` absent ou vide → aucun onglet ni tuile `tips`', () => {
    expect(buildReference({}).tabs.find((t) => t.id === 'tips')).toBeUndefined()
    expect(buildReference({ tips: [] }).tabs.find((t) => t.id === 'tips')).toBeUndefined()
    expect(buildReference({ gauge: '10 cm' }).tiles.find((t) => t.tab === 'tips')).toBeUndefined()
  })
})
