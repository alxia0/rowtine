// Le guide ne décrit plus l'écran de relecture disparu : un import réussi ENREGISTRE
// D'ABORD, la correction se fait ensuite depuis l'aperçu de la fiche patron. Le texte de
// remplacement ne promet aucun délai (« le patron rejoint ta bibliothèque ») : sur la voie
// bloquée, l'enregistrement attend « Importer quand même ».
//
// Balayage des QUATRE langues, dans les `.md` ET les `.json` générés (c'est le JSON que
// l'app rend) : éditer le `.md` sans `yarn guide:gen` laisserait sinon le test vert.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const LANGUES = ['fr', 'en', 'de', 'es']

// Tournures interdites relevées sur les fichiers réels. Espaces tolérées en `\s+` : le
// guide est replié vers 72-75 colonnes, une tournure peut franchir un retour à la ligne.
const INTERDITS = {
  fr: [/écran\s+de\s+relecture/i, /avant\s+d[’']enregistrer/i],
  en: [/review\s+screen/i, /before\s+saving/i],
  de: [/Prüfbildschirm/i, /vor\s+dem\s+Speichern/i],
  es: [/pantalla\s+de\s+revisión/i, /antes\s+de\s+guardar/i],
}

function guideMd(lang) {
  return readFileSync(resolve(process.cwd(), `src/content/guide/${lang}.md`), 'utf8')
}

function guideJson(lang) {
  return readFileSync(resolve(process.cwd(), `src/generated/guide-content.${lang}.json`), 'utf8')
}

describe('guide — l écran de relecture a disparu', () => {
  it('G11 — aucune des quatre langues ne décrit plus cet écran, dans le .md ET le .json généré', () => {
    // PRÉCONDITION : les huit fichiers (4 .md + 4 .json générés) sont bien lus et non vides.
    // Sans elle, un chemin faux rendrait une chaîne vide, et « aucune occurrence » serait
    // vrai à vide.
    for (const lang of LANGUES) {
      expect(guideMd(lang).length, `guide ${lang}.md vide`).toBeGreaterThan(1000)
      expect(guideJson(lang).length, `guide-content.${lang}.json vide`).toBeGreaterThan(1000)
    }

    for (const lang of LANGUES) {
      for (const motif of INTERDITS[lang]) {
        expect(motif.test(guideMd(lang)), `${lang}.md contient encore ${motif}`).toBe(false)
        expect(
          motif.test(guideJson(lang)),
          `guide-content.${lang}.json contient encore ${motif} — relancer yarn guide:gen ?`
        ).toBe(false)
      }
    }
  })

  it('le TON attendu reste en place dans la puce « Importer un PDF », pour les quatre langues', () => {
    // Le ton attendu (la correction est normale) reste dans la puce « Importer un PDF ». Ancré
    // sur des tournures propres à cette puce : un ancrage qui matcherait aussi la puce voisine
    // « Corriger un patron » resterait vert même si celle-ci perdait son ton.
    expect(guideMd('fr')).toMatch(/prévois\s+d[’']y\s+passer\s+un\s+vrai\s+moment/i)
    expect(guideMd('fr')).toMatch(/presque\s+jamais\s+parfait/i)

    expect(guideMd('en')).toMatch(/plan\s+on\s+spending\s+real\s+time\s+on\s+it/i)
    expect(guideMd('en')).toMatch(/almost\s+never\s+comes\s+out\s+perfect/i)

    expect(guideMd('de')).toMatch(/nimm\s+dir\s+dort\s+wirklich\s+zeit/i)
    expect(guideMd('de')).toMatch(/fast\s+nie\s+beim\s+ersten\s+mal\s+perfekt/i)

    expect(guideMd('es')).toMatch(/cuenta\s+con\s+dedicarle\s+un\s+buen\s+rato/i)
    expect(guideMd('es')).toMatch(/casi\s+nunca\s+sale\s+perfecto/i)
  })
})
