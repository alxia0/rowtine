// Aucun texte affiché n'emploie un caractère qu'aucune police de l'app ne dessine
// (mesuré le 17/08/2026, re-compté le 21/08 : 44 occurrences).
//
// Le défaut : ces six-là tombent en glyphe de repli, servis par une police système
// d'Android. Ça marche… tant qu'Android en a une. Le rendu est alors HORS DE TOUT
// CONTRÔLE — autre graisse, autre chasse, autre gris que le texte qui les entoure.
// Et la règle du projet interdit déjà emoji et glyphes bruts dans l'UI : ces six-là
// sont exactement ça, ils étaient passés au travers.
//
// La réponse retenue le 21/08/2026 (retour terrain « règle le problème ») :
//   - `✓`, `↺`, `↤` : le glyphe SORT de la chaîne et devient une <AppIcon> dans le
//     composant. C'est la voie du projet — une icône, pas un caractère.
//   - `→`, `≈` : impossible d'y mettre une icône, ils vivent DANS une phrase
//     interpolée. Ils deviennent des mots, dans chacune des quatre langues.
//   - `☰` : le guide décrivait le menu par son glyphe ; il le décrit par sa place.
//
// ⚠️ Le chemin des guides est À PLAT — `src/content/guide/{fr,en,de,es}.md`, jamais
// `src/content/guide/<langue>/*.md`. Un balayage sur le mauvais chemin ne trouve
// rien et fait croire que le défaut a disparu (piège tombé une fois le 21/08).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const lire = (p) => readFileSync(resolve(process.cwd(), p), 'utf8')

const LANGUES = ['fr', 'en', 'de', 'es']

// Les six caractères mesurés absents des trois .woff2 embarqués. Ils manquaient
// DÉJÀ à Fraunces et DM Sans : le changement de couple du 17/08 n'y est pour rien,
// la couverture est strictement identique avant et après.
const INTROUVABLES = [
  { c: '→', nom: 'flèche droite U+2192' },
  { c: '↤', nom: 'flèche gauche à barre U+21A4' },
  { c: '↺', nom: 'flèche circulaire U+21BA' },
  { c: '≈', nom: 'presque égal U+2248' },
  { c: '☰', nom: 'trigramme du menu U+2630' },
  { c: '✓', nom: 'coche U+2713' },
]

const SOURCES = [
  ...LANGUES.map((l) => `src/i18n/${l}.json`),
  ...LANGUES.map((l) => `src/content/guide/${l}.md`),
]

describe('caractères qu\'aucune police de l\'app ne dessine', () => {
  for (const chemin of SOURCES) {
    for (const { c, nom } of INTROUVABLES) {
      it(`${chemin} n'emploie plus ${nom}`, () => {
        const contenu = lire(chemin)
        const occurrences = contenu.split(c).length - 1
        expect(
          occurrences,
          `${chemin} emploie ${occurrences} fois ${nom} (« ${c} »). Ce caractère tombe en ` +
            `glyphe de repli système sur l'appareil. Remplace-le par une <AppIcon> si c'est ` +
            `un bouton, par un mot s'il est dans une phrase.`,
        ).toBe(0)
      })
    }
  }

  it('les fichiers balayés existent vraiment (garde contre un mauvais chemin)', () => {
    // Un chemin faux rendrait tous les tests ci-dessus verts sans rien prouver.
    for (const chemin of SOURCES) expect(lire(chemin).length).toBeGreaterThan(100)
  })
})
