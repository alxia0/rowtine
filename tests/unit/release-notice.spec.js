// Décision d'affichage du pop-up « Nouveautés » : fonction pure, sans store.
import { describe, it, expect } from 'vitest'
import { decideReleaseNotice } from '@/utils/release-notice'

const entries = [
  { version: '1.4.3', notes: ['a', 'b'] },
  { version: '1.4.2', notes: ['c'] },
  { version: '1.4.1', notes: ['d'] },
]
const base = { onboarded: true, lastSeenVersion: '1.4.0', currentVersion: '1.4.3', entries }

describe('decideReleaseNotice', () => {
  it('installation neuve : pas de pop-up, version enregistrée tout de suite', () => {
    expect(
      decideReleaseNotice({ ...base, onboarded: false, lastSeenVersion: null }),
    ).toEqual({ show: false, advance: true, entry: null })
  })

  it('installation existante sans version vue : pop-up, enregistrement à la fermeture', () => {
    const r = decideReleaseNotice({ ...base, lastSeenVersion: null })
    expect(r.show).toBe(true)
    expect(r.advance).toBe(false)
    expect(r.entry.version).toBe('1.4.3')
  })

  it('déjà à jour : rien à faire', () => {
    expect(decideReleaseNotice({ ...base, lastSeenVersion: '1.4.3' })).toEqual({
      show: false,
      advance: false,
      entry: null,
    })
  })

  it('versions sautées : seule l\'entrée de la version courante', () => {
    const r = decideReleaseNotice(base)
    expect(r.show).toBe(true)
    expect(r.entry.version).toBe('1.4.3')
    expect(r.entry.notes).toEqual(['a', 'b'])
  })

  it('sans entrée pour la version courante : on avance sans pop-up', () => {
    expect(
      decideReleaseNotice({ ...base, currentVersion: '1.4.4', lastSeenVersion: '1.4.3' }),
    ).toEqual({ show: false, advance: true, entry: null })
  })

  it('entrée vide : jamais de liste vide affichée', () => {
    expect(
      decideReleaseNotice({
        ...base,
        currentVersion: '1.4.4',
        lastSeenVersion: '1.4.3',
        entries: [{ version: '1.4.4', notes: [] }, ...entries],
      }),
    ).toEqual({ show: false, advance: true, entry: null })
  })
})
