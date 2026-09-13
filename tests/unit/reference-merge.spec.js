// Deux blocs de même rubrique dans un même MD : `Object.assign` gardait le SECOND et
// jetait le premier, en silence. Ce fichier verrouille la fusion qui remplace ce geste.
import { describe, it, expect } from 'vitest'
import { mergeFlat } from '@/utils/pattern-md/reference-merge'
import { mdToPattern } from '@/utils/pattern-md/parse'

const FM = '---\nrowtine: 1\ntitle: Essai\n---\n\n'

describe('mergeFlat', () => {
  it('joint les rubriques de texte libre par un saut de ligne', () => {
    expect(mergeFlat({ yarn: 'Coton DK' }, { yarn: '3 pelotes' }))
      .toEqual({ yarn: 'Coton DK\n3 pelotes' })
  })

  it('concatene les rubriques a liste', () => {
    expect(mergeFlat({ materials: ['4 marqueurs'] }, { materials: ['1 aiguille a laine'] }))
      .toEqual({ materials: ['4 marqueurs', '1 aiguille a laine'] })
  })

  it('concatene les tables', () => {
    const a = { abbr: [{ key: 'm', def: 'maille' }] }
    const b = { abbr: [{ key: 'aug', def: 'augmentation' }] }
    expect(mergeFlat(a, b)).toEqual({
      abbr: [{ key: 'm', def: 'maille' }, { key: 'aug', def: 'augmentation' }],
    })
  })

  it('prend la valeur entrante quand la cle est absente de la cible', () => {
    expect(mergeFlat({ yarn: 'Coton DK' }, { needles: 'n 4' }))
      .toEqual({ yarn: 'Coton DK', needles: 'n 4' })
  })

  it('ne mute ni la cible ni la source', () => {
    const into = { materials: ['a'] }
    const add = { materials: ['b'] }
    mergeFlat(into, add)
    expect(into).toEqual({ materials: ['a'] })
    expect(add).toEqual({ materials: ['b'] })
  })

  it('joint les clés scalaires inconnues par un saut de ligne (pas de perte)', () => {
    expect(mergeFlat({ custom: 'Valeur 1' }, { custom: 'Valeur 2' }))
      .toEqual({ custom: 'Valeur 1\nValeur 2' })
  })
})

describe('parse.js — deux blocs de meme rubrique', () => {
  it('conserve les DEUX blocs Aiguilles au lieu de garder le second', () => {
    const res = mdToPattern(`${FM}## Aiguilles {needles}

Circulaires n 4, cable 80 cm

## Aiguilles {needles}

Double pointes n 3,5
`)
    const tab = res.pattern.reader.reference.tabs.find((t) => t.id === 'materiel')
    const bloc = tab.blocks.find((b) => b.h3Key === 'reader.reference.h3.needles')
    const combined = bloc.p.join(' ')
    expect(combined).toContain('Circulaires n 4')
    expect(combined).toContain('Double pointes n 3,5')
    // Vérifie l'ordre : le premier bloc du document doit apparaître en premier
    expect(combined.indexOf('Circulaires')).toBeLessThan(combined.indexOf('Double'))
  })

  it('conserve les lignes des DEUX blocs Materiel', () => {
    const res = mdToPattern(`${FM}## Materiel {materials}

- 4 anneaux marqueurs

## Materiel {materials}

- 1 aiguille a laine
`)
    const tab = res.pattern.reader.reference.tabs.find((t) => t.id === 'materiel')
    const bloc = tab.blocks.find((b) => b.h3Key === 'reader.reference.h3.materials')
    expect(bloc.p).toEqual(['4 anneaux marqueurs', '1 aiguille a laine'])
  })
})
