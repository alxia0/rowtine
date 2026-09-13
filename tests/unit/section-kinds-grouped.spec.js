import { describe, it, expect } from 'vitest'
import { groupedSectionKinds } from '@/utils/section-kinds'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'

const labelsFor = (msgs) => ({ kinds: msgs.reader.kind, families: msgs.reader.family })
// Le menu de l'éditeur exclut diagramme et echantillon (doublons de la barre).
const EXCLUDE = ['diagramme', 'echantillon']
const groupsFr = () => groupedSectionKinds(labelsFor(fr), 'fr', { exclude: EXCLUDE })

describe('groupedSectionKinds', () => {
  it('met le défaut « Générique » en tête, hors groupe', () => {
    const [first] = groupsFr()
    expect(first.family).toBeNull()
    expect(first.items).toEqual([{ value: 'pelote', label: 'Générique' }])
  })

  it('groupe par famille, dans l\'ordre de SECTION_FAMILIES', () => {
    expect(groupsFr().slice(1).map((g) => g.family))
      .toEqual(['vetement', 'accessoire', 'amigurumi', 'technique', 'transversal'])
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
})
