// @vitest-environment jsdom
// `<html lang>` suit la locale de i18n, à l'import puis à chaque changement : sinon TalkBack
// lit l'allemand ou l'espagnol avec la phonétique française (index.html livre lang="fr").
//
// Harnais : `lang` est sali à 'zz' AVANT l'import, sinon l'état initial passerait même sans
// l'observateur. La locale de départ suit `navigator.languages` (src/utils/app-locale.js),
// d'où le mock : sous jsdom elle vaut ['en-US', 'en'] par défaut.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('`<html lang>` suit la locale de i18n', () => {
  beforeEach(() => {
    // Valeur bidon : ni 'fr' (le défaut de index.html), ni aucune langue de l'app.
    document.documentElement.lang = 'zz'
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('état initial : le premier import pose déjà la locale de départ sur le document', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-DE'])
    expect(document.documentElement.lang).toBe('zz') // témoin : c'est bien l'import qui écrit
    await import('@/i18n')
    expect(document.documentElement.lang).toBe('de')
  })

  it.each(['de', 'es', 'en'])('changer la locale pour « %s » met le document à jour', async (locale) => {
    const { default: i18n } = await import('@/i18n')
    i18n.global.locale.value = locale
    // Aucun `await nextTick()` : l'observateur est en `flush: 'sync'`, l'attribut est posé
    // dans le même tick que l'affectation. Si ce test devait un jour attendre un tick, c'est
    // que le `flush` a changé — et un lecteur d'écran interrogeant le document juste après
    // le changement lirait alors encore l'ancienne langue.
    expect(document.documentElement.lang).toBe(locale)
  })

  it('revenir au français remet le document au français', async () => {
    const { default: i18n } = await import('@/i18n')
    i18n.global.locale.value = 'de'
    expect(document.documentElement.lang).toBe('de')
    i18n.global.locale.value = 'fr'
    expect(document.documentElement.lang).toBe('fr')
  })
})
