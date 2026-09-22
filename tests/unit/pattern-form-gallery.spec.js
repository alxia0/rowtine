// Galerie du patron (pattern.gallery) dans PatternForm.vue : ajout/suppression SEULEMENT
// (pas de transformation en diagramme ici — ce formulaire ne connaît pas `reader`).
// Même geste que
// form.photos (push/splice), validé au submit du formulaire — pas de mécanisme de
// pending séparé. `pickImage` (PAS pickAndCropImage) : une image de galerie est souvent
// un schéma technique, un recadrage imposé risquerait de couper une maille ou une légende.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import i18n from '@/i18n'
import PatternForm from '@/components/PatternForm.vue'

// vi.hoisted OBLIGATOIRE ici : vi.mock est hoisté par Vitest au-dessus du reste du
// fichier, donc une simple `const pickImageMock = vi.fn()` non hoistée serait encore en
// zone morte temporelle quand la factory du mock s'exécute (même piège documenté dans
// CorrectionView.spec.js pour `nav`/`vue-router`).
const pickImageMock = vi.hoisted(() => vi.fn())
vi.mock('@/utils/photo', () => ({
  pickAndCropImage: vi.fn().mockResolvedValue(null),
  pickImage: (...args) => pickImageMock(...args),
}))

const cropMock = vi.hoisted(() => vi.fn())
vi.mock('@/stores/cropper', () => ({ useCropperStore: () => ({ crop: cropMock }) }))

// PatternForm importe désormais PdfPagePickerDialog → PdfViewer → @/utils/pdf (pdfjs-dist),
// qui utilise `DOMMatrix`, absent de jsdom. Même mock que pdf-viewer.spec.js et
// pdf-page-picker-dialog.spec.js : évite de charger pdfjs-dist pour de vrai dans CE fichier,
// qui ne teste jamais le rendu PDF lui-même (seulement le câblage crop après `pick`).
vi.mock('@/utils/pdf', () => ({
  renderPdfPageToDataUrl: vi.fn().mockResolvedValue('data:image/jpeg;base64,PAGE'),
  pdfPageCount: vi.fn().mockResolvedValue(1),
}))

function makeInitial(gallery = []) {
  return {
    name: 'SABAI',
    type: 'knitting',
    category: 'clothing',
    sizes: [],
    sections: [],
    photos: [],
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

describe('PatternForm — galerie du patron (ajout/suppression)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    pickImageMock.mockReset()
  })

  it('affiche une vignette par image de galerie déjà présente', () => {
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

  it('supprime une image de galerie', async () => {
    const w = mountForm(makeInitial([
      { src: 'data:image/png;base64,A', page: 1, w: 10, h: 10 },
      { src: 'data:image/png;base64,B', page: 2, w: 10, h: 10 },
    ]))
    await w.find('.galleryrow__del').trigger('click')
    await flushPromises()
    expect(w.findAll('.galleryrow__img')).toHaveLength(1)
    expect(w.find('.galleryrow__img').attributes('src')).toBe('data:image/png;base64,B')
  })

  it('la galerie part intacte dans le payload submit, avec l\'image ajoutée', async () => {
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

  it('un seul bouton d\'ajout (feuille standard, plus de "Parcourir les fichiers")', () => {
    const w = mountForm(makeInitial([]))
    expect(w.findAll('.galleryrow__add')).toHaveLength(1)
    expect(w.find('[aria-label="Ajouter une image"]').exists()).toBe(true)
    expect(w.find('[aria-label="Parcourir les fichiers"]').exists()).toBe(false)
  })

  it('choix "extra" (4e bouton de la feuille) ouvre le picker PDF quand le patron a un PDF stocké', async () => {
    pickImageMock.mockResolvedValue('extra')
    const initial = makeInitial([])
    initial.pdf = 'data:application/pdf;base64,AAAA'
    const w = mountForm(initial)
    await w.find('.galleryrow__add').trigger('click')
    await flushPromises()
    expect(pickImageMock).toHaveBeenCalledWith('Depuis le PDF du patron')
    // PdfPagePickerDialog est chargé en asynchrone (defineAsyncComponent, cf. PatternForm.vue) :
    // la résolution passe par la vraie transformation Vite du module, pas seulement par des
    // microtâches — un nombre fixe de flushPromises() est insuffisant à froid (mesuré : encore
    // non résolu après 10 flushes). vi.waitFor() sonde jusqu'à résolution (même pattern que
    // CorrectionView.spec.js pour un autre type d'attente asynchrone).
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

  it('sélection d\'une page PDF (via la feuille standard) enchaîne sur le recadrage puis ajoute l\'image recadrée', async () => {
    pickImageMock.mockResolvedValue('extra')
    cropMock.mockResolvedValue('data:image/jpeg;base64,CROPPED')
    const initial = makeInitial([])
    initial.pdf = 'data:application/pdf;base64,AAAA'
    const w = mountForm(initial)
    await w.find('.galleryrow__add').trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(w.find('.ppd').exists()).toBe(true), { timeout: 10000 }) // résolution du composant async
    await w.findComponent({ name: 'PdfPagePickerDialog' }).vm.$emit('pick', 'data:image/jpeg;base64,PAGE')
    await flushPromises()
    expect(cropMock).toHaveBeenCalledWith('data:image/jpeg;base64,PAGE')
    expect(w.findAll('.galleryrow__img').at(-1).attributes('src')).toBe('data:image/jpeg;base64,CROPPED')
  })

  it('annuler le recadrage (crop résout null) n\'ajoute rien', async () => {
    pickImageMock.mockResolvedValue('extra')
    cropMock.mockResolvedValue(null)
    const initial = makeInitial([])
    initial.pdf = 'data:application/pdf;base64,AAAA'
    const w = mountForm(initial)
    await w.find('.galleryrow__add').trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(w.find('.ppd').exists()).toBe(true), { timeout: 10000 }) // résolution du composant async
    await w.findComponent({ name: 'PdfPagePickerDialog' }).vm.$emit('pick', 'data:image/jpeg;base64,PAGE')
    await flushPromises()
    expect(w.findAll('.galleryrow__img')).toHaveLength(0)
  })
})
