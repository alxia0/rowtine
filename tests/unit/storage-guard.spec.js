import { describe, expect, it, vi } from 'vitest'
import { handleStorageError, storageAwareErrorHandler } from '@/db/storage-guard'

describe('handleStorageError', () => {
  it('affiche un snackbar sur erreur de quota et renvoie true', () => {
    const snackbar = { show: vi.fn() }
    const handled = handleStorageError({ name: 'QuotaExceededError' }, snackbar)
    expect(handled).toBe(true)
    expect(snackbar.show).toHaveBeenCalledTimes(1)
    // le message provient d'i18n (FR par défaut)
    expect(snackbar.show.mock.calls[0][0]).toContain('Espace insuffisant')
  })

  it('ignore les erreurs non liées au stockage', () => {
    const snackbar = { show: vi.fn() }
    const handled = handleStorageError(new TypeError('boom'), snackbar)
    expect(handled).toBe(false)
    expect(snackbar.show).not.toHaveBeenCalled()
  })
})

describe('storageAwareErrorHandler', () => {
  it('route une erreur de quota vers le snackbar, pas la console', () => {
    const snackbar = { show: vi.fn() }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    storageAwareErrorHandler(snackbar)({ name: 'QuotaExceededError' })
    expect(snackbar.show).toHaveBeenCalledTimes(1)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
  it('laisse passer les autres erreurs vers la console', () => {
    const snackbar = { show: vi.fn() }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = new TypeError('boom')
    storageAwareErrorHandler(snackbar)(err)
    expect(snackbar.show).not.toHaveBeenCalled()
    expect(spy).toHaveBeenCalledWith(err)
    spy.mockRestore()
  })
})
