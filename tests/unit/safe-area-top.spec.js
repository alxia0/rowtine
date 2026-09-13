// Garde de la zone sûre du HAUT, balayée sur toutes les vues.
//
// Contexte (retour device 09/08/2026, Pixel 7 sous Android 16) : depuis `targetSdk 35`
// Android impose le bord à bord — la WebView occupe l'écran entier, barre d'état comprise.
// Rien dans l'app ne réserve ce haut globalement : `.screen` (src/styles/tokens.css) ne
// gère que les côtés et le bas. C'est chaque EN-TÊTE qui réserve le haut, soit le composant
// partagé `AppHeader`, soit — pour les trois vues qui ont leur propre en-tête — un
// `--sa-top` écrit dans leur bloc `<style>`.
//
// Une vue sans en-tête ET sans `--sa-top` passe donc sous la barre d'état. C'était le cas de
// OnboardingView, seule vue dans ce cas au 09/08. Ce test ne rejoue pas ce cas précis (c'est
// le rôle de tests/e2e/onboarding-safe-area.spec.js, qui le mesure pour de vrai dans un
// navigateur) : il BALAIE, pour que la prochaine vue sans en-tête soit arrêtée à l'écriture
// plutôt que sur l'appareil de l'utilisatrice. Une liste de vues à surveiller aurait raté celle qui
// n'existe pas encore.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const DOSSIER = 'src/views'

// Les COMMENTAIRES sont retirés avant toute recherche. Écrite sans cette précaution, la
// garde ci-dessous ne mordait pas : le commentaire qui EXPLIQUE le correctif dans
// OnboardingView.vue contient lui-même « --sa-top », ce qui suffisait à la satisfaire. Une
// vue pourrait donc parler de la zone sûre sans la réserver, et passer au vert.
function sansCommentaires(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/[^\n]*/g, ' ')
}

function vues() {
  return readdirSync(resolve(DOSSIER))
    .filter((f) => f.endsWith('.vue'))
    .map((f) => ({ nom: f, code: sansCommentaires(readFileSync(resolve(DOSSIER, f), 'utf8')) }))
}

describe('zone sûre du haut — balayage des vues', () => {
  // Témoin : si le dossier était vide ou mal résolu, le test ci-dessous passerait sans rien
  // parcourir. Le seuil est volontairement bas (c'est un garde-fou, pas un inventaire à
  // maintenir : il ne casse pas quand une vue est ajoutée ou retirée).
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
