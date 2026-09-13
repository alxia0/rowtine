import { describe, it, expect } from 'vitest'
import { buildReference } from '@/utils/reader-reference'
import { referenceToFlat } from '@/utils/pattern-md/reference-flat'

const FLAT = {
  abbr: [{ key: 'm.', def: 'maille' }, { key: 'AM', def: 'anneau marqueur' }],
  gauge: '10 × 10 cm = 20 m × 26 rgs en jersey end., aig. n° 4.',
  needles: 'Aig. circulaires n° 4 (80 cm)',
  yarn: 'Coton DK, 8 (8) 9 (10) 10 (11) pelotes',
  materials: ['4 anneaux marqueurs', 'aiguille à laine'],
  tips: ['Conseils', 'Voir la vidéo de montage.'],
  techniques: [{ title: 'Augmentation intercalaire', body: 'Relever le brin horizontal…' }],
  sizeTable: [{ label: 'Tour de poitrine (cm)', values: ['74', '82', '90', '98', '108', '118'] }],
}

describe('referenceToFlat', () => {
  it('inverse buildReference champ à champ', () => {
    expect(referenceToFlat(buildReference(FLAT))).toEqual(FLAT)
  })
  it('référence vide → forme plate vide', () => {
    expect(referenceToFlat(buildReference({}))).toEqual({
      abbr: [], gauge: '', needles: '', yarn: '', materials: [], tips: [], techniques: [], sizeTable: [],
    })
  })
  it('null → forme plate vide', () => {
    expect(referenceToFlat(null).abbr).toEqual([])
  })
  it('point fixe : rebuild identique', () => {
    const ref = buildReference(FLAT)
    expect(buildReference(referenceToFlat(ref))).toEqual(ref)
  })
  it('routage par h3Key : un h3 personnalisé mais avec la clé i18n needles retrouve son champ', () => {
    const ref = { tabs: [{ id: 'materiel', blocks: [
      { h3: 'Un titre quelconque', h3Key: 'reader.reference.h3.needles', p: ['Aig. n° 4'] },
    ] }] }
    expect(referenceToFlat(ref).needles).toBe('Aig. n° 4')
  })
  it('compat patron déjà enregistré : ancien libellé littéral "Aiguilles & matériel" sans h3Key retrouve son champ', () => {
    const ref = { tabs: [{ id: 'materiel', blocks: [
      { h3: 'Aiguilles & matériel', p: ['Aig. n° 4'] },
    ] }] }
    expect(referenceToFlat(ref).needles).toBe('Aig. n° 4')
  })
  // Le bloc Conseils vit dans son PROPRE onglet (id 'tips'), pas dans
  // 'materiel' : referenceToFlat doit le router séparément, sur le modèle de 'tech'.
  it("onglet 'tips' → flat.tips (tableau verbatim, comme materials)", () => {
    const ref = { tabs: [{ id: 'tips', blocks: [{ h3: 'Conseils', h3Key: 'reader.reference.h3.tips', p: ['Conseils', 'Voir la vidéo.'] }] }] }
    expect(referenceToFlat(ref).tips).toEqual(['Conseils', 'Voir la vidéo.'])
  })
  it("pas d'onglet 'tips' → flat.tips reste un tableau vide", () => {
    expect(referenceToFlat(buildReference({ gauge: '10 cm' })).tips).toEqual([])
  })
})
