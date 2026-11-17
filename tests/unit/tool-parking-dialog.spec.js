// @vitest-environment jsdom
// ToolParkingDialog : question posée quand un projet passe en pause (libérer ses outils ?) ou
// repasse en cours (reprendre ceux qui sont libres ?). En pause : liste en lecture seule,
// « Libérer » émet confirm([]), « Les garder » émet cancel. En reprise : cases cochées par
// défaut si l'outil est libre, désactivées sinon avec « pris par <noms> » ; « Reprendre »
// émet confirm avec les clés cochées. Croix, voile et Échap émettent cancel.
import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import fr from '@/i18n/fr.json'
import ToolParkingDialog from '@/components/ToolParkingDialog.vue'
import { createTestI18n, makeTk } from './helpers/i18n-router'

const i18n = createTestI18n()
const tk = makeTk(i18n)
const stubs = { AppIcon: true }

const entries = [
  { key: 't1', kind: 'tool', tool: { id: 1, type: 'straight', brand: 'ChiaoGoo', sizeMm: 4 }, free: true, takenBy: [] },
  {
    key: 'k2:4:80',
    kind: 'kit',
    tool: { id: 2, type: 'interchangeable', brand: 'Knit Pro' },
    sizeMm: 4,
    cableCm: 80,
    cableJoin: null,
    free: true,
    takenBy: [],
  },
  { key: 't3', kind: 'tool', tool: { id: 3, type: 'hook', brand: 'Clover', sizeMm: 3 }, free: false, takenBy: ['Bonnet', 'Pull'] },
]

let wrapper
function mountDialog(props) {
  wrapper = mount(ToolParkingDialog, { props: { open: true, mode: 'pause', entries, ...props }, global: { plugins: [i18n], stubs }, attachTo: document.body })
  return wrapper
}
afterEach(() => wrapper?.unmount())

describe('ToolParkingDialog', () => {
  it('fermé : rien n’est rendu', () => {
    const w = mountDialog({ open: false })
    expect(w.find('.tpd').exists()).toBe(false)
  })

  it('pause : titre, introduction, liste en lecture seule (aucune case)', () => {
    const w = mountDialog({})
    expect(w.text()).toContain(tk('toolParking.pauseTitle'))
    expect(w.text()).toContain(tk('toolParking.pauseIntro'))
    expect(w.findAll('.tpd__row')).toHaveLength(3)
    expect(w.findAll('input[type="checkbox"]')).toHaveLength(0)
    expect(w.text()).toContain('ChiaoGoo')
  })

  it('pause : un kit montre sa taille et son câble comme la fiche projet', () => {
    const w = mountDialog({})
    expect(w.findAll('.tpd__row')[1].text()).toContain('4 mm + 80 cm')
  })

  it('pause : « Libérer » émet confirm avec [], « Les garder » émet cancel', async () => {
    const w = mountDialog({})
    await w.find('.tpd__confirm').trigger('click')
    expect(w.emitted('confirm')).toEqual([[[]]])
    expect(w.emitted('cancel')).toBeUndefined()
    expect(w.find('.tpd__confirm').text()).toBe(tk('toolParking.release'))
    await w.find('.tpd__cancel').trigger('click')
    expect(w.emitted('cancel')).toHaveLength(1)
    expect(w.find('.tpd__cancel').text()).toBe(tk('toolParking.keep'))
  })

  it('reprise : cases cochées si libres, désactivées et « pris par » sinon', () => {
    const w = mountDialog({ mode: 'resume' })
    expect(w.text()).toContain(tk('toolParking.resumeTitle'))
    expect(w.text()).toContain(tk('toolParking.resumeIntro'))
    const boxes = w.findAll('input[type="checkbox"]')
    expect(boxes).toHaveLength(3)
    expect(boxes[0].element.checked).toBe(true)
    expect(boxes[1].element.checked).toBe(true)
    expect(boxes[2].element.checked).toBe(false)
    expect(boxes[2].element.disabled).toBe(true)
    expect(boxes[0].element.disabled).toBe(false)
    // Un seul libellé : « en cours : … » de ToolRow, sans second « pris par ».
    const taken = w.findAll('.tpd__row')[2].text()
    expect(taken).toContain(tk('tools.inUseBy', { name: 'Bonnet, Pull' }))
    expect(taken.match(/Bonnet/g)).toHaveLength(1)
    expect(w.findAll('.tpd__taken')).toHaveLength(0)
    expect(w.findAll('.tpd__row')[0].text()).not.toContain(tk('tools.inUseBy', { name: '' }).split(':')[0])
  })

  it('reprise : « Reprendre » émet les clés cochées, décocher une case l’exclut', async () => {
    const w = mountDialog({ mode: 'resume' })
    await w.find('.tpd__confirm').trigger('click')
    expect(w.emitted('confirm')[0]).toEqual([['t1', 'k2:4:80']])
    await w.findAll('input[type="checkbox"]')[0].setValue(false)
    await w.find('.tpd__confirm').trigger('click')
    expect(w.emitted('confirm')[1]).toEqual([['k2:4:80']])
    expect(w.find('.tpd__confirm').text()).toBe(tk('toolParking.resume'))
    expect(w.find('.tpd__cancel').text()).toBe(tk('toolParking.notNow'))
  })

  it('reprise : « Pas maintenant », croix, voile et Échap émettent cancel, jamais confirm', async () => {
    const w = mountDialog({ mode: 'resume' })
    await w.find('.tpd__cancel').trigger('click')
    await w.find('.tpd__close').trigger('click')
    await w.find('.tpd__scrim').trigger('click')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('cancel')).toHaveLength(4)
    expect(w.emitted('confirm')).toBeUndefined()
  })

  it('pause : Échap émet cancel', () => {
    const w = mountDialog({})
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('cancel')).toHaveLength(1)
  })

  it('reprise : une réouverture recoche les libres (état remis à zéro)', async () => {
    const w = mountDialog({ mode: 'resume' })
    await w.findAll('input[type="checkbox"]')[0].setValue(false)
    await w.setProps({ open: false })
    await w.setProps({ open: true })
    expect(w.findAll('input[type="checkbox"]')[0].element.checked).toBe(true)
  })
})
