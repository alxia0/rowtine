// Règle de l'état « sélectionné » (charte §2.6, documentée le 16/07) :
//   --sage  = un choix qui me concerne (langue, technique, ma taille)
//   --brand = un filtre / un mode / l'état d'un objet (période, calculateur, statut, onglets)
// Ce test verrouille la règle pour qu'un futur écran ne la casse pas par inadvertance.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const lire = (p) => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('règle de couleur de l’état sélectionné', () => {
  it('la taille choisie dans le lecteur est en vert (c’est MA taille)', () => {
    expect(lire('src/views/ReaderView.vue')).toContain('--sage-tile-bg')
  })

  it('le statut du projet sélectionné est en terracotta (état d’un objet)', () => {
    const css = lire('src/views/ProjectEditView.vue')
    expect(css).toMatch(/\.chip--on[^}]*background:\s*var\(--brand\)/s)
  })

  it('le mode du calculateur sélectionné est en terracotta (mode d’affichage)', () => {
    const css = lire('src/views/CalculatorView.vue')
    expect(css).toMatch(/\.toggle__opt--on[^}]*background:\s*var\(--brand\)/s)
  })

  it('la technique choisie à l’onboarding est en vert (préférence perso)', () => {
    expect(lire('src/views/OnboardingView.vue')).toMatch(/background:\s*var\(--sage\)/)
  })
})
