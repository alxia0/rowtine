// SkeletonScreen — squelette de chargement réutilisable (présentationnel pur).
// Couvre : structure par variant + annonce accessible (role="status" + libellé
// visuellement masqué), seule preuve automatisée que l'état de chargement reste
// perceptible pour un lecteur d'écran (le squelette lui-même est décoratif).
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import SkeletonScreen from '@/components/SkeletonScreen.vue'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })
const mountIt = (props) => mount(SkeletonScreen, { props, global: { plugins: [i18n] } })

describe('SkeletonScreen', () => {
  it('variant reader : racine aria-busy, annonce accessible, blocs attendus', () => {
    const w = mountIt({ variant: 'reader' })
    expect(w.attributes('aria-busy')).toBe('true')
    expect(w.classes()).toContain('skel')

    const status = w.find('[role="status"]')
    expect(status.exists()).toBe(true)
    expect(status.text()).toBe('Chargement…')

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
    expect(status.text()).toBe('Chargement…')

    expect(w.find('.skel__bar').exists()).toBe(true)
    expect(w.find('.skel__tabs').exists()).toBe(true)
    expect(w.find('.skel__line').exists()).toBe(true)
    expect(w.find('.skel__line--short').exists()).toBe(true)
    expect(w.findAll('.skel__block')).toHaveLength(1)
  })
})
