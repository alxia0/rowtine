// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import fr from '@/i18n/fr.json'
import PatternGallery from '@/components/PatternGallery.vue'
import ProjectPdfGallery from '@/components/ProjectPdfGallery.vue'
import { createTestI18n } from './helpers/i18n-router'

const i18n = createTestI18n()

describe('galerie extraite côté projet', () => {
  it('PatternGallery rend les images de l’instance (réutilisé tel quel)', () => {
    const w = mount(PatternGallery, { props: { images: [{ src: 'data:image/png;base64,A', page: 1, w: 200, h: 200 }] }, global: { plugins: [i18n], stubs: { AppIcon: true } } })
    expect(w.findAll('img')).toHaveLength(1)
  })
})

describe('ProjectPdfGallery', () => {
  const mountIt = (props) => mount(ProjectPdfGallery, { props, global: { plugins: [i18n], stubs: { AppIcon: true, PdfViewer: true } } })

  it('sans pdf ni galerie → rien', () => {
    const w = mountIt({ pdf: '', gallery: [] })
    expect(w.text()).toBe('')
  })

  it('avec galerie → intitulé « extraites du patron » + images (PatternGallery réutilisé)', () => {
    const w = mountIt({ pdf: '', gallery: [{ src: 'data:image/png;base64,A', page: 1, w: 200, h: 200 }] })
    expect(w.text()).toContain(fr.patternExtras.fromPatternLabel)
    expect(w.findAll('img')).toHaveLength(1)
  })

  it('avec pdf → boutons Aperçu et Ouvrir', () => {
    const w = mountIt({ pdf: 'data:application/pdf;base64,AAAA', gallery: [] })
    expect(w.text()).toContain(fr.patternExtras.preview)
    expect(w.text()).toContain(fr.patternExtras.openExternal)
  })
})
