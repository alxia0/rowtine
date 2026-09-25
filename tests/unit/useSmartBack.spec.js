// @vitest-environment jsdom
// Unitaire — retour « intelligent » : router.back() s’il y a un historique, sinon fallback.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const routerMock = vi.hoisted(() => ({ back: vi.fn(), push: vi.fn() }))
vi.mock('vue-router', () => ({ useRouter: () => routerMock }))

import { useSmartBack } from '@/composables/useSmartBack'

beforeEach(() => {
  routerMock.back.mockClear()
  routerMock.push.mockClear()
})

describe('useSmartBack', () => {
  it('revient en arrière quand l’historique a une page précédente', () => {
    window.history.replaceState({ back: '/' }, '')
    useSmartBack()()
    expect(routerMock.back).toHaveBeenCalledOnce()
    expect(routerMock.push).not.toHaveBeenCalled()
  })

  it('retombe sur le fallback (accueil) sans page précédente', () => {
    window.history.replaceState(null, '')
    useSmartBack()()
    expect(routerMock.push).toHaveBeenCalledWith({ name: 'home' })
    expect(routerMock.back).not.toHaveBeenCalled()
  })

  it('accepte un fallback personnalisé', () => {
    window.history.replaceState(null, '')
    useSmartBack({ name: 'library' })()
    expect(routerMock.push).toHaveBeenCalledWith({ name: 'library' })
  })
})
