// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import ImportProgress from '@/components/ImportProgress.vue'
import { createTestI18n, makeTk } from './helpers/i18n-router'

const i18n = createTestI18n()

const tk = makeTk(i18n)
// ImportProgress lit settings.defaultTechnique (animation d'attente) : Pinia doit
// être installé, comme partout ailleurs dans le projet (cf. YarnCard.spec.js).
const mountIt = (props) => mount(ImportProgress, { props, global: { plugins: [i18n, createPinia()] } })

describe('ImportProgress', () => {
  it('rend le %, le libellé de phase et la barre à la bonne largeur', () => {
    const w = mountIt({ pct: 42, labelKey: 'import.phase.assemble', elapsedSec: 12 })
    expect(w.text()).toContain('42 %')
    expect(w.text()).toContain('Assemblage du patron')
    expect(w.find('.iprog__fill').attributes('style')).toContain('width: 42%')
  })
  it('affiche « page X / N » quand un total est fourni (local)', () => {
    const w = mountIt({ pct: 20, labelKey: 'import.phase.extract', elapsedSec: 3, page: 2, total: 10 })
    expect(w.text()).toContain(tk('import.pageOf', { n: 2, total: 10 }))
  })
})
