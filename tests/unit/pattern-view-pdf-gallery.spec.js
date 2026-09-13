import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import PatternGallery from '@/components/PatternGallery.vue'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })

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
    expect(w.find('img').attributes('alt')).toBe('p. 3')
  })
})
