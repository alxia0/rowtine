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

  it('réservé décimal : libellé et valeur par défaut du champ au format de la langue (2,5, pas 2.5)', () => {
    const w = mountDialog({ open: true, yarns: [{ id: 1, name: 'Drops · Bleu', reserved: 2.5 }] })
    expect(w.find('.ycn__reserved').text()).toContain(tk('project.consumeReserved', { n: '2,5' }))
    expect(w.find('.ycn__input').element.value).toBe('2,5')
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
    await champ.setValue('9,9') // décimal au-dessus du réservé : borné à 3 aussi
    expect(champ.element.value).toBe('3')
  })

  // Un caractère refusé est retiré de l'affichage à la frappe, pas seulement de la valeur retenue.
  it('un caractère refusé est filtré de l’affichage à la frappe (« 2a » → « 2 », « -5 » → « 5 »)', async () => {
    const w = mountDialog({ open: true, yarns: [{ id: 1, name: 'Drops · Bleu', reserved: 30 }] })
    const champ = w.find('.ycn__input')
    await champ.setValue('2a')
    expect(champ.element.value).toBe('2')
    await champ.setValue('-5')
    expect(champ.element.value).toBe('5')
  })

  // Une saisie illisible (aucun chiffre) garde la valeur courante plutôt que de retomber à 0 en silence.
  it('une saisie illisible laisse la valeur courante inchangée', async () => {
    const w = mountDialog({ open: true, yarns })
    await w.findAll('.ycn__input')[0].setValue('abc')
    await w.find('.ycn__confirm').trigger('click')
    expect(w.emitted('confirm')[0][0][0]).toEqual({ id: 1, used: 3 })
  })

  // Cas central de la décimalisation : « 2,5 » (en dessous du réservé) est accepté tel quel.
  it('« 2,5 » est accepté (décimal, sous le réservé)', async () => {
    const w = mountDialog({ open: true, yarns })
    await w.findAll('.ycn__input')[0].setValue('2,5')
    await w.find('.ycn__confirm').trigger('click')
    expect(w.emitted('confirm')[0][0][0]).toEqual({ id: 1, used: 2.5 })
  })

  // Une quantité consommée peut être inférieure à une pelote entière.
  it('« 0,5 » est accepté', async () => {
    const w = mountDialog({ open: true, yarns })
    await w.findAll('.ycn__input')[0].setValue('0,5')
    await w.find('.ycn__confirm').trigger('click')
    expect(w.emitted('confirm')[0][0][0]).toEqual({ id: 1, used: 0.5 })
  })

  // Piège : « 2, » doit rester « 2, » pendant la frappe pour pouvoir devenir « 2,5 ».
  it('« 2, » n’est pas réécrit pendant la frappe (la virgule survit jusqu’à « 2,5 »)', async () => {
    const w = mountDialog({ open: true, yarns })
    const champ = w.findAll('.ycn__input')[0]
    await champ.setValue('2,')
    expect(champ.element.value).toBe('2,')
    await champ.setValue('2,5')
    expect(champ.element.value).toBe('2,5')
    await w.find('.ycn__confirm').trigger('click')
    expect(w.emitted('confirm')[0][0][0]).toEqual({ id: 1, used: 2.5 })
  })

  // Protège : le champ est lié à un tampon texte (comme ProjectEditView), pas à `defaultFor`
  // directement — sinon un re-rendu (props.yarns recalculé, ex. changement de langue)
  // remettrait le champ au défaut en écrasant la saisie en cours.
  it('un re-rendu de props.yarns (même contenu, nouveau tableau) laisse le champ à la saisie en cours', async () => {
    const w = mountDialog({ open: true, yarns })
    const champ = w.findAll('.ycn__input')[0]
    await champ.setValue('1,5')
    expect(champ.element.value).toBe('1,5')

    await w.setProps({ yarns: yarns.map((y) => ({ ...y })) }) // même contenu, nouveau tableau

    expect(w.findAll('.ycn__input')[0].element.value).toBe('1,5')
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
      expect(w.find('.ycn__input').element.value).toBe('0')
      expect(w.text()).toContain(fr.project.abandonTitle)
    })
    it('mode abandonné : fermer applique le défaut 0 (rien de perdu)', async () => {
      const w = mountDialog({ open: true, mode: 'abandoned', yarns: [{ id: 1, name: 'Bleu', reserved: 3 }] })
      await w.find('.ycn__scrim').trigger('click')
      expect(w.emitted('confirm')[0][0]).toEqual([{ id: 1, used: 0 }])
    })
    it('mode terminé : inchangé, pré-rempli au réservé', () => {
      const w = mountDialog({ open: true, mode: 'done', yarns: [{ id: 1, name: 'Bleu', reserved: 3 }] })
      expect(w.find('.ycn__input').element.value).toBe('3')
      expect(w.text()).toContain(fr.project.consumeTitle)
    })
  })
})
