// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AppIcon from '@/components/AppIcon.vue'
import { ICONS } from '@/utils/icons'
import { SECTION_KINDS, iconToKind, sectionKind, kindLabelKey, isKind } from '@/utils/section-kinds'

describe('AppIcon', () => {
  it('rend un <svg> au trait courant pour une icône connue', () => {
    const w = mount(AppIcon, { props: { name: 'edit' } })
    const svg = w.get('svg')
    expect(svg.attributes('stroke')).toBe('currentColor')
    expect(svg.attributes('fill')).toBe('none')
    expect(svg.attributes('stroke-width')).toBe('1.7')
    expect(svg.attributes('viewBox')).toBe('0 0 24 24')
    // le corps de l'icône est bien injecté
    expect(w.html()).toContain('<path')
  })

  it('applique la taille demandée', () => {
    const w = mount(AppIcon, { props: { name: 'close', size: 28 } })
    expect(w.get('svg').attributes('width')).toBe('28')
    expect(w.get('svg').attributes('height')).toBe('28')
  })

  it('repli sur pelote pour un nom inconnu (jamais de trou)', () => {
    const w = mount(AppIcon, { props: { name: 'zzz-inexistant' } })
    expect(w.get('svg').attributes('viewBox')).toBe('0 0 24 24')
    expect(w.html()).toBe(mount(AppIcon, { props: { name: 'pelote' } }).html())
  })

  it('icône « import » enregistrée : rendu distinct du repli pelote', () => {
    expect(ICONS.import).toBeTruthy()
    const w = mount(AppIcon, { props: { name: 'import' } })
    expect(w.html()).not.toBe(mount(AppIcon, { props: { name: 'pelote' } }).html())
  })

  it('accessibilité : décorative par défaut, nommée avec label', () => {
    const deco = mount(AppIcon, { props: { name: 'check' } })
    expect(deco.get('span').attributes('aria-hidden')).toBe('true')
    expect(deco.get('span').attributes('role')).toBeUndefined()

    const named = mount(AppIcon, { props: { name: 'check', label: 'Fait' } })
    expect(named.get('span').attributes('role')).toBe('img')
    expect(named.get('span').attributes('aria-label')).toBe('Fait')
    expect(named.get('span').attributes('aria-hidden')).toBeUndefined()
  })
})

describe('section-kinds', () => {
  it('toutes les clés de kind ont une icône au registre', () => {
    for (const { key } of SECTION_KINDS) {
      expect(ICONS[key], `icône manquante pour kind « ${key} »`).toBeTruthy()
    }
  })

  it('iconToKind mappe les anciens emoji', () => {
    expect(iconToKind('🧶')).toBe('pelote')
    expect(iconToKind('📈')).toBe('diagramme')
    expect(iconToKind('💪')).toBe('manche')
    expect(iconToKind('❓')).toBeNull()
  })

  it('sectionKind : kind explicite > emoji legacy > défaut', () => {
    expect(sectionKind({ kind: 'corps' })).toBe('corps')
    expect(sectionKind({ icon: '📈' })).toBe('diagramme') // legacy
    expect(sectionKind({ icon: '🤷' })).toBe('pelote') // inconnu → défaut
    expect(sectionKind({})).toBe('pelote')
  })

  it('kindLabelKey retombe sur le défaut pour un kind inconnu', () => {
    expect(kindLabelKey('corps')).toBe('reader.kind.corps')
    expect(kindLabelKey('nope')).toBe('reader.kind.pelote')
    expect(isKind('nope')).toBe(false)
  })
})
