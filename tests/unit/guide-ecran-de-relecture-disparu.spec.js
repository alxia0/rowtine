// Unitaire — le guide ne doit plus décrire un écran de relecture qui n'existe plus.
//
// Mesuré le 19/08/2026 : le §4 des QUATRE guides affirmait « un écran de relecture s'ouvre
// alors […] c'est toi qui relis, vérifies et corriges AVANT D'ENREGISTRER ». Cet écran a
// disparu au lot des trois retouches (17-18/08) : un import réussi ENREGISTRE D'ABORD, puis
// reste sur l'écran d'import avec un bloc de réussite. La correction se fait ensuite, depuis
// l'aperçu de la fiche patron (cf. LocalPdfImportView.vue, section « Import réussi »).
//
// ⚠️ Le remplacement n'affirme PAS que le patron rejoint la bibliothèque « dès que la lecture
// aboutit » : sur la voie bloquée (plus de deux colonnes, plusieurs patrons dans un fichier —
// LocalPdfImportView.vue:278-283), la lecture aboutit (result.value est rempli) mais
// l'enregistrement reste SUSPENDU jusqu'au clic sur « Importer quand même ». Une formule liant
// l'entrée en bibliothèque au succès de la lecture serait donc fausse sur cette voie. Le texte
// écrit ne fait plus aucune promesse de délai : « le patron rejoint ta bibliothèque » (fr),
// vrai que l'enregistrement soit automatique ou déclenché par ce bouton.
//
// ⚠️ BALAYAGE SUR LES QUATRE FICHIERS, jamais sur un seul. Un balayage fondé sur le diff
// serait aveugle à ce qui n'est jamais passé par l'ancien état (leçon du 03/08).
//
// ⚠️ Le garde-fou couvre aussi les QUATRE `.json` générés (src/generated/guide-content.*),
// pas seulement les `.md` sources : l'app rend le JSON, pas le Markdown. Éditer le `.md` sans
// relancer `yarn guide:gen` laisserait ce test vert alors que l'écran supprimé reste décrit
// dans ce que l'app affiche réellement. (`guide-content-fresh.spec.js` garde par ailleurs la
// fraîcheur du JSON vis-à-vis du `.md` — ce test-ci ne s'y substitue pas, il vérifie le
// contenu affiché indépendamment de cette autre garde.)
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const LANGUES = ['fr', 'en', 'de', 'es']

// Les tournures interdites, par langue — RELEVÉES sur les fichiers réels le 19/08/2026
// (étape 0), pas devinées. Espaces tolérées en `\s+` : le guide est replié à
// large ~72-75 colonnes, une tournure de deux ou trois mots peut franchir un retour à la
// ligne selon l'endroit où elle retombe après réécriture.
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
    // Une demande déjà recensée est satisfaite : la correction doit être annoncée
    // comme attendue et normale. Ce test empêche qu'on la perde en réécrivant le passage.
    //
    // ⚠️ Ancré sur des tournures qui vivent DANS la puce « Importer un PDF », pas sur des
    // phrases qui pourraient aussi bien venir de la puce voisine « Corriger un patron »
    // (laissée intacte par cette tâche) — un ancrage trop large resterait vert même si la
    // puce « Importer un PDF » perdait tout son ton.
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
