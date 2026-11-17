// @vitest-environment jsdom
// YarnConsumptionDialog — question posée à la clôture d'un projet (K2) : « combien de
// pelotes as-tu réellement utilisées ? ». Règle (décision produit, qui remplace l'ancienne
// « pas d'Annuler, fermer applique le défaut ») : un bouton Annuler existe, et croix, voile
// et Échap valent Annuler (émettent `cancel`, jamais `confirm`) : rien n'est consommé, le
// statut ne change pas. Seul « Valider » émet `confirm`. Les champs sont pré-remplis à la
// quantité réservée (ou au disponible s'il est plus petit) ; saisir plus que le réservé est
// accepté tant que le DISPONIBLE pour ce projet suffit (sa réservation plus le stock libre,
// jamais les pelotes réservées par d'autres projets), au-delà la saisie est refusée avec un
// avertissement.
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import fr from '@/i18n/fr.json'
import YarnConsumptionDialog from '@/components/YarnConsumptionDialog.vue'
import { createTestI18n, makeTk } from './helpers/i18n-router'

const i18n = createTestI18n()

const tk = makeTk(i18n)
const stubs = { AppIcon: true }

const yarns = [
  { id: 1, name: 'Drops · Bleu', reserved: 3, available: 10 },
  { id: 2, name: 'Katia · Écru', reserved: 1, available: 4 },
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
    const w = mountDialog({ open: true, yarns: [{ id: 1, name: 'Drops · Bleu', reserved: 2.5, available: 10 }] })
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

  it('un nombre supérieur au réservé mais dans le disponible est accepté (5 sur {reserved: 3, available: 10})', async () => {
    const w = mountDialog({ open: true, yarns })
    const champ = w.findAll('.ycn__input')[0]
    await champ.setValue(5)
    expect(champ.element.value).toBe('5')
    expect(w.find('.ycn__over').exists()).toBe(false)
    await w.find('.ycn__confirm').trigger('click')
    expect(w.emitted('confirm')[0][0][0]).toEqual({ id: 1, used: 5 })
  })

  // Protège : le champ montre toujours la valeur qui sera enregistrée (borne = disponible).
  it('une saisie au-dessus du disponible est ramenée au disponible, avec avertissement et bouton « Corriger le stock »', async () => {
    const w = mountDialog({ open: true, yarns })
    const champ = w.findAll('.ycn__input')[0]
    await champ.setValue(12)
    expect(champ.element.value).toBe('10')
    const msg = w.find('.ycn__over')
    expect(msg.exists()).toBe(true)
    expect(msg.text()).toContain(tk('project.consumeOverStockPlain', { n: 10 }))
    expect(msg.text()).not.toContain(tk('project.consumeOverStock', { n: 10 }))
    expect(w.find('.ycn__fix').text()).toBe(tk('project.consumeFixStock'))
    await w.find('.ycn__confirm').trigger('click')
    expect(w.emitted('confirm')[0][0][0]).toEqual({ id: 1, used: 10 })
  })

  it('le message de dépassement disparaît à la ressaisie dans les bornes', async () => {
    const w = mountDialog({ open: true, yarns })
    const champ = w.findAll('.ycn__input')[0]
    await champ.setValue(12)
    expect(w.find('.ycn__over').exists()).toBe(true)
    await champ.setValue(4)
    expect(w.find('.ycn__over').exists()).toBe(false)
  })

  it('« Corriger le stock » émet fix-stock avec l’id de la laine concernée', async () => {
    const w = mountDialog({ open: true, yarns })
    await w.findAll('.ycn__input')[1].setValue(9) // disponible 4
    await w.find('.ycn__fix').trigger('click')
    expect(w.emitted('fix-stock')).toEqual([[2]])
  })

  // Régression (revue finale) : stock 5, A réserve 2, B réserve 3. Le composable passe à A un
  // disponible de 2 ; le champ ne peut pas monter au-dessus, l'avertissement donne cette borne.
  it('une laine que d\'autres projets réservent garde la phrase sur les autres projets, les autres non', async () => {
    const w = mountDialog({ open: true, yarns: [
      { id: 1, name: 'A', reserved: 3, available: 2, othersReserved: true },
      { id: 2, name: 'B', reserved: 3, available: 2, othersReserved: false },
    ] })
    const msgs = w.findAll('.ycn__over')
    expect(msgs[0].text()).toContain(tk('project.consumeOverStock', { n: 2 }))
    expect(msgs[0].text()).toContain('autres projets')
    expect(msgs[1].text()).toContain(tk('project.consumeOverStockPlain', { n: 2 }))
    expect(msgs[1].text()).not.toContain(tk('project.consumeOverStock', { n: 2 }))
    expect(msgs[1].text()).not.toContain('autres projets')
  })

  it('A/B : disponible 2 pour A (stock 5, B en réserve 3) : 5 tapé est ramené à 2, avec avertissement', async () => {
    const w = mountDialog({ open: true, yarns: [{ id: 1, name: 'Drops · Bleu', reserved: 2, available: 2 }] })
    const champ = w.find('.ycn__input')
    await champ.setValue(5)
    expect(champ.element.value).toBe('2')
    expect(w.find('.ycn__over').text()).toContain(tk('project.consumeOverStockPlain', { n: 2 }))
    expect(w.find('.ycn__over').text()).not.toContain(tk('project.consumeOverStock', { n: 2 }))
    await w.find('.ycn__confirm').trigger('click')
    expect(w.emitted('confirm')[0][0]).toEqual([{ id: 1, used: 2 }])
  })

  // Défaut en mode Terminé = min(réservé, disponible) : un champ pré-rempli au-dessus de la
  // borne afficherait une valeur que l'écriture tronquerait en silence.
  it('réservé au-dessus du disponible : le champ s’ouvre au disponible, avertissement et « Corriger le stock » déjà visibles', async () => {
    const w = mountDialog({ open: true, yarns: [{ id: 1, name: 'Drops · Bleu', reserved: 3, available: 2 }] })
    expect(w.find('.ycn__input').element.value).toBe('2')
    expect(w.find('.ycn__over').text()).toContain(tk('project.consumeOverStockPlain', { n: 2 }))
    expect(w.find('.ycn__over').text()).not.toContain(tk('project.consumeOverStock', { n: 2 }))
    expect(w.find('.ycn__fix').exists()).toBe(true)
    await w.find('.ycn__confirm').trigger('click')
    expect(w.emitted('confirm')[0][0]).toEqual([{ id: 1, used: 2 }])
  })

  it('disponible 0 : le champ s’ouvre à 0 avec l’avertissement, Valider envoie 0', async () => {
    const w = mountDialog({ open: true, yarns: [{ id: 1, name: 'Drops · Bleu', reserved: 2, available: 0 }] })
    expect(w.find('.ycn__input').element.value).toBe('0')
    expect(w.find('.ycn__over').text()).toContain(tk('project.consumeOverStockPlain', { n: 0 }))
    expect(w.find('.ycn__over').text()).not.toContain(tk('project.consumeOverStock', { n: 0 }))
    await w.find('.ycn__confirm').trigger('click')
    expect(w.emitted('confirm')[0][0]).toEqual([{ id: 1, used: 0 }])
  })

  it('l’avertissement posé à l’ouverture est réévalué à la réouverture (disponible redevenu suffisant)', async () => {
    const w = mountDialog({ open: true, yarns: [{ id: 1, name: 'Drops · Bleu', reserved: 3, available: 2 }] })
    expect(w.find('.ycn__over').exists()).toBe(true)
    await w.setProps({ open: false })
    await w.setProps({ open: true, yarns: [{ id: 1, name: 'Drops · Bleu', reserved: 3, available: 8 }] })
    expect(w.find('.ycn__input').element.value).toBe('3')
    expect(w.find('.ycn__over').exists()).toBe(false)
  })

  it('une saisie exactement égale au disponible n’affiche pas l’avertissement, au-dessus si', async () => {
    const w = mountDialog({ open: true, yarns: [{ id: 1, name: 'Drops · Bleu', reserved: 1, available: 4 }] })
    const champ = w.find('.ycn__input')
    await champ.setValue('4')
    expect(champ.element.value).toBe('4')
    expect(w.find('.ycn__over').exists()).toBe(false)
    await champ.setValue('4,5')
    expect(champ.element.value).toBe('4')
    expect(w.find('.ycn__over').exists()).toBe(true)
  })

  it('ouvert au-dessus de la borne puis la borne tapée : l’avertissement disparaît', async () => {
    const w = mountDialog({ open: true, yarns: [{ id: 1, name: 'Drops · Bleu', reserved: 3, available: 2 }] })
    await w.find('.ycn__input').setValue('2')
    expect(w.find('.ycn__over').exists()).toBe(false)
  })

  it('mode abandonné, réservé au-dessus du disponible : défaut 0, aucun avertissement à l’ouverture', () => {
    const w = mountDialog({ open: true, mode: 'abandoned', yarns: [{ id: 1, name: 'Bleu', reserved: 3, available: 2 }] })
    expect(w.find('.ycn__input').element.value).toBe('0')
    expect(w.find('.ycn__over').exists()).toBe(false)
  })

  // Un champ vidé efface l'avertissement (il ne dit plus rien de juste), mais n'est toujours
  // pas lu comme 0 : la dernière valeur bornée est gardée.
  it('champ vidé après un dépassement : l’avertissement disparaît, la valeur n’est pas lue comme 0', async () => {
    const w = mountDialog({ open: true, yarns })
    const champ = w.findAll('.ycn__input')[0]
    await champ.setValue(12)
    expect(w.find('.ycn__over').exists()).toBe(true)
    await champ.setValue('')
    expect(w.find('.ycn__over').exists()).toBe(false)
    await w.find('.ycn__confirm').trigger('click')
    expect(w.emitted('confirm')[0][0][0]).toEqual({ id: 1, used: 10 })
  })

  // Piège : champ vidé = jamais lu comme 0 (sinon un Valider rendrait toute la réserve au stock).
  it('un champ vidé n’est jamais lu comme 0 : la valeur courante est conservée', async () => {
    const w = mountDialog({ open: true, yarns })
    await w.findAll('.ycn__input')[0].setValue('')
    await w.find('.ycn__confirm').trigger('click')
    expect(w.emitted('confirm')[0][0][0]).toEqual({ id: 1, used: 3 })
  })

  // Un caractère refusé est retiré de l'affichage à la frappe, pas seulement de la valeur retenue.
  it('un caractère refusé est filtré de l’affichage à la frappe (« 2a » → « 2 », « -5 » → « 5 »)', async () => {
    const w = mountDialog({ open: true, yarns: [{ id: 1, name: 'Drops · Bleu', reserved: 30, available: 30 }] })
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

  it('le bouton Annuler (common.cancel) existe et émet cancel, jamais confirm', async () => {
    const w = mountDialog({ open: true, yarns })
    const btn = w.find('.ycn__cancel')
    expect(btn.text()).toBe(tk('common.cancel'))
    await btn.trigger('click')
    expect(w.emitted('cancel')).toHaveLength(1)
    expect(w.emitted('confirm')).toBeFalsy()
  })

  it('le voile émet cancel et PAS confirm', async () => {
    const w = mountDialog({ open: true, yarns })
    await w.find('.ycn__scrim').trigger('click')
    expect(w.emitted('cancel')).toHaveLength(1)
    expect(w.emitted('confirm')).toBeFalsy()
  })

  it('la croix émet cancel et PAS confirm', async () => {
    const w = mountDialog({ open: true, yarns })
    await w.find('.ycn__close').trigger('click')
    expect(w.emitted('cancel')).toHaveLength(1)
    expect(w.emitted('confirm')).toBeFalsy()
  })

  it('Échap émet cancel et PAS confirm (monté déjà ouvert)', () => {
    const w = mountDialog({ open: true, yarns })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('cancel')).toHaveLength(1)
    expect(w.emitted('confirm')).toBeFalsy()
    w.unmount()
  })

  it('la mention « le reste retourne au stock » est visible', () => {
    const w = mountDialog({ open: true, yarns })
    expect(w.text()).toContain(fr.project.consumeHint)
  })

  describe('mode « abandonné » (R3) : même dialogue, défaut inversé à 0', () => {
    it('mode abandonné : le champ est pré-rempli à 0 (par défaut on détricote, tout revient)', () => {
      const w = mountDialog({ open: true, mode: 'abandoned', yarns: [{ id: 1, name: 'Bleu', reserved: 3, available: 10 }] })
      expect(w.find('.ycn__input').element.value).toBe('0')
      expect(w.text()).toContain(fr.project.abandonTitle)
    })
    it('mode abandonné : fermer annule (aucun confirm), Valider sans rien toucher envoie 0', async () => {
      const w = mountDialog({ open: true, mode: 'abandoned', yarns: [{ id: 1, name: 'Bleu', reserved: 3, available: 10 }] })
      await w.find('.ycn__scrim').trigger('click')
      expect(w.emitted('cancel')).toHaveLength(1)
      expect(w.emitted('confirm')).toBeFalsy()
      await w.find('.ycn__confirm').trigger('click')
      expect(w.emitted('confirm')[0][0]).toEqual([{ id: 1, used: 0 }])
    })
    it('mode terminé : inchangé, pré-rempli au réservé', () => {
      const w = mountDialog({ open: true, mode: 'done', yarns: [{ id: 1, name: 'Bleu', reserved: 3, available: 10 }] })
      expect(w.find('.ycn__input').element.value).toBe('3')
      expect(w.text()).toContain(fr.project.consumeTitle)
    })
  })
})
