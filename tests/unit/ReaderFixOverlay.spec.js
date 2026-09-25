// @vitest-environment jsdom
// Voile de correction posé sur une carte du lecteur. Deux cibles centrées, un
// appui sur le voile lui-même le retire, et le voile se retire aussi tout
// seul après 3 secondes d'inactivité (retouche 2026-08-21). Aucun glyphe :
// l'icône vient du registre AppIcon ; le nom accessible du bouton Fermer vient
// désormais de son texte visible (`common.close`), pas d'un aria-label.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import i18n from '@/i18n'
import ReaderFixOverlay from '@/components/ReaderFixOverlay.vue'
import { makeTk } from './helpers/i18n-router'

const tk = makeTk(i18n)

function mountOverlay() {
  return mount(ReaderFixOverlay, { global: { plugins: [i18n] } })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('ReaderFixOverlay', () => {
  it('porte un bouton Corriger et un bouton Fermer nommé', () => {
    const w = mountOverlay()
    expect(w.find('.rfix__do').text()).toBe(tk('reader.fixHere'))
    // Round 2 (essai réel) : le nom accessible vient du texte affiché, plus
    // d'un aria-label qui le doublerait (WCAG 2.5.3, Label in Name).
    expect(w.find('.rfix__close').attributes('aria-label')).toBeUndefined()
    expect(w.find('.rfix__close').text()).toBe(tk('common.close'))
  })

  it('« Corriger » émet fix, et rien d’autre', async () => {
    const w = mountOverlay()
    await w.find('.rfix__do').trigger('click')
    expect(w.emitted('fix')).toHaveLength(1)
    expect(w.emitted('close')).toBeUndefined()
  })

  it('« Fermer » émet close, et rien d’autre', async () => {
    const w = mountOverlay()
    await w.find('.rfix__close').trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
    expect(w.emitted('fix')).toBeUndefined()
  })

  it('un appui sur le voile lui-même émet close', async () => {
    const w = mountOverlay()
    await w.find('.rfix').trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('le bouton Fermer ne porte aucun glyphe dans son texte', () => {
    // Règle du projet : jamais d’emoji ni de glyphe dans l’UI, aria-label
    // compris. La croix est une icône SVG du registre, pas un caractère — le
    // texte du bouton doit valoir EXACTEMENT « Fermer », sans caractère de
    // croix qui s'y serait glissé.
    const w = mountOverlay()
    expect(w.find('.rfix__close').text()).toBe('Fermer')
    expect(w.find('.rfix__close .app-icon svg').exists()).toBe(true)
  })

  it('émet close tout seul au bout de 3 secondes', () => {
    // Timers réels pour le montage (Vue attend des micro-tâches, pas des
    // setTimeout, mais on isole quand même le mount des fake timers pour
    // rester sur le même schéma que les autres tests de ce fichier).
    vi.useFakeTimers()
    const w = mountOverlay()
    expect(w.emitted('close')).toBeUndefined()
    vi.advanceTimersByTime(3000)
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('n’émet rien avant l’échéance', () => {
    vi.useFakeTimers()
    const w = mountOverlay()
    vi.advanceTimersByTime(2900)
    expect(w.emitted('close')).toBeUndefined()
  })

  it('démonté avant l’échéance, le minuteur est annulé (pas de fuite)', () => {
    // ⚠️ `w.emitted('close')` après `unmount()` reste vide QUOI QU'IL ARRIVE
    // (Vue Test Utils arrête d'enregistrer les émissions une fois démonté) —
    // vérifié en désactivant volontairement le `clearTimeout` du composant :
    // ce test-ci restait vert. `vi.getTimerCount()` regarde l'état réel du
    // minuteur plutôt que ce que le wrapper a bien voulu enregistrer.
    vi.useFakeTimers()
    const w = mountOverlay()
    expect(vi.getTimerCount()).toBe(1)
    w.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('un focus dans le voile annule DÉFINITIVEMENT la fermeture automatique (WCAG 2.2.1)', () => {
    // Round de correction 1 : une personne qui navigue au clavier ou avec un
    // lecteur d'écran peut avoir le focus sur un des deux boutons quand les
    // 3 secondes tombent — la fermeture retirerait alors le focus SOUS elle.
    // `vi.getTimerCount()` prouve que le minuteur est réellement annulé (et
    // pas seulement silencieux) — même schéma que le test de fuite ci-dessus.
    vi.useFakeTimers()
    const w = mountOverlay()
    expect(vi.getTimerCount()).toBe(1)
    w.find('.rfix__close').trigger('focusin')
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(3000)
    expect(w.emitted('close')).toBeUndefined()
  })
})
