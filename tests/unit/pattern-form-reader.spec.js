// @vitest-environment jsdom
// Task D2 — retrait de l'éditeur texte (ReaderMdEditor) du crayon PatternForm.
// L'écran de correction post-import (CorrectionView) remplace désormais cette
// capacité (édition zone-de-texte du reader) : PatternForm ne doit plus exposer
// aucun bloc d'édition du reader, seulement les infos patron (nom, type,
// catégorie, tailles, aiguilles, échantillon, source, auteur, photos). Le reader
// existant d'un patron (import, ou saisi via l'écran de correction) doit
// survivre intact au submit : jamais reconstruit ni renvoyé (seuls les champs
// modifiés partent), la fusion de `patternsStore.update` le garde en base.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import i18n from '@/i18n'
import { makeTk } from './helpers/i18n-router'
import PatternForm from '@/components/PatternForm.vue'
import { buildReference } from '@/utils/reader-reference'

const tk = makeTk(i18n)

// pickAndCropImage n'a pas besoin de fonctionner dans ce test.
vi.mock('@/utils/photo', () => ({ pickAndCropImage: vi.fn().mockResolvedValue(null) }))

function makeReference() {
  return buildReference({ needles: '4.5 mm', gauge: '20 m sur 28 rangs' })
}

function makeInitial() {
  return {
    name: 'SABAI',
    type: 'knitting',
    category: 'clothing',
    sizes: ['S', 'M'],
    sections: [],
    reader: {
      sizeLabels: ['S', 'M'],
      sections: [{ id: 'corps', kind: 'corps', title: 'Corps', steps: [{ t: 'Monter 80 mailles' }] }],
      reference: makeReference(),
    },
    photos: [],
    source: '',
    author: '',
    authorUrl: '',
    categoryCustom: '',
  }
}

function mountForm(initial = makeInitial()) {
  return mount(PatternForm, {
    props: { initial, submitLabel: 'Enregistrer' },
    global: { plugins: [createPinia(), i18n] },
  })
}

describe('PatternForm — retrait de l\'éditeur texte (Task D2)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('n\'affiche plus aucun bloc éditeur MD (textarea, onglets Éditer/Aperçu, insertion image)', () => {
    const wrapper = mountForm()
    expect(wrapper.find('.rmd-textarea').exists()).toBe(false)
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false)
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(0)
    const buttonTexts = wrapper.findAll('button').map((b) => b.text())
    expect(buttonTexts.some((t) => t.includes('Éditer'))).toBe(false)
    expect(buttonTexts.some((t) => t.includes(tk('patternExtras.preview')))).toBe(false)
    expect(buttonTexts.some((t) => t.includes('Insérer une image'))).toBe(false)
  })

  it('conserve les champs infos patron (nom, type, tailles, aiguilles, échantillon, source, auteur, photos)', () => {
    const wrapper = mountForm()
    expect(wrapper.find('#pat-name').exists()).toBe(true)
    expect(wrapper.find('#pat-nmm').exists()).toBe(true) // aiguilles/crochet mm
    expect(wrapper.find('#pat-nus').exists()).toBe(true) // aiguilles/crochet US
    expect(wrapper.find('#pat-gs').exists()).toBe(true) // échantillon mailles
    expect(wrapper.find('#pat-gr').exists()).toBe(true) // échantillon rangs
    expect(wrapper.find('input[placeholder="S, M, L"]').element.value).toBe('S, M')
    expect(wrapper.find('.galleryrow__add').exists()).toBe(true)
  })

  it('submit ne renvoie pas le reader (jamais reconstruit ; la fusion de patternsStore.update le garde en base)', async () => {
    const initial = makeInitial()
    const wrapper = mountForm(initial)
    await flushPromises()

    await wrapper.find('.addform__actions .btn--primary').trigger('click')
    await flushPromises()

    const emitted = wrapper.emitted('submit')
    expect(emitted).toBeTruthy()
    const payload = emitted[0][0]

    expect('reader' in payload).toBe(false)
  })

  // Protège : l'édition n'écrase pas ce qu'une synchro patron.md a fusionné en base pendant que le formulaire était ouvert.
  it('édition : seuls les champs modifiés partent (reader, galerie, tailles restent ceux de la base)', async () => {
    const initial = { ...makeInitial(), gallery: [{ src: 'data:image/png;base64,A', page: 1, w: 1, h: 1 }] }
    const wrapper = mountForm(initial)
    await flushPromises()
    await wrapper.find('#pat-name').setValue('SABAI (relu)')

    await wrapper.find('.addform__actions .btn--primary').trigger('click')
    await flushPromises()

    const payload = wrapper.emitted('submit')[0][0]
    expect(payload.name).toBe('SABAI (relu)')
    expect('reader' in payload).toBe(false)
    expect('gallery' in payload).toBe(false)
    expect('sizes' in payload).toBe(false)
  })

  it('reader absent dans initial → submit n\'invente aucun reader (pas de reconstruction par défaut)', async () => {
    const initial = { ...makeInitial(), reader: undefined }
    const wrapper = mountForm(initial)
    await flushPromises()

    await wrapper.find('.addform__actions .btn--primary').trigger('click')
    await flushPromises()

    const emitted = wrapper.emitted('submit')
    const payload = emitted[0][0]

    expect(payload.reader).toBeUndefined()
  })
})
