// (retour terrain, Nexus 7, second tour) — constat : « le bandeau
// Annuler/Enregistrer (.correct__actions) est trop haut ». Correctif 2 : padding
// vertical abaissé de --sp-3 (12px) à --sp-2 (8px), boutons de 48px à 44px (la
// cible tactile MINIMALE du projet, jamais en dessous — contrainte globale du
// projet). `padding-bottom` reste lié à `--sa-bottom` (encoche bas d'écran), intact.
//
// Scrape le SOURCE CSS : jsdom ne fait pas de mise en page, `getComputedStyle` y est
// aveugle aux déclarations. La mesure RÉELLE (rendu, chevauchement avec les flèches) est couverte
// par la reproduction Playwright, pas reproductible en unitaire
// (ResizeObserver absent de jsdom, cf. tests/unit/setup.js).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const componentSrc = readFileSync(resolve(process.cwd(), 'src/views/CorrectionView.vue'), 'utf8')

function ruleBody(css, selector) {
  const re = new RegExp(selector.replace(/[.[\]]/g, '\\$&') + '\\s*\\{([\\s\\S]*?)\\n\\}', 'm')
  const m = css.match(re)
  if (!m) throw new Error(`règle introuvable : ${selector}`)
  return m[1]
}

function declValue(body, prop) {
  const m = body.match(new RegExp(`(?:^|\\s)${prop}\\s*:\\s*([^;]+);`))
  if (!m) throw new Error(`déclaration introuvable : ${prop}`)
  return m[1].replace(/\s+/g, ' ').trim()
}

describe('CorrectionView — .correct__actions, bandeau Annuler/Enregistrer abaissé', () => {
  const actionsBody = ruleBody(componentSrc, '.correct__actions')
  const btnBody = ruleBody(componentSrc, '.correct__actions .btn')

  it('padding-bottom reste lié à --sa-bottom (encoche bas d’écran), avec --sp-2', () => {
    expect(declValue(actionsBody, 'padding-bottom')).toBe('calc(var(--sp-2) + var(--sa-bottom))')
  })

  it('les boutons passent de 48px à 44px — jamais en dessous (cible tactile minimale du plan)', () => {
    const minHeight = declValue(btnBody, 'min-height')
    expect(minHeight).toBe('44px')
    expect(parseFloat(minHeight)).toBeGreaterThanOrEqual(44)
  })
})
