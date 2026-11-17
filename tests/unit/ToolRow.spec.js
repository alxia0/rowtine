// @vitest-environment jsdom
// Protège le contenu d'une ligne d'outil : marque puis taille, résumé, état toujours dit, pas de photo.
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ToolRow from '@/components/ToolRow.vue'
import { createTestI18n } from './helpers/i18n-router'
import { emptyTool } from '@/stores/tools'

const i18n = createTestI18n()
const mountRow = (props) => mount(ToolRow, { props, global: { plugins: [i18n] } })
const t = i18n.global.t

describe('ToolRow', () => {
  it('affiche taille, type court, longueur, matière et marque, sans image', () => {
    const w = mountRow({ tool: { ...emptyTool('circular'), sizeMm: 4, lengthCm: 80, material: 'bamboo', brand: 'ChiaoGoo' } })
    expect(w.text()).toContain('US 6')
    expect(w.text()).toContain(t('tools.typesShort.circular'))
    expect(w.text()).toContain('80 cm')
    expect(w.text()).toContain(t('tools.materials.bamboo'))
    expect(w.text()).toContain('ChiaoGoo')
    expect(w.find('img').exists()).toBe(false)
  })
  it('ligne 1 : marque et gamme, puis la taille', () => {
    const w = mountRow({ tool: { ...emptyTool('circular'), sizeMm: 4, lengthCm: 80, brand: 'ChiaoGoo', line: 'Twist Red' } })
    expect(w.find('.trow__title').text()).toBe('ChiaoGoo Twist Red · 4 mm · US 6')
    expect(w.find('.trow__meta').text()).not.toContain('ChiaoGoo')
  })
  it('ligne 1 sans marque : la taille seule', () => {
    const w = mountRow({ tool: { ...emptyTool('circular'), sizeMm: 4, lengthCm: 80 } })
    expect(w.find('.trow__title').text()).toBe('4 mm · US 6')
  })
  it('ligne 2 : type et longueur, matière, puis l’état, « disponible » compris', () => {
    const w = mountRow({ tool: { ...emptyTool('circular'), sizeMm: 4, lengthCm: 80, material: 'aluminium', brand: 'ChiaoGoo' } })
    const expected = [`${t('tools.typesShort.circular')} 80 cm`, t('tools.materials.aluminium'), t('tools.statusesInline.available')].join(' · ')
    expect(w.find('.trow__sub').text()).toBe(expected)
    expect(w.find('.trow__status').text()).toBe(t('tools.statusesInline.available'))
  })
  it('quantité : « ×2 » au-delà de 1, rien pour 1', () => {
    const two = mountRow({ tool: { ...emptyTool('dpn'), sizeMm: 4, quantity: 2 } })
    expect(two.find('.trow__meta').text()).toContain(t('tools.countTimes', { n: 2 }))
    const one = mountRow({ tool: { ...emptyTool('dpn'), sizeMm: 4, quantity: 1 } })
    expect(one.find('.trow__meta').text()).not.toContain(t('tools.countTimes', { n: 1 }))
  })
  it('un outil disponible lié à un projet en cours le nomme', () => {
    const w = mountRow({ tool: { ...emptyTool('circular'), sizeMm: 4 }, inUseBy: 'Bonnet' })
    expect(w.find('.trow__status').text()).toBe(t('tools.inUseBy', { name: 'Bonnet' }))
  })
  it('projet en cours sans nom : « en cours » seul', () => {
    const w = mountRow({ tool: { ...emptyTool('circular'), sizeMm: 4 }, inUseBy: '' })
    expect(w.find('.trow__status').text()).toBe(t('tools.inUse'))
  })
  it('l’état réel prime sur « en cours » (prêté reste prêté)', () => {
    const w = mountRow({ tool: { ...emptyTool('circular'), sizeMm: 4, status: 'lent' }, inUseBy: 'Bonnet' })
    expect(w.find('.trow__status').text()).toBe(t('tools.statusesInline.lent'))
  })
  it('en simple étiquette (feuille de sélection), la ligne n’est pas un bouton et n’émet rien', async () => {
    const w = mountRow({ tool: { ...emptyTool('circular'), sizeMm: 4 }, as: 'span' })
    expect(w.find('button').exists()).toBe(false)
    await w.get('.trow').trigger('click')
    expect(w.emitted('open')).toBeUndefined()
  })
  it('sous une taille, un kit se présente comme « pointes du kit », marque en tête et état à la fin', () => {
    const w = mountRow({ tool: { ...emptyTool('interchangeable'), kitSizes: [4], brand: 'KnitPro', line: 'Zing' }, sizeMm: 4, viaKit: true })
    expect(w.find('.trow__title').text()).toBe('KnitPro Zing · 4 mm · US 6')
    expect(w.find('.trow__meta').text()).toBe(t('tools.fromKit', { name: 'KnitPro Zing' }))
    expect(w.find('.trow__status').text()).toBe(t('tools.statusesInline.available'))
  })
  it('sous une taille, un kit de crochets se présente comme « crochets du kit », taille en échelle crochet', () => {
    const w = mountRow({ tool: { ...emptyTool('hookKit'), kitSizes: [4], brand: 'ChiaoGoo' }, sizeMm: 4, viaKit: true })
    expect(w.find('.trow__title').text()).toBe(`ChiaoGoo · ${t('tools.sizeLineHook', { mm: '4', us: 'G-6' })}`)
    expect(w.find('.trow__meta').text()).toBe(t('tools.fromHookKit', { name: 'ChiaoGoo' }))
  })
  it('crochet : lettre US, taille à virgule décimale', () => {
    const w = mountRow({ tool: { ...emptyTool('standard'), sizeMm: 3.5 } })
    expect(w.text()).toContain(t('tools.sizeLineHook', { mm: '3,5', us: 'E-4' }))
  })
  it('crochet en acier : équivalent numérique préfixé « US » (1,5 mm · US 8)', () => {
    const w = mountRow({ tool: { ...emptyTool('standard'), sizeMm: 1.5, material: 'steel' } })
    expect(w.find('.trow__title').text()).toBe('1,5 mm · US 8')
  })
  it('crochet de 2,25 mm : numéro acier en acier, lettre sinon', () => {
    expect(mountRow({ tool: { ...emptyTool('standard'), sizeMm: 2.25, material: 'steel' } }).find('.trow__title').text()).toBe('2,25 mm · US 2')
    expect(mountRow({ tool: { ...emptyTool('standard'), sizeMm: 2.25, material: 'bamboo' } }).find('.trow__title').text()).toBe('2,25 mm · B-1')
  })
  it('taille sans équivalent US : seulement les mm', () => {
    const w = mountRow({ tool: { ...emptyTool('straight'), sizeMm: 7.5 } })
    expect(w.find('.trow__title').text()).toBe(t('tools.sizeMm', { mm: '7,5' }))
  })
  it('kit hors regroupement par taille : son intervalle de tailles, pas sa plus petite taille', () => {
    const w = mountRow({ tool: { ...emptyTool('interchangeable'), kitSizes: [3.5, 4, 5] } })
    expect(w.find('.trow__title').text()).toBe(t('tools.sizeRange', { min: '3,5', max: '5' }))
  })
  it('câble seul : sa longueur en titre, après la marque', () => {
    const w = mountRow({ tool: { ...emptyTool('cable'), lengthCm: 80 } })
    expect(w.find('.trow__title').text()).toBe(t('tools.lengthCm', { cm: '80' }))
    const branded = mountRow({ tool: { ...emptyTool('cable'), lengthCm: 80, brand: 'ChiaoGoo' } })
    expect(branded.find('.trow__title').text()).toBe(`ChiaoGoo · ${t('tools.lengthCm', { cm: '80' })}`)
  })
  it('sans taille ni longueur : le nom du type en titre', () => {
    const w = mountRow({ tool: { ...emptyTool('other') } })
    expect(w.find('.trow__title').text()).toBe(t('tools.types.other'))
  })
  it('kit sans marque ni gamme : nommé par son type, jamais par un nom vide', () => {
    const w = mountRow({ tool: { ...emptyTool('interchangeable'), kitSizes: [4] }, sizeMm: 4, viaKit: true })
    expect(w.text()).toContain(t('tools.fromKit', { name: t('tools.types.interchangeable') }))
  })
  it('toucher la ligne émet open avec l’outil', async () => {
    const tool = { ...emptyTool('circular'), id: 7, sizeMm: 4 }
    const w = mountRow({ tool })
    await w.get('button').trigger('click')
    expect(w.emitted('open')[0][0]).toEqual(tool)
  })
  it('kit : tailles prises par les projets en cours, sans câble', () => {
    const kit = { ...emptyTool('interchangeable'), kitSizes: [4, 5], kitCables: [80], brand: 'KnitPro' }
    const w = mountRow({ tool: kit, kitTaken: [{ sizeMm: 4, projectName: 'Bonnet' }, { sizeMm: 5, projectName: 'Pull' }] })
    const list = [t('tools.kitTakenSize', { size: '4 mm', name: 'Bonnet' }), t('tools.kitTakenSize', { size: '5 mm', name: 'Pull' })].join(', ')
    expect(w.find('.trow__status').text()).toBe(t('tools.inUseBy', { name: list }))
    expect(w.find('.trow__sub').text()).not.toContain('80')
  })
  it('kit sans taille prise : « disponible » ; l’état réel prime sur les tailles prises', () => {
    const kit = { ...emptyTool('interchangeable'), kitSizes: [4, 5] }
    expect(mountRow({ tool: kit, kitTaken: [] }).find('.trow__status').text()).toBe(t('tools.statusesInline.available'))
    const lent = mountRow({ tool: { ...kit, status: 'lent' }, kitTaken: [{ sizeMm: 4, projectName: 'Bonnet' }] })
    expect(lent.find('.trow__status').text()).toBe(t('tools.statusesInline.lent'))
  })
  it('kit lié en entier (lien ancien) : le projet sans taille, avant les tailles prises', () => {
    const kit = { ...emptyTool('interchangeable'), kitSizes: [4, 5] }
    const w = mountRow({ tool: kit, inUseBy: 'Châle', kitTaken: [{ sizeMm: 5, projectName: 'Pull' }] })
    expect(w.find('.trow__status').text()).toBe(t('tools.inUseBy', { name: `Châle, ${t('tools.kitTakenSize', { size: '5 mm', name: 'Pull' })}` }))
  })
  it('sous une taille, un kit ne dit que la prise de cette taille', () => {
    const kit = { ...emptyTool('interchangeable'), kitSizes: [4, 5] }
    const taken = [{ sizeMm: 4, projectName: 'Bonnet' }, { sizeMm: 5, projectName: 'Pull' }]
    const w = mountRow({ tool: kit, sizeMm: 5, viaKit: true, kitTaken: taken })
    expect(w.find('.trow__status').text()).toBe(t('tools.inUseBy', { name: t('tools.kitTakenSize', { size: '5 mm', name: 'Pull' }) }))
  })
  it('prise de kit (fiche projet) : marque, taille et câble en titre', () => {
    const kit = { ...emptyTool('interchangeable'), kitSizes: [4, 5], kitCables: [80], brand: 'KnitPro', line: 'Zing' }
    const w = mountRow({ tool: kit, pick: { sizeMm: 4, cableCm: 80 } })
    expect(w.find('.trow__title').text()).toBe(`KnitPro Zing · ${t('tools.kitPick', { size: '4 mm', cable: '80 cm' })}`)
    expect(mountRow({ tool: kit, pick: { sizeMm: 5, cableCm: null } }).find('.trow__title').text()).toBe('KnitPro Zing · 5 mm')
    const withJoin = mountRow({ tool: kit, pick: { sizeMm: 4, cableCm: 80, cableJoin: 'l' } })
    expect(withJoin.find('.trow__title').text()).toBe(`KnitPro Zing · ${t('tools.kitPick', { size: '4 mm', cable: '80 cm L' })}`)
  })
})
