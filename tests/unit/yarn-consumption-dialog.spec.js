// @vitest-environment jsdom
// YarnConsumptionDialog — question posée à la clôture d'un projet (K2) : « combien de
// pelotes as-tu réellement utilisées ? ». Piège UX (décision produit) : PAS de bouton
// Annuler — fermer la question (croix, scrim, Échap) consomme TOUT le réservé (défaut =
// tout tricoté). Les champs sont pré-remplis à la quantité réservée ; mettre 0 = « rien
// tricoté », le reliquat retourne au stock.
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import fr from '@/i18n/fr.json'
import YarnConsumptionDialog from '@/components/YarnConsumptionDialog.vue'
import { createTestI18n, makeTk } from './helpers/i18n-router'

const i18n = createTestI18n()

const tk = makeTk(i18n)
const stubs = { AppIcon: true }

const yarns = [
  { id: 1, name: 'Drops · Bleu', reserved: 3 },
  { id: 2, name: 'Katia · Écru', reserved: 1 },
]

function mountDialog(props) {
  return mount(YarnConsumptionDialog, { props, global: { plugins: [i18n], stubs } })
}

describe('YarnConsumptionDialog', () => {
  it('fermé : rien n’est rendu', () => {
    const w = mountDialog({ open: false, yarns })
    expect(w.find('.ycn').exists()).toBe(false)
  })

  it('ouvert : titre + une ligne par laine (nom + « n réservée(s) ») + champ pré-rempli à reserved', () => {
    const w = mountDialog({ open: true, yarns })
    expect(w.text()).toContain(fr.project.consumeTitle)
    const rows = w.findAll('.ycn__row')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('Drops · Bleu')
    expect(rows[0].text()).toContain(tk('project.consumeReserved', { n: 3 }))
    expect(rows[1].text()).toContain('Katia · Écru')
    expect(rows[1].text()).toContain(tk('project.consumeReserved', { n: 1 }))
    const inputs = w.findAll('.ycn__input')
    expect(inputs).toHaveLength(2)
    expect(inputs[0].element.value).toBe('3')
    expect(inputs[1].element.value).toBe('1')
  })

  it('« Valider » sans rien toucher émet confirm avec used === reserved pour chaque laine', async () => {
    const w = mountDialog({ open: true, yarns })
    await w.find('.ycn__confirm').trigger('click')
    expect(w.emitted('confirm')).toBeTruthy()
    expect(w.emitted('confirm')[0]).toEqual([
      [
        { id: 1, used: 3 },
        { id: 2, used: 1 },
      ],
    ])
  })

  it('corriger un nombre à 2 puis Valider émet used: 2 pour cette laine', async () => {
    const w = mountDialog({ open: true, yarns })
    await w.findAll('.ycn__input')[0].setValue(2)
    await w.find('.ycn__confirm').trigger('click')
    expect(w.emitted('confirm')[0]).toEqual([
      [
        { id: 1, used: 2 },
        { id: 2, used: 1 },
      ],
    ])
  })

  it('mettre 0 émet used: 0 (rien tricoté)', async () => {
    const w = mountDialog({ open: true, yarns })
    await w.findAll('.ycn__input')[0].setValue(0)
    await w.find('.ycn__confirm').trigger('click')
    expect(w.emitted('confirm')[0][0][0]).toEqual({ id: 1, used: 0 })
  })

  it('un nombre supérieur au réservé est borné au réservé', async () => {
    const w = mountDialog({ open: true, yarns })
    await w.findAll('.ycn__input')[0].setValue(99)
    await w.find('.ycn__confirm').trigger('click')
    expect(w.emitted('confirm')[0][0][0]).toEqual({ id: 1, used: 3 })
  })

  // Protège : le champ montre toujours la valeur qui sera enregistrée (borne comprise).
  it('une saisie bornée est réécrite dans le champ, même si la valeur retenue ne change pas', async () => {
    const w = mountDialog({ open: true, yarns })
    const champ = w.findAll('.ycn__input')[0]
    await champ.setValue(99) // retenu : 3, déjà la valeur courante
    expect(champ.element.value).toBe('3')
    await champ.setValue(-5)
    expect(champ.element.value).toBe('0')
  })

  it('un nombre négatif ou illisible retombe à 0', async () => {
    const w = mountDialog({ open: true, yarns })
    await w.findAll('.ycn__input')[0].setValue(-5)
    await w.find('.ycn__confirm').trigger('click')
    expect(w.emitted('confirm')[0][0][0]).toEqual({ id: 1, used: 0 })
  })

  it('fermer par le scrim émet confirm avec les valeurs par défaut (tout tricoté), jamais un cancel', async () => {
    const w = mountDialog({ open: true, yarns })
    await w.find('.ycn__scrim').trigger('click')
    expect(w.emitted('confirm')).toBeTruthy()
    expect(w.emitted('confirm')[0]).toEqual([
      [
        { id: 1, used: 3 },
        { id: 2, used: 1 },
      ],
    ])
    expect(w.emitted('cancel')).toBeFalsy()
  })

  it('fermer par la croix émet confirm avec les valeurs par défaut, jamais un cancel', async () => {
    const w = mountDialog({ open: true, yarns })
    await w.find('.ycn__close').trigger('click')
    expect(w.emitted('confirm')[0]).toEqual([
      [
        { id: 1, used: 3 },
        { id: 2, used: 1 },
      ],
    ])
    expect(w.emitted('cancel')).toBeFalsy()
  })

  it('Échap émet confirm avec les valeurs par défaut, jamais un cancel (monté déjà ouvert)', () => {
    const w = mountDialog({ open: true, yarns })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('confirm')).toBeTruthy()
    expect(w.emitted('confirm')[0]).toEqual([
      [
        { id: 1, used: 3 },
        { id: 2, used: 1 },
      ],
    ])
    expect(w.emitted('cancel')).toBeFalsy()
    w.unmount()
  })

  it('la mention « le reste retourne au stock » est visible', () => {
    const w = mountDialog({ open: true, yarns })
    expect(w.text()).toContain(fr.project.consumeHint)
  })

  describe('mode « abandonné » (R3) : même dialogue, défaut inversé à 0', () => {
    it('mode abandonné : le champ est pré-rempli à 0 (par défaut on détricote, tout revient)', () => {
      const w = mountDialog({ open: true, mode: 'abandoned', yarns: [{ id: 1, name: 'Bleu', reserved: 3 }] })
      expect(w.find('input[type=number]').element.value).toBe('0')
      expect(w.text()).toContain(fr.project.abandonTitle)
    })
    it('mode abandonné : fermer applique le défaut 0 (rien de perdu)', async () => {
      const w = mountDialog({ open: true, mode: 'abandoned', yarns: [{ id: 1, name: 'Bleu', reserved: 3 }] })
      await w.find('.ycn__scrim').trigger('click')
      expect(w.emitted('confirm')[0][0]).toEqual([{ id: 1, used: 0 }])
    })
    it('mode terminé : inchangé, pré-rempli au réservé', () => {
      const w = mountDialog({ open: true, mode: 'done', yarns: [{ id: 1, name: 'Bleu', reserved: 3 }] })
      expect(w.find('input[type=number]').element.value).toBe('3')
      expect(w.text()).toContain(fr.project.consumeTitle)
    })
  })
})
