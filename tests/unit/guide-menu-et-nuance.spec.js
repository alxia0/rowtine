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

// LE PIÈGE QUI REND CES ASSERTIONS MUETTES. Le Markdown du guide enroule ses paragraphes
// à ~72 colonnes, et le JSON compilé peut réinsérer des retours à la ligne : une chaîne
// coupée en deux n'est plus « contenue » nulle part. Sur un `toContain` c'est un rouge
// injustifié ; sur un `not.toContain` — le cas ci-dessous — c'est bien pire : un VERT
// alors que le texte qu'on croyait supprimé est toujours là. On compare donc toujours sur
// un texte à blancs normalisés.
const plat = (s) => s.replace(/\s+/g, ' ')

// Sous-chaînes CARACTÉRISTIQUES du paragraphe supprimé, une par langue. On ancre sur la
// tournure structurelle (« depuis cette mise à jour »), pas sur une phrase entière : le
// retour à la ligne du Markdown coupe les phrases longues à un endroit arbitraire.
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

// Le §1 décrivait l'accueil comme si les tuiles étaient le seul chemin vers Statistiques
// et Dépenses — vrai jusqu'au 12/08, et trompeur depuis : la tuile Dépenses ne s'affiche
// même pas tant qu'aucun achat n'est saisi. Le guide doit nommer le menu.
// ⚠️ Le glyphe ☰ a été RETIRÉ de ces quatre phrases le 21/08/2026 : il n'est dans aucune
// police embarquée et tombait en glyphe de repli système. Le menu est
// désormais décrit par sa PLACE, pas par son dessin — ce que le test vérifiait vraiment.
const MENU_DECRIT = {
  fr: 'le menu en haut à droite',
  en: 'the menu at the top right',
  de: 'das Menü oben rechts',
  es: 'el menú arriba a la derecha',
}

// La phrase sur la tuile conditionnelle reste VRAIE (la tuile n'apparaît toujours pas
// sans achat) mais devient incomplète : elle doit dire où trouver l'écran quand même.
const ECRAN_JOIGNABLE = {
  fr: "l'écran reste joignable par le menu",
  en: 'the screen stays reachable from the menu',
  de: 'bleibt der Bildschirm über das Menü erreichbar',
  es: 'la pantalla sigue siendo accesible desde el menú',
}

// `plat()` est indispensable ici : ces deux phrases sont ENROULÉES sur deux lignes dans
// trois des quatre langues (« the screen stays reachable\n  from the menu »). Sans la
// normalisation, l'assertion serait rouge sans que le texte ait le moindre défaut.

describe('guide — le menu en haut à droite est décrit comme le chemin permanent', () => {
  for (const lang of LANGS) {
    it(`${lang} : le §1 nomme le menu, dans le Markdown ET le JSON compilé`, () => {
      expect(plat(md(lang))).toContain(MENU_DECRIT[lang])
      expect(plat(json(lang))).toContain(MENU_DECRIT[lang])
    })

    it(`${lang} : la tuile conditionnelle renvoie au menu`, () => {
      expect(plat(md(lang))).toContain(ECRAN_JOIGNABLE[lang])
      expect(plat(json(lang))).toContain(ECRAN_JOIGNABLE[lang])
    })
  }
})

// Balayage allemand (12/08/2026) : le guide de nommait l'entrée du menu ☰ vers la
// bibliothèque de patrons « Anleitungsbibliothek », un mot qui n'existe NULLE PART ailleurs
// dans l'interface allemande — `nav.library` (de.json) vaut « Anleitungen ». Une lectrice
// qui cherche « Anleitungsbibliothek » à l'écran ne le trouve jamais. fr/en/es n'ont pas ce
// défaut : leurs mots « bibliothèque »/« library »/« biblioteca » utilisés dans le guide sont
// bien ceux de leur `nav.library` respectif.
//
// Deux traitements distincts, arbitrage du 12/08/2026 (2e passe) :
//  - §1 (menu ☰) et §4 TITRE DÉSIGNENT l'écran vers lequel la lectrice doit se rendre →
//    substitution directe par le mot réel « Anleitungen ».
//  - §3 (« Vorschau aus … »), §4 légende de figure, §4 chips et, depuis le 2026-08-14, §4 ALT
//    DÉCRIVENT un endroit (« cette fonction se trouve sur cet écran »/« cette capture montre cet
//    écran ») : substituer directement « Anleitungen » (nom pluriel de patrons) à la place de
//    « Bibliothek » (nom de lieu) y produirait un allemand faux sens (« en haut DANS LES PATRONS »
//    au lieu de « en haut de l'ÉCRAN ») et une répétition du mot dans la même phrase. Ces
//    endroits nomment donc l'écran EXPLICITEMENT via « Bildschirm „Anleitungen“ » (même motif que
//    « Bildschirm „Info“ », déjà en usage au §1), et gardent une prose naturelle pour le reste.
//
// L'ALT DE LA SECTION 4 A CHANGÉ DE CÔTÉ LE 2026-08-14 — décision produit. L'arbitrage du
// 12/08 le rangeait avec le titre, côté « désigner » : il valait alors le mot nu « Die
// Anleitungen », qui nommait la capture sans rien décrire. La remontée des alt riches depuis le
// site vitrine (dans le cadre de la synchronisation du guide) lui a donné une vraie description
// de 205 caractères — les filtres du haut, les trois cartes, leur contenu — si bien qu'il décrit
// désormais un endroit, exactement comme le §3, la légende et les chips, et rejoint donc leur
// forme guillemetée « Bildschirm „Anleitungen“ ». Le TITRE, lui, reste un mot nu : il continue
// de désigner l'écran, sans rien décrire, et le traitement « désigner » de l'arbitrage du 12/08
// ne s'applique donc plus qu'à lui.
//
// Seul l'allemand est touché ; les 3 autres langues restent intactes.
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

  // Les 3 endroits DESCRIPTIFS nomment l'écran via « Bildschirm „Anleitungen“ », jamais une
  // substitution nue de « Anleitungen » à la place de « Bibliothek » (faux sens mesuré en
  // revue : « oben in den Anleitungen » se lit « en haut DANS LES PATRONS »).
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

  // 12/08/2026 — « Chips » est devenu « Schaltflächen » (retour d'usage : « Chips » désigne
  // d'abord des chips à manger en allemand courant, et c'est du jargon Material Design que
  // personne ne comprend). Le test garde son intention d'origine (l'écran est nommé via
  // « Bildschirm „Anleitungen“ »), seul le mot du bouton change.
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
