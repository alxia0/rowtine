import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'

// Garde de non-retour : plus AUCUNE phrase française poussée dans un tableau `warnings`,
// dans un champ `reason`/`error`, ni dans un paramètre passé à W(...). Un futur producteur
// qui referait l'erreur casse ce test.
//
// Quatre formes surveillées :
// 1. `warnings.push('...')` / `` warnings.push(`...`) `` — la forme naïve, sans code du tout.
// 2. `reason: '...'` — même défaut sur le champ dédié de merge-pattern-md.js.
// 3. `W(CODE, { detail: '...' })` — la forme RÉELLEMENT survenue trois fois dans ce lot
//    (line.loss et correction.loss avec un paramètre `detail` en clair) : le code est bien
//    structuré, mais un des PARAMÈTRES est resté une phrase au lieu d'une donnée. Les deux
//    premières regex ne voient pas cette forme puisque la ligne commence par `push(W`, pas
//    par un guillemet. On cherche donc, à l'intérieur d'un appel W(...), une propriété
//    d'objet dont la VALEUR est un littéral de chaîne (`clé: '...'`) plutôt qu'une variable
//    ou un raccourci (`{ ref }`, `{ blockKey: key }` restent muets). Bornée au premier `)`
//    rencontré après `W(` : un appel imbriqué comme `cells.join(' ')` dans un paramètre
//    (`{ line: cells.join(' ') }`) ne fait pas remonter de faux positif, vérifié explicitement.
// 4. `error: '...'` — revue finale (31/07) : trois sites de src/backup/patron-md-sync.js
//    renvoyaient `{ error: "phrase française" }`, rejoignant l'écran via `resolved.error`
//    réaffecté à `report.skipped[].reason`. La forme 2 ne les voyait PAS : à leur point de
//    CRÉATION, la clé s'appelle `error`, pas `reason` — le renommage n'a lieu qu'en aval.
//    C'était exactement le trou qui avait justifié (à tort, cf. histoire de KNOWN_LEAKS
//    ci-dessous) d'exempter le fichier ENTIER plutôt que ces trois lignes.
const WARNINGS_PUSH_LITERAL_RE = /warnings\.push\(\s*[`'"]/
const REASON_LITERAL_RE = /reason:\s*[`'"]/
const W_PARAM_LITERAL_RE = /\bW\([^)]*:\s*[`'"]/
const ERROR_PARAM_LITERAL_RE = /\berror:\s*[`'"]/

// HISTORIQUE des fuites connues (liste `KNOWN_LEAKS`, vidée le 06/09/2026) : les trois
// phrases françaises en dur de src/backup/patron-md-sync.js
// (« patron de bibliothèque inconnu en base », « projet introuvable ou sans patron lié »,
// « aucun patron forké… »), listées EXPLICITEMENT le 31/07 plutôt que cachées par une
// exemption de fichier entier, sont migrées vers des codes WARNING_CODES
// (sync.orphanFolder / sync.projectWithoutPattern / sync.noForkedPattern) + entrées
// fr/en/de/es — le mécanisme que leur commentaire d'alors appelait de ses vœux (« migration
// reportée à plus tard »). `withoutKnownLeaks` et le test d'inventaire qui l'accompagnait
// disparaissent avec : la découverte générale couvre désormais CE fichier comme tous les
// autres — tout nouveau littéral français y est détecté normalement.

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

// Garde de canal : les cinq erreurs SAF de saf-storage.js levaient des
// phrases françaises en dur via `new Error(...)` et remontaient BRUTES dans le rapport de
// synchro — l'angle mort ci-dessus : aucune des quatre regex ne voit un `new Error(`. Toute
// levée passe désormais par la fabrique codée E() (code + params, warning-codes.js) pour
// être traduite à l'affichage ; un `new Error(` résiduel dans ce fichier signifie qu'une
// erreur repart non traduite à l'écran. Balayage de source maison (cf.
// saf-lecture-tranches-bornee.spec.js pour le style).
describe('saf-storage.js : toute erreur levée passe par la fabrique codée E()', () => {
  it('plus aucun `new Error(` résiduel', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/backup/saf-storage.js'), 'utf8')
    expect(src).not.toMatch(/new Error\(/)
  })
})
