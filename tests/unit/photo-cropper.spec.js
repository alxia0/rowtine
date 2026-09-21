// Unitaire — LE RECADEUR IN-APP (PhotoCropper.vue). Cible le durcissement du 04/09/2026 :
// confirm() peint un fond blanc AVANT drawImage, même règle que resizeDataUrl
// (image-resize.js) et cropCanvas (pdf.js). Ce remplissage protège tout chemin où une
// image à alpha peut atteindre le recadeur (page PDF aujourd'hui, future version du plugin
// caméra, tout futur chemin qui recadrerait une image à alpha). Il ne guérit pas le défaut mesuré ce jour-là sur appareil (Huawei,
// photo de laine : JPEG fond noir dès la sortie du plugin natif — LegacyCameraFlow
// ré-encode tout en JPEG opaque côté natif, l'alpha y est déjà perdue) : ce chemin-là
// attend une sortie côté natif ou un changement de flux galerie (arbitrage en cours).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import PhotoCropper from '@/components/PhotoCropper.vue'
import { useCropperStore } from '@/stores/cropper'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })

// Même technique que image-resize.spec.js : createElement espionné qui ne remplace QUE
// le canvas — le rendu Vue doit continuer à créer ses vrais éléments DOM.
const realCreateElement = document.createElement.bind(document)

function stubCanvas() {
  const calls = []
  const ctx = {
    fillStyle: '#000',
    fillRect(...a) { calls.push(['fillRect', ctx.fillStyle, ...a]) },
    drawImage(...a) { calls.push(['drawImage', ...a]) },
  }
  const fake = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toDataURL(mime, quality) {
      calls.push(['toDataURL', mime, quality])
      return 'data:image/jpeg;base64,ZZ'
    },
  }
  vi.spyOn(document, 'createElement').mockImplementation((tag, ...rest) =>
    tag === 'canvas' ? fake : realCreateElement(tag, ...rest),
  )
  return { fake, calls }
}

afterEach(() => vi.restoreAllMocks())

describe('PhotoCropper.confirm() — fond blanc avant recadrage', () => {
  it('peint #fff sur tout le canvas AVANT drawImage, puis ré-encode en JPEG', async () => {
    const { fake, calls } = stubCanvas()
    const pinia = createPinia()
    setActivePinia(pinia)
    const cropper = useCropperStore()
    const wrapper = mount(PhotoCropper, { global: { plugins: [i18n, pinia] } })

    const settled = cropper.crop('data:image/png;base64,AA==')
    await flushPromises()

    // Dimensions « naturelles » de l'image et de la scène : jsdom ne décode rien et
    // clientWidth vaut 0 — on les fixe sur les instances (computeLayout en dépend).
    const img = wrapper.find('img.cr__img').element
    Object.defineProperty(img, 'naturalWidth', { value: 1280, configurable: true })
    Object.defineProperty(img, 'naturalHeight', { value: 1280, configurable: true })
    const stage = wrapper.find('.cr__stage').element
    Object.defineProperty(stage, 'clientWidth', { value: 1080, configurable: true })
    Object.defineProperty(stage, 'clientHeight', { value: 2100, configurable: true })
    await wrapper.find('img.cr__img').trigger('load')
    await flushPromises()

    // Scène 1080×2100, image carrée → affichée 1080×1080 ; cadre par défaut à 80 %
    // → 864 px affichés, ×(1280/1080) en pixels source = 1024 — la géométrie mesurée
    // sur l'appareil le 04/09.
    await wrapper.findAll('button').filter((b) => b.text() === 'Recadrer').at(0).trigger('click')
    await expect(settled).resolves.toBe('data:image/jpeg;base64,ZZ')

    expect(fake.width).toBe(1024)
    expect(fake.height).toBe(1024)
    const fill = calls.findIndex((c) => c[0] === 'fillRect')
    const draw = calls.findIndex((c) => c[0] === 'drawImage')
    expect(fill).toBeGreaterThanOrEqual(0)
    expect(draw).toBeGreaterThan(fill)
    expect(calls[fill]).toEqual(['fillRect', '#fff', 0, 0, 1024, 1024])
    expect(calls).toContainEqual(['toDataURL', 'image/jpeg', 0.85])
  })

  it('annuler ne touche aucun canvas et résout à null', async () => {
    const { calls } = stubCanvas()
    const pinia = createPinia()
    setActivePinia(pinia)
    const cropper = useCropperStore()
    const wrapper = mount(PhotoCropper, { global: { plugins: [i18n, pinia] } })

    const settled = cropper.crop('data:image/png;base64,AA==')
    await flushPromises()
    await wrapper.findAll('button').filter((b) => b.text() === 'Annuler').at(0).trigger('click')
    await expect(settled).resolves.toBeNull()
    expect(calls).toEqual([])
  })
})

describe('PhotoCropper — ratio imposé (badge)', () => {
  it('initialise le cadre au ratio demandé, centré', async () => {
    const { fake, calls } = stubCanvas()
    const pinia = createPinia()
    setActivePinia(pinia)
    const cropper = useCropperStore()
    const wrapper = mount(PhotoCropper, { global: { plugins: [i18n, pinia] } })

    const settled = cropper.crop('data:image/png;base64,AA==', 4 / 3)
    await flushPromises()

    const img = wrapper.find('img.cr__img').element
    Object.defineProperty(img, 'naturalWidth', { value: 1280, configurable: true })
    Object.defineProperty(img, 'naturalHeight', { value: 1280, configurable: true })
    const stage = wrapper.find('.cr__stage').element
    Object.defineProperty(stage, 'clientWidth', { value: 1080, configurable: true })
    Object.defineProperty(stage, 'clientHeight', { value: 2100, configurable: true })
    await wrapper.find('img.cr__img').trigger('load')
    await flushPromises()

    // Même scène que le test « fond blanc » ci-dessus (image carrée 1280², scène 1080×2100 →
    // affichage 1080×1080 centré à y=510) mais avec un ratio 4:3 imposé : le cadre initial
    // fait 1080×810, centré verticalement dans le carré affiché (y = 510 + (1080-810)/2 = 645).
    const frame = wrapper.find('.cr__frame').element
    expect(frame.style.width).toBe('1080px')
    expect(frame.style.height).toBe('810px')
    expect(frame.style.left).toBe('0px')
    expect(frame.style.top).toBe('645px')

    await wrapper.findAll('button').filter((b) => b.text() === 'Recadrer').at(0).trigger('click')
    await expect(settled).resolves.toBe('data:image/jpeg;base64,ZZ')
    // Sortie au ratio 4:3 (1280×960), preuve que le ratio a survécu jusqu'au canvas final.
    expect(calls).toContainEqual(['toDataURL', 'image/jpeg', 0.85])
    expect(fake.width).toBe(1280)
    expect(fake.height).toBe(960)
  })

  it('sans ratio, le comportement libre existant est inchangé', async () => {
    const { calls } = stubCanvas()
    const pinia = createPinia()
    setActivePinia(pinia)
    const cropper = useCropperStore()
    const wrapper = mount(PhotoCropper, { global: { plugins: [i18n, pinia] } })

    cropper.crop('data:image/png;base64,AA==')
    await flushPromises()
    const img = wrapper.find('img.cr__img').element
    Object.defineProperty(img, 'naturalWidth', { value: 1280, configurable: true })
    Object.defineProperty(img, 'naturalHeight', { value: 1280, configurable: true })
    const stage = wrapper.find('.cr__stage').element
    Object.defineProperty(stage, 'clientWidth', { value: 1080, configurable: true })
    Object.defineProperty(stage, 'clientHeight', { value: 2100, configurable: true })
    await wrapper.find('img.cr__img').trigger('load')
    await flushPromises()

    const frame = wrapper.find('.cr__frame').element
    // Cadre libre par défaut, 80 % centré (inchangé depuis avant ce lot).
    expect(frame.style.width).toBe('864px')
    expect(frame.style.height).toBe('864px')
    expect(calls).toEqual([])
  })
})
