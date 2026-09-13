// Unitaire — le bouton retour Android face à LA PORTE du dossier (09/08/2026).
// La porte n'a aucun bouton de fermeture : sans ce câblage, le retour naviguerait
// DERRIÈRE elle — l'app changerait d'écran sous un voile qu'on ne peut pas lever.
// Elle doit donc QUITTER l'app, et rien d'autre ne doit intercepter avant.
import { describe, it, expect, vi } from 'vitest'
import { folderGateHandlesBack } from '@/utils/folder-gate-back'

describe('folderGateHandlesBack', () => {
  it('porte visible : quitte l\'app et signale avoir traité le geste', () => {
    const exitApp = vi.fn()
    const handled = folderGateHandlesBack({ visible: true }, { exitApp })
    expect(handled).toBe(true)
    expect(exitApp).toHaveBeenCalled()
  })

  it('porte absente : ne fait rien, laisse passer', () => {
    const exitApp = vi.fn()
    const handled = folderGateHandlesBack({ visible: false }, { exitApp })
    expect(handled).toBe(false)
    expect(exitApp).not.toHaveBeenCalled()
  })

  // La ref n'est pas encore montée (premier tick) : ne pas planter, ne pas quitter.
  it('référence absente : ne fait rien, laisse passer', () => {
    const exitApp = vi.fn()
    expect(folderGateHandlesBack(null, { exitApp })).toBe(false)
    expect(folderGateHandlesBack(undefined, { exitApp })).toBe(false)
    expect(exitApp).not.toHaveBeenCalled()
  })

  // Chemin web/dev : pas de plugin @capacitor/app. Ne pas planter — mais AVALER quand
  // même le geste, sinon la navigation reprend derrière la porte.
  it('sans plugin natif : avale le geste sans planter', () => {
    expect(folderGateHandlesBack({ visible: true }, null)).toBe(true)
  })
})

// (décision produit du 05/09/2026) : la porte ouverte DEPUIS LES RÉGLAGES
// (mode 'change') ne doit JAMAIS quitter l'app — le retour la REFERME et consomme le
// geste. `mode` absent (substitut ancien, instance incomplète) vaut le mode d'origine :
// jamais plus permissif que l'ancien comportement.
describe('folderGateHandlesBack — mode change', () => {
  it('porte visible en mode change : referme (closeFromBack), consomme le geste, ne quitte PAS l\'app', () => {
    const exitApp = vi.fn()
    const closeFromBack = vi.fn()
    const handled = folderGateHandlesBack({ visible: true, mode: 'change', closeFromBack }, { exitApp })
    expect(handled).toBe(true)
    expect(closeFromBack).toHaveBeenCalled()
    expect(exitApp).not.toHaveBeenCalled()
  })

  it('mode change sans closeFromBack exposé : geste consommé sans planter, sans quitter', () => {
    const exitApp = vi.fn()
    const handled = folderGateHandlesBack({ visible: true, mode: 'change' }, { exitApp })
    expect(handled).toBe(true)
    expect(exitApp).not.toHaveBeenCalled()
  })

  it('mode explicite \'onboarding\' : quitte l\'app, comme avant', () => {
    const exitApp = vi.fn()
    const closeFromBack = vi.fn()
    const handled = folderGateHandlesBack({ visible: true, mode: 'onboarding', closeFromBack }, { exitApp })
    expect(handled).toBe(true)
    expect(exitApp).toHaveBeenCalled()
    expect(closeFromBack).not.toHaveBeenCalled()
  })

  it('mode absent : quitte l\'app (comportement premier lancement inchangé)', () => {
    const exitApp = vi.fn()
    const handled = folderGateHandlesBack({ visible: true }, { exitApp })
    expect(handled).toBe(true)
    expect(exitApp).toHaveBeenCalled()
  })
})
