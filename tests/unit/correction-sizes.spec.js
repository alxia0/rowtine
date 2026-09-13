// Le nombre de colonnes du tableau des tailles est verrouille par `reader.sizeLabels`.
// Sans champ pour le corriger, une utilisatrice dont l'import s'est trompe sur les tailles
// n'a AUCUN moyen de reconstruire sa table (retour terrain, 19/08/2026).
import { describe, it, expect } from 'vitest'
import { normalizeReaderForSave, resizeReferenceSizeTable } from '@/utils/reader-edit'
import { mdFragmentToReader } from '@/utils/pattern-md/fragment'

describe('changer les tailles rend une table exploitable', () => {
  const fragment = `## Tailles {measurements}

| mesure | S | M | L |
|---|---|---|---|
| Tour de poitrine | 74 | 82 | 90 |

## Corps {body}

- Rang 1 : monter 90 m
`

  it('avec les MAUVAISES tailles, la ligne est rejetee vers les notes', () => {
    const { reader } = mdFragmentToReader(fragment, { sizeLabels: ['S', 'M'], sections: [] })
    const notes = (reader.sections || []).flatMap((s) => (s.steps || []).filter((st) => st.note))
    expect(notes.length).toBeGreaterThan(0)
  })

  it('avec les BONNES tailles, la meme table alimente la rubrique', () => {
    const { reader } = mdFragmentToReader(fragment, { sizeLabels: ['S', 'M', 'L'], sections: [] })
    const rows = reader.reference.tabs.find((t) => t.id === 'tailles').blocks[0].sizeTable.rows
    expect(rows).toEqual([{ label: 'Tour de poitrine', values: ['74', '82', '90'] }])
  })
})

// Revue finale (I1) : le champ « Tailles » de l'ecran de correction n'atteignait JAMAIS le
// parseur — `minimalFrontMatter` (fragment.js) tirait toujours `sizes:` de baseReader. Le
// texte partait donc au NOUVEAU nombre de colonnes et se relisait a l'ANCIEN : la table tout
// juste reconstruite etait rejetee (sizes.countMismatch) puis retrogradee en notes. Le geste
// echouait au premier essai, il fallait enregistrer deux fois.
describe('les tailles saisies atteignent le parseur (I1)', () => {
  // Meme fragment que ci-dessus (table a 3 colonnes + une section de travail : sans section,
  // mdFragmentToReader renvoie un clone de baseReader et rien ne serait teste).
  const fragment3 = `## Tailles {measurements}

| mesure | S | M | L |
|---|---|---|---|
| Tour de poitrine | 74 | 82 | 90 |

## Corps {body}

- Rang 1 : monter 90 m
`
  const rowsOf = (reader) => reader.reference?.tabs?.find((t) => t.id === 'tailles')?.blocks[0].sizeTable.rows

  it('un reader a 2 tailles + un champ a 3 tailles relit la table des le premier essai', () => {
    const { reader } = mdFragmentToReader(fragment3, { sizeLabels: ['S', 'M'], sections: [] }, { sizeLabels: ['S', 'M', 'L'] })
    expect(rowsOf(reader)).toEqual([{ label: 'Tour de poitrine', values: ['74', '82', '90'] }])
  })

  it('sans les tailles du champ, la meme table est rejetee vers les notes (defaut corrige)', () => {
    const { reader } = mdFragmentToReader(fragment3, { sizeLabels: ['S', 'M'], sections: [] })
    expect(rowsOf(reader)).toBeUndefined()
  })

  it('champ vide : repli sur les tailles du reader (meme repli que normalizeReaderForSave)', () => {
    const { reader } = mdFragmentToReader(fragment3, { sizeLabels: ['S', 'M', 'L'], sections: [] }, { sizeLabels: [] })
    expect(rowsOf(reader)).toEqual([{ label: 'Tour de poitrine', values: ['74', '82', '90'] }])
  })
})

describe('redimensionnement des vecteurs de comptes', () => {
  it('passer de 2 a 3 tailles complete les vecteurs sans les casser', () => {
    const reader = {
      sizeLabels: ['S', 'M'],
      sections: [{ title: 'Corps', steps: [{ t: 'monter {{0}} m', c: [['90', '100']] }] }],
    }
    const out = normalizeReaderForSave(reader, ['S', 'M', 'L'])
    expect(out.sizeLabels).toEqual(['S', 'M', 'L'])
    expect(out.sections[0].steps[0].c[0]).toHaveLength(3)
  })

  // Garde le repli documente en tete de normalizeReaderForSave (reader-edit.js) : un
  // champ Tailles vide au moment d'enregistrer ne doit PAS ecraser les tailles du
  // reader. CorrectionView.vue s'appuie explicitement sur ce repli (lit
  // `readerWithSizes.sizeLabels`, jamais le champ texte brut, pour ecrire `sizes`) :
  // si ce test casse, le contrat d'atomicite reader/sizes de l'ecran de correction
  // casse avec lui.
  it('un champ tailles vide conserve les sizeLabels existants du reader (repli)', () => {
    const reader = {
      sizeLabels: ['S', 'M', 'L'],
      sections: [{ title: 'Corps', steps: [{ t: 'monter {{0}} m', c: [['90', '100', '110']] }] }],
    }
    const out = normalizeReaderForSave(reader, [])
    expect(out.sizeLabels).toEqual(['S', 'M', 'L'])
    expect(out.sections[0].steps[0].c[0]).toHaveLength(3)
  })
})

// Revue finale (I2) : ReaderSheet.vue boucle l'en-tete sur `sizeLabels` et les cellules sur
// `row.values`, independamment — une rangee plus large que l'en-tete donne une colonne
// orpheline et decale le surlignage de la taille active. Rien ne recadrait ces rangees.
describe('recadrage des rangees du tableau des tailles (I2)', () => {
  const readerWith = (values) => ({
    sizeLabels: ['S', 'M', 'L'],
    sections: [],
    reference: {
      tabs: [
        { id: 'materiel', blocks: [{ h3: 'Fil', p: ['Coton DK'] }] },
        { id: 'tailles', blocks: [{ h3: 'Tailles', sizeTable: { rows: [{ label: 'Tour de poitrine', values }] } }] },
      ],
    },
  })
  const rowsOf = (reader) => reader.reference.tabs.find((t) => t.id === 'tailles').blocks[0].sizeTable.rows

  it('reduire le nombre de tailles ne laisse pas de colonne orpheline, et ne perd pas la valeur en trop', () => {
    const out = resizeReferenceSizeTable(readerWith(['90', '100', '110']), ['S', 'M'])
    expect(rowsOf(out)).toEqual([{ label: 'Tour de poitrine', values: ['90', '100 110'] }])
  })

  it('augmenter le nombre de tailles complete par du vide, sans rien inventer', () => {
    const out = resizeReferenceSizeTable(readerWith(['90', '100', '110']), ['S', 'M', 'L', 'XL'])
    expect(rowsOf(out)).toEqual([{ label: 'Tour de poitrine', values: ['90', '100', '110', ''] }])
  })

  it('ne touche ni les autres onglets ni le reader d entree (fonction pure)', () => {
    const reader = readerWith(['90', '100', '110'])
    const out = resizeReferenceSizeTable(reader, ['S', 'M'])
    expect(rowsOf(reader)).toEqual([{ label: 'Tour de poitrine', values: ['90', '100', '110'] }])
    expect(out.reference.tabs[0]).toEqual(reader.reference.tabs[0])
  })

  it('reader sans reference : renvoye tel quel', () => {
    const reader = { sizeLabels: ['S'], sections: [] }
    expect(resizeReferenceSizeTable(reader, ['S', 'M'])).toBe(reader)
  })
})
