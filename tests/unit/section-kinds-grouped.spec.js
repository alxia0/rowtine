import { describe, it, expect } from 'vitest'
import { groupedSectionKinds } from '@/utils/section-kinds'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'
import de from '@/i18n/de.json'
import es from '@/i18n/es.json'

const labelsFor = (msgs) => ({ kinds: msgs.reader.kind, families: msgs.reader.family })
// Le menu de l'éditeur exclut diagramme et echantillon (doublons de la barre).
const EXCLUDE = ['diagramme', 'echantillon']
const groupsFr = () => groupedSectionKinds(labelsFor(fr), 'fr', { exclude: EXCLUDE })

describe('groupedSectionKinds', () => {
  it('range « Générique » et « Générique répétable » dans Général, par ordre alphabétique', () => {
    const gen = groupsFr().find((g) => g.family === 'transversal').items
    expect(gen.map((i) => i.value)).toEqual(['autre', 'finitions', 'pelote', 'repetable', 'infos'])
    expect(gen.find((i) => i.value === 'repetable').label).toBe('Générique répétable')
  })

  it('groupe par famille, dans l\'ordre de SECTION_FAMILIES, sans groupe sans titre', () => {
    expect(groupsFr().map((g) => g.family))
      .toEqual(['vetement', 'accessoire', 'chaussette', 'amigurumi', 'technique', 'transversal'])
  })

  it('corps et bordure apparaissent aussi dans la famille accessoire', () => {
    const acc = groupsFr().find((g) => g.family === 'accessoire').items.map((i) => i.value)
    expect(acc).toEqual(expect.arrayContaining(['corps', 'bordure', 'fond', 'rabat', 'poignee', 'bandouliere', 'anse', 'doublure', 'poche']))
  })

  it('trie sur le libellé TRADUIT : l\'ordre s\'inverse entre FR et EN', () => {
    const vetFr = groupedSectionKinds(labelsFor(fr), 'fr', { exclude: EXCLUDE })
      .find((g) => g.family === 'vetement').items.map((i) => i.value)
    const vetEn = groupedSectionKinds(labelsFor(en), 'en', { exclude: EXCLUDE })
      .find((g) => g.family === 'vetement').items.map((i) => i.value)
    // FR : Bordure / côtes < Corps        → bordure avant corps
    // EN : Body            < Border/ribbing → corps  avant bordure
    expect(vetFr.indexOf('bordure')).toBeLessThan(vetFr.indexOf('corps'))
    expect(vetEn.indexOf('corps')).toBeLessThan(vetEn.indexOf('bordure'))
  })

  it('exclut les kinds demandés et n\'émet pas une famille devenue vide', () => {
    const groups = groupsFr()
    const values = groups.flatMap((g) => g.items.map((i) => i.value))
    expect(values).not.toContain('diagramme')
    expect(values).not.toContain('echantillon')
    // « technique » garde boutonniere/dentelle/motif : la famille survit.
    expect(groups.find((g) => g.family === 'technique').items.map((i) => i.value))
      .toEqual(['boutonniere', 'dentelle', 'motif'])
    // Tout exclure d'une famille la fait disparaître.
    const sansTechnique = groupedSectionKinds(labelsFor(fr), 'fr', {
      exclude: [...EXCLUDE, 'boutonniere', 'dentelle', 'motif'],
    })
    expect(sansTechnique.some((g) => g.family === 'technique')).toBe(false)
  })

  it('classe correctement les accents (localeCompare, pas <)', () => {
    const ami = groupsFr().find((g) => g.family === 'amigurumi').items.map((i) => i.label)
    expect(ami).toEqual([...ami].sort((a, b) => a.localeCompare(b, 'fr')))
  })

  it('famille chaussette : six types triés par libellé traduit, en fr, en, de et es', () => {
    const KEYS = ['cotes', 'pointe', 'pied', 'talon', 'jambe', 'gousset']
    for (const [msgs, locale] of [[fr, 'fr'], [en, 'en'], [de, 'de'], [es, 'es']]) {
      const g = groupedSectionKinds(labelsFor(msgs), locale, { exclude: EXCLUDE })
        .find((x) => x.family === 'chaussette')
      expect(g, locale).toBeTruthy()
      expect(g.label, locale).toBe(msgs.reader.family.chaussette)
      expect(g.items.map((i) => i.value).sort()).toEqual([...KEYS].sort())
      const labels = g.items.map((i) => i.label)
      expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, locale)))
      for (const i of g.items) expect(i.label, `${locale}:${i.value}`).toBe(msgs.reader.kind[i.value])
    }
  })
})

import { isSockKind, isRepeatable, isPaired, canWorkSimultaneously, PAIRED_KINDS } from '../../src/utils/section-kinds'

describe('types répétables', () => {
  it('les types appariés sont répétables et les autres types ne le sont pas', () => {
    for (const k of ['manche', 'membre', 'oreille', 'cotes', 'pointe', 'pied', 'talon', 'jambe', 'gousset']) {
      expect(isRepeatable(k)).toBe(true)
      expect(isPaired(k)).toBe(true)
    }
    for (const k of ['corps', 'tete', 'motif', 'pelote', 'bordure']) expect(isRepeatable(k)).toBe(false)
    expect(PAIRED_KINDS).toHaveLength(9)
  })
  it('« Générique répétable » : répétable, ni apparié ni chaussette', () => {
    expect(isRepeatable('repetable')).toBe(true)
    expect(isPaired('repetable')).toBe(false)
    expect(canWorkSimultaneously('repetable', 2)).toBe(false)
  })
  it('le simultané exige un type chaussette et exactement 2 exemplaires', () => {
    expect(canWorkSimultaneously('talon', 2)).toBe(true)
    expect(canWorkSimultaneously('talon', 3)).toBe(false)
    expect(canWorkSimultaneously('manche', 2)).toBe(false)
  })
})

describe('isSockKind', () => {
  it('vrai pour les six types chaussette, faux pour les autres', () => {
    for (const k of ['cotes', 'pointe', 'pied', 'talon', 'jambe', 'gousset']) expect(isSockKind(k)).toBe(true)
    expect(canWorkSimultaneously('cotes', 2)).toBe(true)
    for (const k of ['manche', 'membre', 'oreille', 'corps']) expect(isSockKind(k)).toBe(false)
  })
})
