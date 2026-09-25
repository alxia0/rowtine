// @vitest-environment jsdom
// SkeletonScreen — squelette de chargement réutilisable (présentationnel pur).
// Couvre : structure par variant + annonce accessible (role="status" + libellé
// visuellement masqué), seule preuve automatisée que l'état de chargement reste
// perceptible pour un lecteur d'écran (le squelette lui-même est décoratif).
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SkeletonScreen from '@/components/SkeletonScreen.vue'
import { createTestI18n, makeTk } from './helpers/i18n-router'

const i18n = createTestI18n()

const tk = makeTk(i18n)
const mountIt = (props) => mount(SkeletonScreen, { props, global: { plugins: [i18n] } })

describe('SkeletonScreen', () => {
  it('variant reader : racine aria-busy, annonce accessible, blocs attendus', () => {
    const w = mountIt({ variant: 'reader' })
    expect(w.attributes('aria-busy')).toBe('true')
    expect(w.classes()).toContain('skel')

    const status = w.find('[role="status"]')
    expect(status.exists()).toBe(true)
    expect(status.text()).toBe(tk('reader.loading'))

    // Barre de titre, ligne eyebrow, rangée de pastilles, 2 blocs de section.
    expect(w.find('.skel__bar').exists()).toBe(true)
    expect(w.find('.skel__line--short').exists()).toBe(true)
    expect(w.find('.skel__tabs').exists()).toBe(true)
    expect(w.findAll('.skel__block')).toHaveLength(2)
  })

  it('variant detail (défaut) : structure de l’ancien squelette', () => {
    const w = mountIt()
    expect(w.attributes('aria-busy')).toBe('true')

    const status = w.find('[role="status"]')
    expect(status.exists()).toBe(true)
    expect(status.text()).toBe(tk('reader.loading'))

    expect(w.find('.skel__bar').exists()).toBe(true)
    expect(w.find('.skel__tabs').exists()).toBe(true)
    expect(w.find('.skel__line').exists()).toBe(true)
    expect(w.find('.skel__line--short').exists()).toBe(true)
    expect(w.findAll('.skel__block')).toHaveLength(1)
  })
})
