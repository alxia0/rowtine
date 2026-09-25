// @vitest-environment jsdom
// Statut rapide : le popover de StatusBadge éditable liste les 5 statuts,
// marque le statut courant, émet `change` au choix — et n'émet rien si on reclique le même.
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import StatusBadge from '@/components/StatusBadge.vue'
import { createTestI18n, makeTk } from './helpers/i18n-router'

const i18n = createTestI18n()

const tk = makeTk(i18n)

function mountBadge(props) {
  return mount(StatusBadge, { global: { plugins: [i18n] }, props })
}

describe('StatusBadge — statut rapide', () => {
  it('non éditable : rendu statique inchangé (pas de bouton)', () => {
    const w = mountBadge({ status: 'wip' })
    expect(w.find('button').exists()).toBe(false)
    expect(w.text()).toContain(tk('status.wip'))
  })

  it('éditable : le popover liste les 6 statuts et marque le courant', async () => {
    const w = mountBadge({ status: 'pause', editable: true })
    await w.find('button.badge--editable').trigger('click')
    const items = w.findAll('.menu__item')
    expect(items).toHaveLength(6)
    // STATUS_ORDER = ['waiting','wip','pause','done','future','abandoned'] → 'pause' est l'index 2
    expect(items[2].attributes('aria-current')).toBe('true')
    expect(items[0].attributes('aria-current')).toBeUndefined()
    expect(items[1].attributes('aria-current')).toBeUndefined()
  })

  it('choisir un autre statut émet `change` et ferme le menu', async () => {
    const w = mountBadge({ status: 'wip', editable: true })
    await w.find('button.badge--editable').trigger('click')
    const items = w.findAll('.menu__item')
    await items[3].trigger('click') // 'done' (index 3 de STATUS_ORDER)
    expect(w.emitted('change')).toEqual([['done']])
    expect(w.find('.menu').exists()).toBe(false)
  })

  it('recliquer le statut déjà actif n\'émet rien', async () => {
    const w = mountBadge({ status: 'wip', editable: true })
    await w.find('button.badge--editable').trigger('click')
    const items = w.findAll('.menu__item')
    await items[1].trigger('click') // 'wip' déjà actif (index 1 de STATUS_ORDER)
    expect(w.emitted('change')).toBeUndefined()
  })

  it('clic sur le scrim ferme le menu', async () => {
    const w = mountBadge({ status: 'wip', editable: true })
    await w.find('button.badge--editable').trigger('click')
    expect(w.find('.menu').exists()).toBe(true)
    await w.find('.menu__scrim').trigger('click')
    expect(w.find('.menu').exists()).toBe(false)
  })

  it('menuAlign par défaut ("right") : le menu s\'aligne à droite (cas ProjectCard)', async () => {
    const w = mountBadge({ status: 'wip', editable: true })
    await w.find('button.badge--editable').trigger('click')
    expect(w.find('.menu').classes()).toContain('menu--right')
    expect(w.find('.menu').classes()).not.toContain('menu--left')
  })

  it('menuAlign="left" : le menu s\'aligne à gauche (cas ProjectDetailView, évite la troncature)', async () => {
    const w = mountBadge({ status: 'wip', editable: true, menuAlign: 'left' })
    await w.find('button.badge--editable').trigger('click')
    expect(w.find('.menu').classes()).toContain('menu--left')
    expect(w.find('.menu').classes()).not.toContain('menu--right')
  })
})
