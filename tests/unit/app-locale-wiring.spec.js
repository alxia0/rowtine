import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Garde de non-retour : le défaut « français » ne doit revenir dans AUCUN des quatre
// points d'entrée de la langue. Un test de comportement ne peut pas les couvrir tous
// (i18n/index.js s'exécute à l'import du module, avant tout montage) ; on vérifie donc
// la SOURCE. Le motif recherché est le défaut littéral, pas le mot 'fr' lui-même —
// « fr » reste légitime partout ailleurs (clé de langue, fichier de traduction).
const FILES = [
  'src/i18n/index.js',
  'src/stores/settings.js',
  'src/router/index.js',
  'src/views/OnboardingView.vue',
]

describe('aucun défaut « français » en dur dans les points d\'entrée de la langue', () => {
  for (const rel of FILES) {
    it(rel, () => {
      const src = readFileSync(resolve(process.cwd(), rel), 'utf8')
      // `|| 'fr'`, `?? 'fr'`, `ref('fr')`, `locale: 'fr'` — les quatre formes présentes
      // avant ce lot, avec ou sans espaces, en apostrophes simples ou doubles.
      expect(src).not.toMatch(/(\|\||\?\?|ref\(|locale:)\s*['"]fr['"]/)
    })
  }
})
