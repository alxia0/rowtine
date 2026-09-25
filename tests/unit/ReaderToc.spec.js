// @vitest-environment jsdom
// Sommaire du lecteur : rangée horizontale défilante de puces TOUJOURS visible
// (T2, depuis le 31/08 au soir — plus de bouton dépliant ni d'état open), masquée si ≤ 1
// section, clic → émission de l'id de section (la vue parente gère l'ancre `?section=`).
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import i18n from '@/i18n'
import ReaderToc from '@/components/ReaderToc.vue'
import { makeTk } from './helpers/i18n-router'

const tk = makeTk(i18n)

const MANY = [
  { id: 'presentation', title: 'Présentation' },
  { id: 'dos', title: 'Dos' },
  { id: 'manches', title: 'Manches' },
]

function mountToc(props = {}) {
  return mount(ReaderToc, {
    props: { sections: MANY, ...props },
    global: { plugins: [i18n] },
  })
}

describe('ReaderToc', () => {
  it('affiche une rangée de puces toujours visible, sans bouton ni aria-expanded', () => {
    const w = mountToc()
    expect(w.find('nav').attributes('aria-label')).toBe(tk('reader.toc'))
    // Plus de bouton dépliant : la rangée est le seul contenu du nav.
    expect(w.find('.rtoc__btn').exists()).toBe(false)
    expect(w.html()).not.toContain('aria-expanded')
    const chips = w.findAll('.rtoc__chip')
    expect(chips.map((c) => c.text())).toEqual(['Présentation', 'Dos', 'Manches'])
    expect(w.find('.rtoc__row').isVisible()).toBe(true)
  })

  it('marque la puce active quand activeId est fourni', () => {
    const w = mountToc({ activeId: 'manches' })
    const chips = w.findAll('.rtoc__chip')
    expect(chips[2].classes()).toContain('rtoc__chip--on')
    expect(chips[0].classes()).not.toContain('rtoc__chip--on')
    // La puce active est annoncée aux lecteurs d'écran, les autres non (pattern StatusBadge).
    expect(chips[2].attributes('aria-current')).toBe('true')
    expect(chips[0].attributes('aria-current')).toBeUndefined()
    expect(chips[1].attributes('aria-current')).toBeUndefined()
  })

  it('suit les changements d’activeId (re-marquage de la puce)', async () => {
    const w = mountToc({ activeId: 'dos' })
    expect(w.findAll('.rtoc__chip')[1].classes()).toContain('rtoc__chip--on')
    await w.setProps({ activeId: 'manches' })
    const chips = w.findAll('.rtoc__chip')
    expect(chips[1].classes()).not.toContain('rtoc__chip--on')
    expect(chips[2].classes()).toContain('rtoc__chip--on')
  })

  it('un clic sur une puce émet navigate avec l’id de section', async () => {
    const w = mountToc({ activeId: 'dos' })
    await w.findAll('.rtoc__chip')[1].trigger('click')
    expect(w.emitted('navigate')).toEqual([['dos']])
    // Plus de fermeture auto : la rangée reste en place après le clic.
    expect(w.find('nav').exists()).toBe(true)
    expect(w.findAll('.rtoc__chip')).toHaveLength(3)
  })

  it('est masqué quand le patron n’a qu’une seule section (ou aucune)', () => {
    for (const sections of [[{ id: 'presentation', title: 'Présentation' }], []]) {
      const w = mountToc({ sections })
      expect(w.find('nav').exists()).toBe(false)
      expect(w.find('.rtoc__row').exists()).toBe(false)
    }
  })

  it('monte sans erreur avec une puce active (centrage par scrollLeft, jamais scrollIntoView)', () => {
    // Le centrage au montage passe par la rangée (rects à zéro sous jsdom : repli
    // silencieux attendu) — l'assertion couvre surtout l'absence de scrollIntoView
    // (non implémenté par jsdom, qui leverait si le composant l'appelait).
    expect(() => mountToc({ activeId: 'dos' })).not.toThrow()
  })
})
