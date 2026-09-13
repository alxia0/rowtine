// Task D2 — retrait de l'éditeur texte (ReaderMdEditor) du crayon PatternForm.
// L'écran de correction post-import (CorrectionView) remplace désormais cette
// capacité (édition zone-de-texte du reader) : PatternForm ne doit plus exposer
// aucun bloc d'édition du reader, seulement les infos patron (nom, type,
// catégorie, tailles, aiguilles, échantillon, source, auteur, photos). Le reader
// existant d'un patron (import, ou saisi via l'écran de correction) doit
// survivre intact au submit, porté par le spread `initial` (form = {...seed}),
// sans normalisation ni reconstruction.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import i18n from '@/i18n'
import PatternForm from '@/components/PatternForm.vue'
import { buildReference } from '@/utils/reader-reference'

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
    expect(buttonTexts.some((t) => t.includes('Aperçu'))).toBe(false)
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
    expect(wrapper.find('.photorow__add').exists()).toBe(true)
  })

  it('submit émet le patron avec reader.sections/sizeLabels/reference intacts (portés par initial, jamais reconstruits)', async () => {
    const initial = makeInitial()
    const wrapper = mountForm(initial)
    await flushPromises()

    await wrapper.find('.addform__actions .btn--primary').trigger('click')
    await flushPromises()

    const emitted = wrapper.emitted('submit')
    expect(emitted).toBeTruthy()
    const payload = emitted[0][0]

    expect(payload.reader).toEqual(initial.reader)
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
