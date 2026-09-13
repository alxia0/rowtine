// Garde de l'attribut `lang` du document (revue finale du passage multilingue, 29/07).
//
// Le défaut d'origine : `index.html` livre `<html lang="fr">` en dur et RIEN dans src/ ne le
// mettait à jour. Conséquence mesurable côté utilisatrice : TalkBack prononce l'interface
// allemande et espagnole avec la phonétique française (inintelligible), et la césure CSS
// comme le correcteur orthographique de la WebView partent sur la mauvaise langue.
//
// Le correctif est UN observateur unique dans `src/i18n/index.js` (pas trois appels aux trois
// endroits qui écrivent la locale). Ce fichier garde les deux moitiés du contrat :
//   - l'état INITIAL (au premier import du module, avant tout changement) ;
//   - CHAQUE changement de locale ensuite.
//
// Piège évité : `document.documentElement.lang` est mis à 'zz' AVANT l'import. Sans ce
// salissage, « lang vaut la locale de départ après import » passerait aussi avec
// l'observateur supprimé (le document de test, comme index.html, peut déjà porter 'fr') —
// l'assertion ne pourrait pas rougir. Les assertions de changement portent sur 'de'/'es'/'en',
// jamais sur 'fr'.
//
// Task A2 (30/07) : la locale de départ de `src/i18n/index.js` n'est plus 'fr' codé en dur,
// elle suit `detectDeviceLocale()` — donc `navigator.languages` (priorité sur
// `navigator.language`, cf. src/utils/app-locale.js). Le test « état initial » mocke cette
// valeur pour rester déterministe : sous jsdom, `navigator.languages` vaut par défaut
// `['en-US', 'en']`, ce qui aurait accidentellement fait passer l'ancienne assertion 'fr'.
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
