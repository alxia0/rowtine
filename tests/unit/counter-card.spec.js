// @vitest-environment jsdom
// CounterCard : le champ de compte de rangs n'écrit qu'un entier positif ou nul.
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestI18n } from './helpers/i18n-router'
import CounterCard from '@/components/CounterCard.vue'

const i18n = createTestI18n()
const mountCard = () =>
  mount(CounterCard, { props: { counter: { id: 7, name: 'Manche', value: 12, target: 0 } }, global: { plugins: [i18n], stubs: { AppIcon: true } } })

describe('CounterCard — saisie du compte de rangs', () => {
  it('un entier valide est émis', async () => {
    const w = mountCard()
    const input = w.find('.ccard__val')
    await input.setValue('15')
    expect(w.emitted('set')).toEqual([[7, 15]])
  })

  // Protège : une saisie négative ou décimale ne remet pas le compte à zéro (ni ne stocke 2.5 rangs).
  it.each(['-5', '2.5', ''])('« %s » est refusé et le compte affiché est rétabli', async (saisie) => {
    const w = mountCard()
    const input = w.find('.ccard__val')
    await input.setValue(saisie)
    expect(w.emitted('set')).toBeUndefined()
    expect(input.element.value).toBe('12')
  })
})
