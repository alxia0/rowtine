// Unitaire — le bouton retour Android face au garde-fou de version (dernière passe de
// correction avant la 1.0, 13/08/2026).
// Le dialogue n'a aucune fermeture volontaire sur le voile : sans ce câblage, Retour
// naviguerait derrière lui ou quitterait l'app, et le message réapparaîtrait sur
// l'écran suivant — le seul calque bloquant de la chaîne à ne pas être couvert.
import { describe, it, expect } from 'vitest'
import { versionGuardHandlesBack } from '@/utils/version-guard-back'

describe('versionGuardHandlesBack', () => {
  it('garde-fou affiché : avale le geste, signale avoir traité', () => {
    expect(versionGuardHandlesBack({ triggered: true })).toBe(true)
  })

  it('garde-fou non affiché : ne fait rien, laisse passer', () => {
    expect(versionGuardHandlesBack({ triggered: false })).toBe(false)
  })

  // État absent (pas encore monté, ou appelé sans argument) : ne pas planter, laisser
  // passer — même parade défensive que `folderGateHandlesBack`.
  it('état absent : ne fait rien, laisse passer', () => {
    expect(versionGuardHandlesBack(null)).toBe(false)
    expect(versionGuardHandlesBack(undefined)).toBe(false)
  })
})
