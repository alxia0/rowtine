// Le grand chiffre du compteur aligne ses chiffres.
//
// Le défaut, vu à l'image le 17/08/2026 : sur `.ccard__val`, le `1` est plus
// étroit que le `8`. Le nombre change donc de largeur à chaque appui et danse
// entre les boutons `−` et `+`. C'est l'élément le plus gros et le plus regardé
// de l'app, et c'était le seul gros chiffre sans `tabular-nums`.
//
// ⚠️ Pourquoi ce défaut était invisible avant le 17/08 : AUCUNE des deux polices
// d'alors (Fraunces, DM Sans) ne savait aligner les chiffres. Depuis le passage à
// Literata, la police porte la feature `tnum` — la déclaration CSS a enfin un effet.
// Ce test tient donc DEUX choses ensemble : la déclaration, et la police qui la sert.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const lire = (p) => readFileSync(resolve(process.cwd(), p), 'utf8')

// Isole le bloc `.ccard__val { ... }` du reste du composant.
const blocValeur = (css) => {
  const m = css.match(/\.ccard__val\s*\{([^}]*)\}/s)
  return m ? m[1] : ''
}

describe('le grand chiffre du compteur aligne ses chiffres', () => {
  const sfc = lire('src/components/CounterCard.vue')

  it('.ccard__val déclare font-variant-numeric: tabular-nums', () => {
    expect(blocValeur(sfc)).toMatch(/font-variant-numeric:\s*tabular-nums/)
  })

  it('.ccard__val garde la police de titrage, celle qui porte la feature tnum', () => {
    // Sans Literata (--font-display), `tabular-nums` n'a rien à activer : la
    // déclaration resterait vraie et le chiffre danserait quand même.
    expect(blocValeur(sfc)).toMatch(/font-family:\s*var\(--font-display\)/)
  })
})
