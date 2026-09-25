// @vitest-environment jsdom
// Unitaire — ImportProgress + KnittingLoader (les travaux de finition de l'interface).
// L'animation d'attente vient EN PLUS de la barre de progression, jamais à sa place :
// le test le plus important ici est la NON-RÉGRESSION (test 2) — il prouve que les
// quatre informations de progression (%, libellé d'étape, temps écoulé, page X/N)
// restent TOUTES affichées une fois l'animation posée. Une jolie boucle qui remplacerait
// une de ces informations serait une perte d'information (règle transverse du projet).
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import ImportProgress from '@/components/ImportProgress.vue'
import { useSettingsStore } from '@/stores/settings'
import { createTestI18n, makeTk } from './helpers/i18n-router'

const i18n = createTestI18n()

const tk = makeTk(i18n)

function mountIt(props, technique) {
  const pinia = createTestingPinia({ createSpy: () => () => {} })
  if (technique !== undefined) {
    const settings = useSettingsStore(pinia)
    settings.defaultTechnique = technique
  }
  return mount(ImportProgress, { props, global: { plugins: [i18n, pinia] } })
}

describe('ImportProgress — animation d\'attente', () => {
  it('rend l\'animation (KnittingLoader) au-dessus de la barre', () => {
    const w = mountIt({ pct: 10, labelKey: 'import.phase.extract', elapsedSec: 2 })
    expect(w.find('.knitting-loader').exists()).toBe(true)
  })

  it('NON-RÉGRESSION : le %, le libellé, le temps écoulé et « page X / N » restent TOUS affichés', () => {
    const w = mountIt({ pct: 42, labelKey: 'import.phase.assemble', elapsedSec: 12, page: 2, total: 10 })
    expect(w.text()).toContain('42 %')
    expect(w.text()).toContain('Assemblage du patron')
    expect(w.text()).toContain('12 s')
    expect(w.text()).toContain(tk('import.pageOf', { n: 2, total: 10 }))
  })

  it('suit la technique par défaut du profil : crochet ⇒ dessin crochet, tricot ⇒ dessin tricot', () => {
    const crochet = mountIt({ pct: 5, labelKey: 'import.phase.extract', elapsedSec: 1 }, 'crochet')
    expect(crochet.find('[data-tool="hook"]').exists()).toBe(true)
    expect(crochet.find('[data-tool="needles"]').exists()).toBe(false)

    const knitting = mountIt({ pct: 5, labelKey: 'import.phase.extract', elapsedSec: 1 }, 'knitting')
    expect(knitting.find('[data-tool="needles"]').exists()).toBe(true)
    expect(knitting.find('[data-tool="hook"]').exists()).toBe(false)
  })
})
