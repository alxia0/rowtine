// @vitest-environment jsdom
// ChronoPill — zone chevron ▾ et mini-menu « Masquer le chrono » (spec 08/09/2026,
// variante B : fusion du bouton œil dans la pastille). La pastille reste SANS
// politique : le corps émet `toggle` (lecture/pause), la zone chevron ouvre un
// mini-menu d'UNE entrée qui émet `hide` — chaque parent branche sa propre fonction
// de masquage. Ici on épingle les invariants du composant seul :
//   1. chevron absent quand canHide=false (patron libre : rien à persister) ;
//   2. l'appui chevron n'émet JAMAIS `toggle` (le corps garde son unique rôle) ;
//   3. l'entrée du menu émet `hide` et referme le menu ;
//   4. menu refermé par Échap et par appui au dehors (scrim), sans émettre `hide`.
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import i18n from '@/i18n'
import fr from '@/i18n/fr.json'

import ChronoPill from '@/components/ChronoPill.vue'

function mountPill(props = {}) {
  return mount(ChronoPill, { global: { plugins: [createPinia(), i18n] }, props })
}

// Menu ouvert par le geste réel (appui sur la zone chevron), pas par une manipulation
// d'état interne : le test couvre aussi le câblage du déclencheur.
async function openMenu(w) {
  await w.find('.chrono-fab__chev').trigger('click')
  expect(w.find('.chrono-fab__menu').exists()).toBe(true)
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('ChronoPill — zone chevron (spec fusion chrono+œil, variante B)', () => {
  it('canHide par défaut → chevron présent, nommé, porteur de aria-haspopup/aria-expanded', () => {
    const w = mountPill()
    const chev = w.find('.chrono-fab__chev')
    expect(chev.exists()).toBe(true)
    // Montage jsdom : sélection PAR CLASSE (pratique en unitaire) — c'est l'e2e
    // (reader-actionbar.spec.js) qui couvre le geste PAR NOM ACCESSIBLE. Ce que ce banc
    // épingle ici, c'est la VALEUR du nom accessible : l'aria-label annonce l'ACTION
    // traduite (reader.hideTimer), jamais un glyphe.
    expect(chev.attributes('aria-label')).toBe(fr.reader.hideTimer)
    expect(chev.attributes('aria-haspopup')).toBe('true')
    expect(chev.attributes('aria-expanded')).toBe('false')
  })

  it('canHide=false → AUCUN chevron (patron libre : rien à persister, pastille toujours visible)', () => {
    const w = mountPill({ canHide: false })
    expect(w.find('.chrono-fab__chev').exists()).toBe(false)
    // Pas de chevron ⇒ pas d'appel de menu anywhere : aucun bouton ne porte aria-haspopup.
    expect(w.findAll('[aria-haspopup]').length).toBe(0)
  })

  it('l’appui chevron ouvre le mini-menu et N’ÉMET JAMAIS toggle (le corps garde son rôle)', async () => {
    const w = mountPill()
    await openMenu(w)
    // Le corps de la pastille n'a pas répondu : une seule entrée « Masquer le chrono ».
    const items = w.findAll('.chrono-fab__menu-item')
    expect(items.length).toBe(1)
    expect(items[0].text()).toBe(fr.reader.hideTimer)
    expect(w.emitted('toggle')).toBeUndefined()
    // aria-expanded reflète l'état du menu (lecteur d'écran).
    expect(w.find('.chrono-fab__chev').attributes('aria-expanded')).toBe('true')
  })

  it('l’appui sur le CORPS émet toggle et n’ouvre pas le menu', async () => {
    const w = mountPill()
    await w.find('.chrono-fab__body').trigger('click')
    expect(w.emitted('toggle')).toHaveLength(1)
    expect(w.find('.chrono-fab__menu').exists()).toBe(false)
  })

  it('l’entrée du menu émet hide une fois et referme le menu', async () => {
    const w = mountPill()
    await openMenu(w)
    await w.find('.chrono-fab__menu-item').trigger('click')
    expect(w.emitted('hide')).toHaveLength(1)
    expect(w.find('.chrono-fab__menu').exists()).toBe(false)
  })

  it('Échap referme le menu sans émettre hide', async () => {
    const w = mountPill()
    await openMenu(w)
    // Écouteur sur window (composable maison) : hors test-utils, le rendu du v-if demande
    // un tour de plus — même besoin de nextTick que pour tout état muté à la main.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(w.find('.chrono-fab__menu').exists()).toBe(false)
    expect(w.emitted('hide')).toBeUndefined()
  })

  it('l’appui au dehors (scrim) referme le menu sans émettre hide', async () => {
    const w = mountPill()
    await openMenu(w)
    await w.find('.chrono-fab__scrim').trigger('click')
    expect(w.find('.chrono-fab__menu').exists()).toBe(false)
    expect(w.emitted('hide')).toBeUndefined()
  })
})
