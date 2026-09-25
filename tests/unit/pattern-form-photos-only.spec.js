// @vitest-environment jsdom
// Fusion Photos/Galerie (22/09/2026) : PatternForm.vue n'a plus qu'UNE section d'images,
// intitulée « Photos », mais qui pilote `pattern.gallery` (pas `pattern.photos`) — c'est
// désormais le seul moyen, pour un patron créé manuellement (sans PDF, sans reader), de
// peupler une galerie non vide, dont dépend le bouton Prévisualiser de PatternView.vue
// (cf. commit f3fa17bf : `pattern.reader?.sections?.length || pattern.gallery?.length`).
// `pattern.photos` (couverture PDF importée) n'est donc plus éditable depuis ce formulaire
// du tout : ce test vérifie qu'elle survit intacte à un submit (elle continue d'être
// affichée en lecture seule sur la fiche, cf. PatternView.vue, section .pphotos).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import i18n from '@/i18n'
import PatternForm from '@/components/PatternForm.vue'
import { makeTk } from './helpers/i18n-router'

const tk = makeTk(i18n)

const pickImageMock = vi.hoisted(() => vi.fn())
vi.mock('@/utils/photo', () => ({
  pickImage: (...args) => pickImageMock(...args),
}))

const cropMock = vi.hoisted(() => vi.fn())
vi.mock('@/stores/cropper', () => ({ useCropperStore: () => ({ crop: cropMock }) }))

// PatternForm importe PdfPagePickerDialog → PdfViewer → @/utils/pdf (pdfjs-dist), qui
// utilise DOMMatrix, absent de jsdom — même mock que pattern-form-gallery.spec.js
// (avant sa fusion dans ce fichier).
vi.mock('@/utils/pdf', () => ({
  renderPdfPageToDataUrl: vi.fn().mockResolvedValue('data:image/jpeg;base64,PAGE'),
  pdfPageCount: vi.fn().mockResolvedValue(1),
}))

function makeInitial(gallery = [], photos = []) {
  return {
    name: 'SABAI',
    type: 'knitting',
    category: 'clothing',
    sizes: [],
    photos,
    gallery,
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

describe('PatternForm — une seule section « Photos », pilotée par gallery', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    pickImageMock.mockReset()
  })

  it('affiche « Photos » comme unique intitulé ; pas de section « Galerie du patron », pas de .photorow', () => {
    const w = mountForm()
    expect(w.find('.galleryrow').exists()).toBe(true)
    expect(w.find('.photorow').exists()).toBe(false)
    expect(w.text()).toContain('Photos')
    expect(w.text()).not.toContain('Galerie du patron')
  })

  it('affiche une vignette par image déjà présente dans gallery', () => {
    const w = mountForm(makeInitial([{ src: 'data:image/png;base64,A', page: 1, w: 10, h: 10 }]))
    expect(w.find('.galleryrow__img').exists()).toBe(true)
  })

  it('ajoute une image via pickImage (pas de recadrage) : nouvelle vignette, page:0', async () => {
    pickImageMock.mockResolvedValue('data:image/png;base64,NEW')
    const w = mountForm()
    await w.find('.galleryrow__add').trigger('click')
    await flushPromises()
    expect(w.findAll('.galleryrow__img')).toHaveLength(1)
    expect(pickImageMock).toHaveBeenCalled()
  })

  it('annulation de pickImage (null) : aucune vignette ajoutée', async () => {
    pickImageMock.mockResolvedValue(null)
    const w = mountForm()
    await w.find('.galleryrow__add').trigger('click')
    await flushPromises()
    expect(w.findAll('.galleryrow__img')).toHaveLength(0)
  })

  it('supprime une image', async () => {
    const w = mountForm(makeInitial([
      { src: 'data:image/png;base64,A', page: 1, w: 10, h: 10 },
      { src: 'data:image/png;base64,B', page: 2, w: 10, h: 10 },
    ]))
    await w.find('.galleryrow__del').trigger('click')
    await flushPromises()
    expect(w.findAll('.galleryrow__img')).toHaveLength(1)
    expect(w.find('.galleryrow__img').attributes('src')).toBe('data:image/png;base64,B')
  })

  it('le bouton d’ajout porte l’aria-label « Ajouter une photo »', () => {
    const w = mountForm(makeInitial([]))
    expect(w.findAll('.galleryrow__add')).toHaveLength(1)
    expect(w.find('[aria-label="Ajouter une photo"]').exists()).toBe(true)
    expect(w.find('[aria-label="Ajouter une image"]').exists()).toBe(false)
  })

  it('choix "extra" (4e bouton de la feuille) ouvre le picker PDF quand le patron a un PDF stocké', async () => {
    pickImageMock.mockResolvedValue('extra')
    const initial = makeInitial([])
    initial.pdf = 'data:application/pdf;base64,AAAA'
    const w = mountForm(initial)
    await w.find('.galleryrow__add').trigger('click')
    await flushPromises()
    expect(pickImageMock).toHaveBeenCalledWith(tk('patternExtras.addImagePdf'))
    await vi.waitFor(() => expect(w.find('.ppd').exists()).toBe(true), { timeout: 10000 })
    expect(w.findComponent({ name: 'PdfPagePickerDialog' }).props('open')).toBe(true)
  })

  it('sans PDF sur le patron, pickImage est appelé avec null (pas de 4e bouton demandé)', async () => {
    pickImageMock.mockResolvedValue(null)
    const w = mountForm(makeInitial([]))
    await w.find('.galleryrow__add').trigger('click')
    await flushPromises()
    expect(pickImageMock).toHaveBeenCalledWith(null)
  })

  it('sélection d’une page PDF enchaîne sur le recadrage puis ajoute l’image recadrée', async () => {
    pickImageMock.mockResolvedValue('extra')
    cropMock.mockResolvedValue('data:image/jpeg;base64,CROPPED')
    const initial = makeInitial([])
    initial.pdf = 'data:application/pdf;base64,AAAA'
    const w = mountForm(initial)
    await w.find('.galleryrow__add').trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(w.find('.ppd').exists()).toBe(true), { timeout: 10000 })
    await w.findComponent({ name: 'PdfPagePickerDialog' }).vm.$emit('pick', 'data:image/jpeg;base64,PAGE')
    await flushPromises()
    expect(cropMock).toHaveBeenCalledWith('data:image/jpeg;base64,PAGE')
    expect(w.findAll('.galleryrow__img').at(-1).attributes('src')).toBe('data:image/jpeg;base64,CROPPED')
  })

  it('annuler le recadrage (crop résout null) n’ajoute rien', async () => {
    pickImageMock.mockResolvedValue('extra')
    cropMock.mockResolvedValue(null)
    const initial = makeInitial([])
    initial.pdf = 'data:application/pdf;base64,AAAA'
    const w = mountForm(initial)
    await w.find('.galleryrow__add').trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(w.find('.ppd').exists()).toBe(true), { timeout: 10000 })
    await w.findComponent({ name: 'PdfPagePickerDialog' }).vm.$emit('pick', 'data:image/jpeg;base64,PAGE')
    await flushPromises()
    expect(w.findAll('.galleryrow__img')).toHaveLength(0)
  })

  it('la galerie part intacte dans le payload submit, avec l’image ajoutée', async () => {
    pickImageMock.mockResolvedValue('data:image/png;base64,NEW')
    const w = mountForm(makeInitial([{ src: 'data:image/png;base64,A', page: 1, w: 10, h: 10 }]))
    await w.find('.galleryrow__add').trigger('click')
    await flushPromises()
    await w.find('.addform__actions .btn--primary').trigger('click')
    const payload = w.emitted('submit')[0][0]
    expect(payload.gallery).toEqual([
      { src: 'data:image/png;base64,A', page: 1, w: 10, h: 10 },
      { src: 'data:image/png;base64,NEW', page: 0, w: 0, h: 0 },
    ])
  })

  it('un patron importé garde sa couverture (pattern.photos) : jamais éditée ici, donc jamais renvoyée au submit', async () => {
    const w = mountForm(makeInitial([], ['data:image/jpeg;base64,COVER']))
    await w.find('.addform__actions .btn--primary').trigger('click')
    await flushPromises()
    const payload = w.emitted('submit')[0][0]
    expect('photos' in payload).toBe(false)
  })
})
