// Garde de la zone sûre du HAUT, balayée sur toutes les vues : depuis `targetSdk 35`, la
// WebView occupe l'écran entier, barre d'état comprise, et `.screen` ne réserve que les côtés
// et le bas. Chaque vue réserve le haut par `AppHeader` ou par un `--sa-top` dans son style ;
// sinon elle passe sous la barre d'état. On BALAIE pour arrêter aussi la prochaine vue.
// Le cas réel est mesuré dans tests/e2e/onboarding-safe-area.spec.js.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const DOSSIER = 'src/views'

// Les COMMENTAIRES sont retirés avant toute recherche : sinon un commentaire qui mentionne
// « --sa-top » suffirait à satisfaire la garde sans réserver la zone.
function sansCommentaires(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/[^\n]*/g, ' ')
}

function vues() {
  return readdirSync(resolve(DOSSIER))
    .filter((f) => f.endsWith('.vue'))
    .map((f) => ({ nom: f, code: sansCommentaires(readFileSync(resolve(DOSSIER, f), 'utf8')) }))
}

describe('zone sûre du haut — balayage des vues', () => {
  // Témoin : un dossier vide ou mal résolu ferait passer le test suivant sans rien parcourir.
  // Seuil volontairement bas, pas un inventaire à maintenir.
  it('trouve bien les vues à balayer', () => {
    expect(vues().length).toBeGreaterThan(10)
  })

  it('chaque vue réserve le haut, par un en-tête ou par var(--sa-top)', () => {
    const nues = vues()
      .filter(({ code }) => !code.includes('AppHeader') && !code.includes('var(--sa-top)'))
      .map(({ nom }) => nom)

    expect(nues).toEqual([])
  })
})
