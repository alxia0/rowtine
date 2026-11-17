// Garde-fou : chaque langue du journal doit avoir une entrée non vide pour la version
// courante, sinon le pop-up « Nouveautés » resterait muet après une mise à jour.
import { describe, it, expect } from 'vitest'
import { APP_VERSION } from '@/constants/app-info'
import { RELEASE_NOTES_FR } from '@/content/release-notes.fr'
import { RELEASE_NOTES_EN } from '@/content/release-notes.en'
import { RELEASE_NOTES_DE } from '@/content/release-notes.de'
import { RELEASE_NOTES_ES } from '@/content/release-notes.es'

describe('journal : entrée de la version courante', () => {
  it.each([
    ['FR', RELEASE_NOTES_FR],
    ['EN', RELEASE_NOTES_EN],
    ['DE', RELEASE_NOTES_DE],
    ['ES', RELEASE_NOTES_ES],
  ])('%s a au moins une note pour APP_VERSION', (_langue, notes) => {
    expect(notes.find((e) => e.version === APP_VERSION)?.notes.length).toBeGreaterThan(0)
  })
})
