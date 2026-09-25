// Le guide vit en Markdown (src/content/guide/<langue>.md) et se COMPILE en JSON
// (src/generated/guide-content.<langue>.json) par `yarn guide:gen`. Une correction qui
// n'existerait que dans le Markdown ne serait jamais lue par l'app : ce fichier vérifie
// les DEUX, source et compilé.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const LANGS = ['fr', 'en', 'de', 'es']
const md = (lang) => readFileSync(resolve(process.cwd(), `src/content/guide/${lang}.md`), 'utf8')
const json = (lang) => readFileSync(resolve(process.cwd(), `src/generated/guide-content.${lang}.json`), 'utf8')

// Le Markdown est enroulé vers 72 colonnes et le JSON peut réinsérer des retours à la
// ligne : une chaîne coupée n'est plus « contenue ». Sur un `not.toContain`, cela donnerait
// un VERT alors que le texte est toujours là. On compare donc sur des blancs normalisés.
const plat = (s) => s.replace(/\s+/g, ' ')

// Sous-chaînes CARACTÉRISTIQUES du paragraphe supprimé, une par langue (tournure
// structurelle, pas une phrase entière coupée à un endroit arbitraire).
const NUANCE_PERIMEE = {
  fr: 'depuis cette mise à jour',
  en: 'since this update',
  de: 'seit diesem Update',
  es: 'desde esta actualización',
}

// Le §7 porte DEUX paragraphes ouverts par « Une nuance ». Celui-ci reste : il explique
// pourquoi la tuile « Moyenne par jour actif » affiche un tiret sous filtre. Sans cette
// garde, une suppression trop large l'emporterait sans que rien ne le signale.
const NUANCE_A_GARDER = {
  fr: 'Moyenne par jour actif',
  en: 'Average per active day',
  de: 'Durchschnitt pro aktivem Tag',
  es: 'Media por día activo',
}

describe('guide — la nuance « depuis cette mise à jour » a disparu', () => {
  for (const lang of LANGS) {
    it(`${lang} : absente du Markdown ET du JSON compilé`, () => {
      expect(plat(md(lang))).not.toContain(NUANCE_PERIMEE[lang])
      expect(plat(json(lang))).not.toContain(NUANCE_PERIMEE[lang])
    })
  }
})

describe('guide — la nuance « Moyenne par jour actif » est TOUJOURS là', () => {
  for (const lang of LANGS) {
    it(`${lang} : présente dans le Markdown et le JSON compilé`, () => {
      expect(plat(md(lang))).toContain(NUANCE_A_GARDER[lang])
      expect(plat(json(lang))).toContain(NUANCE_A_GARDER[lang])
    })
  }
})

// L'écran Dépenses n'a plus de tuile sur l'accueil : le guide nomme le menu comme chemin
// permanent. Le menu est décrit par sa PLACE, pas par un glyphe (aucune
// police embarquée ne porte ☰).
const MENU_DECRIT = {
  fr: 'le menu en haut à droite',
  en: 'the menu at the top right',
  de: 'das Menü oben rechts',
  es: 'el menú arriba a la derecha',
}

describe('guide — le menu en haut à droite est décrit comme le chemin permanent', () => {
  for (const lang of LANGS) {
    it(`${lang} : le §1 nomme le menu, dans le Markdown ET le JSON compilé`, () => {
      expect(plat(md(lang))).toContain(MENU_DECRIT[lang])
      expect(plat(json(lang))).toContain(MENU_DECRIT[lang])
    })
  }
})

// Le guide allemand nomme la bibliothèque de patrons « Anleitungen », comme `nav.library`
// de de.json, jamais « Anleitungsbibliothek », introuvable à l'écran. Deux traitements :
//  - le §1 (menu) et le TITRE du §4 DÉSIGNENT l'écran : mot nu « Anleitungen » ;
//  - le §3, la légende, les boutons et l'alt du §4 DÉCRIVENT un endroit :
//    « Bildschirm „Anleitungen“ », car « oben in den Anleitungen » se lirait « en haut DANS
//    LES PATRONS ». fr/en/es ne bougent pas.
describe('guide de — le menu ☰ et la section 4 nomment "Anleitungen" (nav.library), pas "Anleitungsbibliothek"', () => {
  it('le §1 nomme le menu avec "zu den Anleitungen"', () => {
    expect(plat(md('de'))).toContain('zu den Anleitungen, zur Statistik')
    expect(plat(json('de'))).toContain('zu den Anleitungen, zur Statistik')
  })

  it('le titre nomme "Anleitungen" directement, l’alt le nomme via "Bildschirm „Anleitungen“"', () => {
    expect(plat(md('de'))).toContain('## 4. Deine Anleitungen')
    expect(plat(md('de'))).toContain('Bildschirm „Anleitungen“: oben die Filter')
    expect(plat(json('de'))).toContain('Deine Anleitungen')
  })

  // Les endroits DESCRIPTIFS nomment l'écran via « Bildschirm „Anleitungen“ », jamais une
  // substitution nue de « Anleitungen » à la place de « Bibliothek ».
  it('le §3 (aperçu) nomme l’écran via "Bildschirm „Anleitungen“"', () => {
    expect(plat(md('de'))).toContain('Vorschau aus dem Bildschirm „Anleitungen“')
    expect(plat(json('de'))).toContain('Vorschau aus dem Bildschirm „Anleitungen“')
  })

  it('la légende de la section 4 nomme l’écran via "Bildschirm „Anleitungen“", sans répéter "Anleitungen"', () => {
    const legende = 'Der Bildschirm „Anleitungen“, mit den drei beim ersten Start mitgelieferten Beispielen.'
    expect(plat(md('de'))).toContain(legende)
    expect(plat(json('de'))).toContain(legende)
    // Une seule occurrence de « Anleitungen » dans la légende (pas de répétition
    // « Anleitungen »/« Beispielanleitungen » dans la même phrase).
    expect((legende.match(/Anleitungen/g) || []).length).toBe(1)
  })

  // « Kategorie-Schaltflächen », pas « Chips » (jargon Material Design, et d'abord des chips à
  // manger en allemand courant).
  it('les boutons de catégorie (section 4) nomment l’écran via "Bildschirm „Anleitungen“", sans dire "Chips"', () => {
    expect(plat(md('de'))).toContain('Kategorie-Schaltflächen oben im Bildschirm „Anleitungen“ zeigen dir')
    expect(plat(json('de'))).toContain('Kategorie-Schaltflächen oben im Bildschirm „Anleitungen“ zeigen dir')
    expect(plat(md('de'))).not.toContain('Kategorie-Chips')
    expect(plat(json('de'))).not.toContain('Kategorie-Chips')
  })

  it('le mot inventé "Anleitungsbibliothek" a disparu du Markdown ET du JSON compilé', () => {
    expect(md('de')).not.toContain('Anleitungsbibliothek')
    expect(json('de')).not.toContain('Anleitungsbibliothek')
  })

  // fr/en/es ne doivent PAS bouger : preuve que la correction reste allemand-seul.
  it('fr/en/es continuent de nommer leur bibliothèque de patrons comme avant', () => {
    expect(plat(md('fr'))).toContain('à la bibliothèque de patrons')
    expect(plat(md('en'))).toContain('your pattern library')
    expect(plat(md('es'))).toContain('a la biblioteca de patrones')
  })
})
