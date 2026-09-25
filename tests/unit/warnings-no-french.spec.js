import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'

// Garde de non-retour : aucune phrase française poussée dans un tableau `warnings`, dans un
// champ `reason`/`error`, ni dans un paramètre passé à W(...). Quatre formes surveillées :
// 1. `warnings.push('...')`, la forme naïve, sans code du tout.
// 2. `reason: '...'`, même défaut sur le champ dédié de merge-pattern-md.js.
// 3. `W(CODE, { detail: '...' })` : code structuré mais PARAMÈTRE resté une phrase. On
//    cherche, dans un appel W(...), une propriété dont la VALEUR est un littéral de chaîne
//    (`{ ref }`, `{ blockKey: key }` restent muets). Bornée au premier `)` après `W(` :
//    `{ line: cells.join(' ') }` ne remonte pas de faux positif.
// 4. `error: '...'` : à leur point de CRÉATION, des erreurs de patron-md-sync.js s'appellent
//    `error` et ne deviennent `reason` qu'en aval, invisibles à la forme 2.
const WARNINGS_PUSH_LITERAL_RE = /warnings\.push\(\s*[`'"]/
const REASON_LITERAL_RE = /reason:\s*[`'"]/
const W_PARAM_LITERAL_RE = /\bW\([^)]*:\s*[`'"]/
const ERROR_PARAM_LITERAL_RE = /\berror:\s*[`'"]/

// Aucun fichier n'est exempté : la découverte couvre patron-md-sync.js comme tous les autres.

function walk(dir, acc) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, acc)
    else if (/\.(js|vue)$/.test(entry)) acc.push(full)
  }
  return acc
}

const root = resolve(process.cwd(), 'src')
const ALL_SRC_FILES = walk(root, [])
  .map((f) => relative(process.cwd(), f))
  .sort()

describe('aucun avertissement en français en dur (découverte src/**/*.{js,vue})', () => {
  for (const rel of ALL_SRC_FILES) {
    it(rel, () => {
      const src = readFileSync(resolve(process.cwd(), rel), 'utf8')
      expect(src).not.toMatch(WARNINGS_PUSH_LITERAL_RE)
      expect(src).not.toMatch(REASON_LITERAL_RE)
      expect(src).not.toMatch(W_PARAM_LITERAL_RE)
      expect(src).not.toMatch(ERROR_PARAM_LITERAL_RE)
    })
  }
})

// Garde de canal : aucune des quatre regex ne voit un `new Error(`. Dans saf-storage.js,
// toute levée passe par la fabrique codée E() (code + params) pour être traduite à
// l'affichage ; un `new Error(` résiduel remonterait une phrase brute dans le rapport.
describe('saf-storage.js : toute erreur levée passe par la fabrique codée E()', () => {
  it('plus aucun `new Error(` résiduel', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/backup/saf-storage.js'), 'utf8')
    expect(src).not.toMatch(/new Error\(/)
  })
})
