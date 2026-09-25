// package.json est la seule source du numéro de version : build.gradle le LIT au lieu de
// porter ses propres valeurs. Sans exécuter Gradle (JDK 21, hors budget d'un test unitaire),
// on vérifie qu'il lit `packageJson.version`/`packageJson.buildNumber` et qu'AUCUNE valeur
// n'y est revenue en dur.
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

    // Aucune valeur littérale nulle part dans le fichier : en Groovy, la DERNIÈRE affectation
    // gagne, un `versionCode 42` ajouté après la bonne ligne l'emporterait en silence.
    // `['"]` couvre les deux styles de guillemets Groovy.
    expect(gradle).not.toMatch(/versionName\s+['"][^'"]*['"]/)
    expect(gradle).not.toMatch(/versionCode\s+\d+\b/)

    // Et il lit bien LE MÊME fichier que celui que ce test vient de vérifier.
    expect(gradle).toMatch(/JsonSlurper\(\)\.parse\(file\('\.\.\/\.\.\/package\.json'\)\)/)
  })
})
