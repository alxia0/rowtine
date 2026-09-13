// Unitaire — util copie presse-papiers (05/09/2026). Contrat : un
// booléen, JAMAIS d'exception ; voie primaire `navigator.clipboard.writeText`
// (contexte sécurisé Capacitor + clic = user activation), repli historique
// `textarea` + `document.execCommand('copy')`. On mock les deux surfaces web
// (jsdom n'implémente ni l'une ni l'autre réellement).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { copyToClipboard } = await import('@/utils/copy-to-clipboard')

// jsdom : `navigator.clipboard` n'existe pas par défaut. Descripteur conservé
// pour restaurer l'état EXACT entre tests (undefined compris — un simple
// `delete navigator.clipboard` ne marche pas sur un getter prototype).
let clipboardDescriptor
let execCommandOriginal

beforeEach(() => {
  clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  execCommandOriginal = document.execCommand
})

afterEach(() => {
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
  else delete navigator.clipboard
  if (execCommandOriginal) document.execCommand = execCommandOriginal
  else delete document.execCommand
  document.body.textContent = ''
})

function stubClipboard(writeText) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  })
}

describe('copyToClipboard', () => {
  it('emprunte navigator.clipboard.writeText et renvoie true', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard(writeText)
    document.execCommand = vi.fn()
    await expect(copyToClipboard('rapport')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('rapport')
    // La voie primaire a suffi : le repli n'a pas été tenté.
    expect(document.execCommand).not.toHaveBeenCalled()
  })

  it('writeText rejette : bascule sur le repli textarea + execCommand (true)', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')))
    document.execCommand = vi.fn().mockReturnValue(true)
    await expect(copyToClipboard('rapport')).resolves.toBe(true)
    expect(document.execCommand).toHaveBeenCalledWith('copy')
    // Le textarea de repli est retiré du DOM après usage — pas de déchet.
    expect(document.querySelectorAll('textarea')).toHaveLength(0)
  })

  it('execCommand renvoie false : false est remonté (jamais d’échec muet côté appelant)', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')))
    document.execCommand = vi.fn().mockReturnValue(false)
    await expect(copyToClipboard('rapport')).resolves.toBe(false)
  })

  it('execCommand lève : avalé, false est renvoyé', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')))
    document.execCommand = vi.fn().mockImplementation(() => {
      throw new Error('not implemented')
    })
    await expect(copyToClipboard('rapport')).resolves.toBe(false)
    // Même en échec, le textarea de repli est nettoyé.
    expect(document.querySelectorAll('textarea')).toHaveLength(0)
  })

  it('navigator.clipboard absent : va directement au repli', async () => {
    stubClipboard(null)
    document.execCommand = vi.fn().mockReturnValue(true)
    await expect(copyToClipboard('rapport')).resolves.toBe(true)
    expect(document.execCommand).toHaveBeenCalledWith('copy')
  })

  it('le repli sélectionne bien le texte transmis (textarea alimenté avant copie)', async () => {
    stubClipboard(null)
    let seen = null
    document.execCommand = vi.fn().mockImplementation(() => {
      seen = document.querySelector('textarea')?.value ?? null
      return true
    })
    await copyToClipboard('le rapport complet\nmulti-lignes')
    expect(seen).toBe('le rapport complet\nmulti-lignes')
  })
})
