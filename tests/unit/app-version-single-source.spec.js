// Garde de non-régression : AVANT ces travaux, package.json
// disait 0.0.0 et android/app/build.gradle disait versionCode 1 / versionName "1.0" en dur —
// deux valeurs de gabarit jamais mises à jour, sans lien entre elles. On a changé
// build.gradle pour qu'il LISE package.json au lieu de porter ses propres valeurs (cf.
// commentaire dans build.gradle) : il n'y a donc plus qu'une seule source à faire vivre.
//
// Ce test ne peut pas exécuter Gradle (JDK 21 + réseau, hors budget d'un test unitaire) : il
// vérifie STRUCTURELLEMENT que build.gradle lit bien `packageJson.version`/
// `packageJson.buildNumber`, et surtout qu'AUCUNE valeur n'y est revenue en dur — c'est ce
// second volet qui fait échouer le test si quelqu'un « corrige vite fait » une valeur
// directement dans build.gradle demain, réintroduisant la divergence silencieuse d'origine.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pkg from '../../package.json'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GRADLE_PATH = path.resolve(__dirname, '../../android/app/build.gradle')

describe('source unique du numéro de version (package.json)', () => {
  it('package.json expose un numéro de version et un numéro de build exploitables', () => {
    expect(pkg.version).toMatch(/^\d+(\.\d+)*$/)
    expect(Number.isInteger(pkg.buildNumber)).toBe(true)
    expect(pkg.buildNumber).toBeGreaterThan(0)
  })

  it('build.gradle lit versionName/versionCode depuis package.json, sans valeur figée en dur', () => {
    const gradle = fs.readFileSync(GRADLE_PATH, 'utf-8')

    expect(gradle).toMatch(/versionName\s+packageJson\.version/)
    expect(gradle).toMatch(/versionCode\s+packageJson\.buildNumber/)

    // Aucune chaîne/nombre littéral nulle part dans le fichier (pas seulement sur la bonne
    // ligne) : en Groovy, la DERNIÈRE affectation d'un même champ gagne — un
    // `versionName '9.9'` ou `versionCode 42` ajouté APRÈS la ligne correcte l'emporterait
    // silencieusement sans que la ligne correcte elle-même change. Trou trouvé en revue
    // (02/08) : la 1re version de ce test n'excluait que les guillemets DOUBLES
    // (`versionName "…"`), un `versionName '9.9'` en guillemets simples passait au vert.
    // `['"]` couvre les deux styles Groovy.
    expect(gradle).not.toMatch(/versionName\s+['"][^'"]*['"]/)
    expect(gradle).not.toMatch(/versionCode\s+\d+\b/)

    // Et il lit bien LE MÊME fichier que celui que ce test vient de vérifier.
    expect(gradle).toMatch(/JsonSlurper\(\)\.parse\(file\('\.\.\/\.\.\/package\.json'\)\)/)
  })
})
