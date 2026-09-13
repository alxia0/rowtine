import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const FONTS = resolve(ROOT, 'public/fonts')
const TOKENS = resolve(ROOT, 'src/styles/tokens.css')

// ───────────────────────────────────────────────────────────────────────────────────────────
// Les polices de l'app, changées le 17/08/2026 : Fraunces + DM Sans → Literata + Source Sans 3.
//
// Pourquoi ce fichier existe : dans une app HORS LIGNE, une police mal choisie ne produit
// AUCUNE erreur. Pas de 404 visible, pas de test rouge — juste des glyphes de repli sur
// l'appareil de l'utilisatrice, là où personne ne regarde avant qu'elle s'en plaigne. Le seul moment
// où le défaut est attrapable est ICI.
//
// Le piège précis, et il est vicieux : fontsource découpe chaque police par sous-ensemble
// Unicode. Le fichier `latin-ext` ne contient PAS le latin de base — il contient UNIQUEMENT
// ce qui déborde de U+0000–U+00FF. Prendre `latin-ext` au lieu de `latin`, ou le prendre
// « en plus, pour être sûr d'avoir les accents », donne un fichier à qui manquent les 24
// lettres accentuées des quatre langues (ä ö ü ñ é ç ¿ …). Mesuré au fontTools 4.63.0 le
// 17/08 : c'est bien le sous-ensemble `latin` qui les porte toutes, U+0152–U+0153 (Œ œ)
// compris.
// ───────────────────────────────────────────────────────────────────────────────────────────

// Empreintes des fichiers EXACTS mesurés au fontTools le 17/08/2026, pris tels quels dans
// @fontsource-variable/literata@5.3.0 et @fontsource-variable/source-sans-3@5.3.0
// (sous-ensemble `latin`). Ce que la mesure a établi sur CES octets-là, et rien d'autre :
//
//   literata-wght.woff2            axe wght 200→900 (déf. 400) · feature tnum PRÉSENTE ·
//                                  les 24 accentuées + Œœ présentes · U+202F absente
//   source-sans-3-wght.woff2       axe wght 200→900 (déf. 200) · chiffres TABULAIRES par
//                                  construction (les dix font 472/1000) · U+202F absente
//   source-sans-3-wght-italic      axe wght 200→900 · angle −11° (vraie italique dessinée,
//                                  pas une oblique synthétisée) · chiffres à 456/1000
//
// Une empreinte qui change veut dire que le fichier n'est PLUS celui qui a été mesuré : la
// couverture, la plage de graisse et l'alignement des chiffres redeviennent inconnus. Il faut
// alors re-mesurer au fontTools et remettre à jour ce tableau ET la spec — pas ajuster
// l'empreinte pour faire passer le test.
const ATTENDUES = {
  'literata-wght.woff2': '9adbeac5b167fe5ad6c49d9e29aa0c76e2f1bb3b46bf4ebf12a9eca7d3525384',
  'source-sans-3-wght.woff2': '7a19a7027e125257d310c6dbd78ae3a30b5ea1e3794d60b12bb28227a003bfda',
  'source-sans-3-wght-italic.woff2':
    '9a15dafc2c2b2414aaa9d6c30830d9aab4361329d8495b1574633603b994b411',
}

// Les fichiers de police d'AVANT. Les laisser traîner n'est pas neutre : un @font-face
// oublié continuerait de résoudre, et le poids partirait dans l'APK sans que rien ne serve.
const ANCIENNES = ['dm-sans-wght.woff2', 'dm-sans-wght-italic.woff2', 'fraunces-wght.woff2']

// Plage RÉELLE de l'axe de graisse des trois fichiers, mesurée (fvar). Les deux polices
// démarrent à 200, là où DM Sans allait jusqu'à 100 et Fraunces aussi. Déclarer l'ancienne
// plage dans un @font-face ne casse rien de visible : le navigateur CLAMPE en silence, et
// toutes les graisses de l'app glissent sans que rien ne le signale.
const AXE_REEL = { min: 200, max: 900 }

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

describe('polices embarquées', () => {
  // ── V1 ────────────────────────────────────────────────────────────────────────────────
  // Mutation qui doit la faire échouer : remplacer un fichier par sa variante `latin-ext`
  // (ou par n'importe quel autre sous-ensemble), vérifié le 17/08.
  it('les trois .woff2 sont EXACTEMENT les fichiers mesurés au fontTools', () => {
    for (const [nom, empreinte] of Object.entries(ATTENDUES)) {
      const chemin = join(FONTS, nom)
      expect(existsSync(chemin), `public/fonts/${nom} est absent`).toBe(true)
      expect(
        sha256(chemin),
        `public/fonts/${nom} n'est plus le fichier mesuré au fontTools le 17/08. Sa couverture ` +
          'de caractères, sa plage de graisse et l’alignement de ses chiffres sont donc ' +
          'REDEVENUS INCONNUS. Re-mesurer et mettre à jour ce tableau ET la spec — ne pas se ' +
          'contenter de recopier la nouvelle empreinte. ⚠️ Piège le plus probable : avoir pris ' +
          'le sous-ensemble `latin-ext`, à qui manquent les 24 lettres accentuées.',
      ).toBe(empreinte)
    }
  })

  // ── V3 ────────────────────────────────────────────────────────────────────────────────
  // Mutation : remettre fraunces-wght.woff2 dans public/fonts/.
  it('aucune des trois anciennes polices ne traîne encore', () => {
    const presentes = readdirSync(FONTS)
    const restantes = ANCIENNES.filter((n) => presentes.includes(n))
    expect(
      restantes,
      'Ces fichiers de police ne servent plus depuis le changement du 17/08 : ils pèsent dans ' +
        "l'APK pour rien, et un @font-face oublié pourrait encore les résoudre.",
    ).toEqual([])
  })

  it('le dossier ne contient que les trois polices attendues', () => {
    const woff2 = readdirSync(FONTS).filter((n) => n.endsWith('.woff2'))
    expect(woff2.sort()).toEqual(Object.keys(ATTENDUES).sort())
  })

  // ── V2 ────────────────────────────────────────────────────────────────────────────────
  // Mutation : réintroduire 'Fraunces' dans --font-display.
  it('tokens.css ne cite plus aucune ancienne police', () => {
    const css = readFileSync(TOKENS, 'utf8')
    // Les anciens noms restent mentionnés dans le commentaire d'en-tête, qui raconte
    // POURQUOI le couple a changé — on ne cherche donc que les emplois réels : les deux
    // jetons et les src: url() des @font-face.
    const jetons = css.match(/--font-(display|ui):[^;]+;/g) || []
    expect(jetons, 'les deux jetons de police doivent exister').toHaveLength(2)
    for (const j of jetons) {
      expect(j).not.toMatch(/Fraunces|DM Sans/)
    }
    expect(jetons.join(' ')).toMatch(/'Literata'/)
    expect(jetons.join(' ')).toMatch(/'Source Sans 3'/)

    const sources = css.match(/src:\s*url\('\/fonts\/([^']+)'\)/g) || []
    const fichiersCites = sources.map((s) => s.match(/\/fonts\/([^']+)/)[1])
    expect(
      fichiersCites.sort(),
      'les @font-face doivent pointer exactement les trois fichiers posés',
    ).toEqual(Object.keys(ATTENDUES).sort())
  })

  // ── V4 ────────────────────────────────────────────────────────────────────────────────
  // Mutation : remettre `font-weight: 100 900` dans un @font-face.
  it('chaque @font-face déclare la plage de graisse RÉELLE des fichiers (200 900)', () => {
    const css = readFileSync(TOKENS, 'utf8')
    const plages = css.match(/@font-face\s*\{[^}]*\}/g).map((bloc) => {
      const m = bloc.match(/font-weight:\s*(\d+)\s+(\d+)/)
      return m ? { min: Number(m[1]), max: Number(m[2]) } : null
    })
    expect(plages, 'trois @font-face attendus').toHaveLength(3)
    for (const p of plages) {
      expect(
        p,
        'chaque @font-face doit déclarer une plage de graisse explicite (police variable)',
      ).not.toBeNull()
      expect(
        p,
        `Plage déclarée hors de l'axe réel des fichiers (${AXE_REEL.min}→${AXE_REEL.max}, ` +
          'mesuré au fontTools). Une plage trop large ne casse rien de visible : le navigateur ' +
          'CLAMPE en silence et toutes les graisses de l’app glissent.',
      ).toEqual(AXE_REEL)
    }
  })

  // ── Licences ──────────────────────────────────────────────────────────────────────────
  // L'app EMBARQUE les .woff2, donc elle les REDISTRIBUE : l'OFL exige que l'avis de droit
  // d'auteur et le texte de la licence accompagnent les fichiers. Manquement constaté le
  // 17/08 — il existait déjà avec Fraunces et DM Sans, et vaudrait pour n'importe quelle
  // police libre qu'on mettrait ensuite.
  it('le texte OFL de chaque police est posé à côté des fontes', () => {
    for (const nom of ['OFL-Literata.txt', 'OFL-SourceSans3.txt']) {
      const chemin = join(FONTS, nom)
      expect(existsSync(chemin), `public/fonts/${nom} est absent`).toBe(true)
      const texte = readFileSync(chemin, 'utf8')
      expect(texte).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/)
      expect(texte).toMatch(/PERMISSION & CONDITIONS/)
      expect(texte).toMatch(/Copyright/)
    }
  })
})
