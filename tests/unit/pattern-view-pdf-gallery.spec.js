// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import fr from '@/i18n/fr.json'
import PatternGallery from '@/components/PatternGallery.vue'
import { useLightboxStore } from '@/stores/lightbox'
import { createTestI18n, makeTk } from './helpers/i18n-router'

const i18n = createTestI18n()

const tk = makeTk(i18n)

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('PatternGallery', () => {
  it('affiche une vignette par image', () => {
    const images = [{ src: 'data:image/png;base64,A', page: 1, w: 200, h: 200 }, { src: 'data:image/png;base64,B', page: 2, w: 200, h: 200 }]
    const w = mount(PatternGallery, { props: { images }, global: { plugins: [i18n], stubs: { AppIcon: true } } })
    expect(w.findAll('img')).toHaveLength(2)
  })
  it('vide → rien', () => {
    const w = mount(PatternGallery, { props: { images: [] }, global: { plugins: [i18n], stubs: { AppIcon: true } } })
    expect(w.findAll('img')).toHaveLength(0)
  })

  it('image sans page PDF (page: 0, ajoutée manuellement) : alt générique, pas "p. 0"', () => {
    const images = [{ src: 'data:image/png;base64,A', page: 0, w: 0, h: 0 }]
    const w = mount(PatternGallery, { props: { images }, global: { plugins: [i18n], stubs: { AppIcon: true } } })
    expect(w.find('img').attributes('alt')).toBe(fr.patternExtras.addedImage)
  })

  it('image issue d\'une page PDF (page > 0) : alt inchangé, "p. {n}"', () => {
    const images = [{ src: 'data:image/png;base64,A', page: 3, w: 200, h: 200 }]
    const w = mount(PatternGallery, { props: { images }, global: { plugins: [i18n], stubs: { AppIcon: true } } })
    expect(w.find('img').attributes('alt')).toBe(tk('patternExtras.fromPage', { n: 3 }))
  })

  describe('étoile de couverture (Task 4)', () => {
    const images = [{ src: 'data:image/png;base64,A', page: 0, w: 0, h: 0 }, { src: 'data:image/png;base64,B', page: 0, w: 0, h: 0 }]

    it('editable=false (défaut) : ni étoile ni badge', () => {
      const w = mount(PatternGallery, { props: { images }, global: { plugins: [i18n], stubs: { AppIcon: true } } })
      expect(w.find('.pthumb__cover').exists()).toBe(false)
      expect(w.find('.pthumb__badge').exists()).toBe(false)
    })

    it('editable=true : badge sur coverIndex, étoile sur les autres vignettes', () => {
      const w = mount(PatternGallery, { props: { images, editable: true, coverIndex: 1 }, global: { plugins: [i18n], stubs: { AppIcon: true } } })
      const cells = w.findAll('.pgal__cell')
      expect(cells[0].find('.pthumb__cover').exists()).toBe(true)
      expect(cells[0].find('.pthumb__badge').exists()).toBe(false)
      expect(cells[1].find('.pthumb__cover').exists()).toBe(false)
      expect(cells[1].find('.pthumb__badge').exists()).toBe(true)
    })

    it('clic sur l\'étoile émet set-cover avec l\'index, sans déclencher la lightbox (click.stop)', async () => {
      const w = mount(PatternGallery, { props: { images, editable: true, coverIndex: 0 }, global: { plugins: [i18n], stubs: { AppIcon: true } } })
      const lightbox = useLightboxStore()
      const showSpy = vi.spyOn(lightbox, 'show')
      await w.findAll('.pgal__cell')[1].find('.pthumb__cover').trigger('click')
      expect(w.emitted('set-cover')).toEqual([[1]])
      expect(showSpy).not.toHaveBeenCalled()
    })

    it('l\'ouverture de la lightbox reste sur .pthumb__open, inchangée (comportement identique, editable ou non)', async () => {
      const w = mount(PatternGallery, { props: { images, editable: true, coverIndex: 0 }, global: { plugins: [i18n], stubs: { AppIcon: true } } })
      const lightbox = useLightboxStore()
      const showSpy = vi.spyOn(lightbox, 'show')
      expect(w.findAll('.pthumb__open')).toHaveLength(2)

      await w.findAll('.pthumb__open')[1].trigger('click')
      expect(showSpy).toHaveBeenCalledWith(['data:image/png;base64,A', 'data:image/png;base64,B'], 1)
    })
  })
})
