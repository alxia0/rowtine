// @vitest-environment jsdom
// (P2, audit UX 17/07) — CounterForm utilise désormais AppCheckbox (case
// maison) pour « suivre les augm./dim. » et « suivre les répétitions », au lieu de
// <input type="checkbox"> natif. Ce test verrouille le câblage : cocher révèle bien
// les champs, et la valeur cochée part dans le `extra` émis (non-régression fonctionnelle
// du remplacement de l'input natif par AppCheckbox).
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import i18n from '@/i18n'
import CounterForm from '@/components/CounterForm.vue'
import AppCheckbox from '@/components/AppCheckbox.vue'

function mountForm() {
  return mount(CounterForm, { global: { plugins: [i18n] } })
}

describe('CounterForm — cases à cocher (AppCheckbox)', () => {
  it('les 2 cases natives sont remplacées par le composant AppCheckbox (case maison)', () => {
    const w = mountForm()
    expect(w.findAllComponents(AppCheckbox)).toHaveLength(2)
  })

  it('« suivre les augm./dim. » : décoché par défaut, les champs de forme sont masqués', () => {
    const w = mountForm()
    const boxes = w.findAll('input[type="checkbox"]')
    expect(boxes[0].element.checked).toBe(false)
    expect(w.find('.seg').exists()).toBe(false)
  })

  it('cocher « suivre les augm./dim. » révèle les champs de forme', async () => {
    const w = mountForm()
    const boxes = w.findAll('input[type="checkbox"]')
    await boxes[0].setValue(true)
    expect(w.find('.seg').exists()).toBe(true)
  })

  it('cocher « suivre les répétitions » révèle les champs de répétition', async () => {
    const w = mountForm()
    const boxes = w.findAll('input[type="checkbox"]')
    await boxes[1].setValue(true)
    // Un seul champ de répétition visible : le placeholder « 8 » du nombre de rangs.
    expect(w.find('input[placeholder="8"]').exists()).toBe(true)
  })

  it('soumission avec la case « répétitions » cochée transmet hasRepeat=true dans extra', async () => {
    const w = mountForm()
    await w.find('.input').setValue('Manche')
    const boxes = w.findAll('input[type="checkbox"]')
    await boxes[1].setValue(true)
    await w.find('input[placeholder="8"]').setValue('6')
    await w.find('.btn--primary').trigger('click')

    const evt = w.emitted('submit')
    expect(evt).toBeTruthy()
    expect(evt[0][0].extra.hasRepeat).toBe(true)
    expect(evt[0][0].extra.repeatRows).toBe(6)
  })

  it('les 2 cases sont de vrais <input type="checkbox"> (accessibilité clavier)', () => {
    const w = mountForm()
    expect(w.findAll('input[type="checkbox"]')).toHaveLength(2)
  })
})
