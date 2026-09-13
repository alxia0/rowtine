import { describe, it, expect } from 'vitest'
import { fillProjectFromPattern } from '@/utils/project-fill'

describe('fillProjectFromPattern', () => {
  it('renvoie {} si le patron est null/undefined', () => {
    expect(fillProjectFromPattern(null, { name: '' })).toEqual({})
    expect(fillProjectFromPattern(undefined, { name: '' })).toEqual({})
  })

  it('patron complet + form vide → tous les champs sont préremplis', () => {
    const pattern = {
      type: 'crochet',
      sizes: ['S', 'M'],
      name: 'SABAI',
      needleMm: '4.5',
      needleUs: 'H',
      gaugeStitches: '20',
      gaugeRows: '28',
    }
    const form = { technique: '', sizes: [], name: '', needles: [{ mm: '', us: '' }], gaugeStitches: '', gaugeRows: '' }
    const patch = fillProjectFromPattern(pattern, form)
    expect(patch).toEqual({
      technique: 'crochet',
      sizes: ['S', 'M'],
      name: 'SABAI',
      needles: [{ mm: '4.5', us: 'H' }],
      gaugeStitches: '20',
      gaugeRows: '28',
    })
  })

  it('ne préremplit pas le nom si déjà saisi dans le form', () => {
    const pattern = { name: 'SABAI' }
    const form = { name: 'Mon projet perso' }
    const patch = fillProjectFromPattern(pattern, form)
    expect(patch.name).toBeUndefined()
  })

  it('ne préremplit pas gaugeStitches si le patron ne le porte pas', () => {
    const pattern = { gaugeStitches: '', gaugeRows: '28' }
    const form = { gaugeStitches: '', gaugeRows: '' }
    const patch = fillProjectFromPattern(pattern, form)
    expect(patch.gaugeStitches).toBeUndefined()
    expect(patch.gaugeRows).toBe('28')
  })

  it('sizes : préremplit seulement si form.sizes est vide', () => {
    const pattern = { sizes: ['S', 'M'] }
    expect(fillProjectFromPattern(pattern, { sizes: [] }).sizes).toEqual(['S', 'M'])
    expect(fillProjectFromPattern(pattern, { sizes: ['L'] }).sizes).toBeUndefined()
  })

  it('technique : ignorée si le patron n\'a pas de type ou si le form a déjà une technique explicite', () => {
    expect(fillProjectFromPattern({}, { technique: '' }).technique).toBeUndefined()
    expect(fillProjectFromPattern({ type: 'knitting' }, { technique: 'crochet' }).technique).toBeUndefined()
  })

  it('technique : "knitting" est la valeur par défaut de emptyProject() (pas falsy) → traitée comme non choisie', () => {
    // Un formulaire fraîchement créé a form.technique === 'knitting' (jamais '') : le patron
    // doit quand même pouvoir la prérempiler (ex. patron crochet sur un projet tout juste créé).
    expect(fillProjectFromPattern({ type: 'crochet' }, { technique: 'knitting' }).technique).toBe('crochet')
  })

  it('aiguilles : le scalaire du patron devient une liste needles si le form n\'a pas d\'aiguille', () => {
    const pattern = { needleMm: '4.5', needleUs: 'H' }
    const form = { needles: [{ mm: '', us: '' }] }
    const patch = fillProjectFromPattern(pattern, form)
    expect(patch.needles).toEqual([{ mm: '4.5', us: 'H' }])
  })

  it('aiguilles : ignorées si le form a déjà une aiguille renseignée', () => {
    const pattern = { needleMm: '4.5', needleUs: 'H' }
    const form = { needles: [{ mm: '5', us: '' }] }
    const patch = fillProjectFromPattern(pattern, form)
    expect(patch.needles).toBeUndefined()
  })

  it('aiguilles : rien à prérempiler si le patron n\'a pas d\'aiguille', () => {
    const patch = fillProjectFromPattern({ name: 'X' }, { needles: [{ mm: '', us: '' }] })
    expect(patch.needles).toBeUndefined()
  })
})
