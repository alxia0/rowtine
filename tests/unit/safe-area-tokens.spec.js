import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '../../src')
const TOKENS = resolve(SRC, 'styles/tokens.css')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name !== 'node_modules') walk(p, out)
    } else if (/\.(vue|css)$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

describe('insets d’écran sûrs', () => {
  it('tokens.css définit les 4 variables avec env() en valeur de repli', () => {
    const css = readFileSync(TOKENS, 'utf8')
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(css).toMatch(
        new RegExp(`--sa-${side}:\\s*env\\(safe-area-inset-${side},\\s*0px\\)`),
      )
    }
  })

  it('aucun autre fichier n’appelle env(safe-area-inset-*) en direct', () => {
    const coupables = walk(SRC)
      .filter((p) => p !== TOKENS)
      .filter((p) => /env\(\s*safe-area-inset-/.test(readFileSync(p, 'utf8')))
      .map((p) => p.slice(SRC.length + 1))
    expect(coupables).toEqual([])
  })
})
