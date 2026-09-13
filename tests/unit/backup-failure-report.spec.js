// Unitaire — compositeur du rapport d'échec copiable (05/09/2026).
// Fonction pure : on pilote date, version et build par paramètres, sans
// horloge ni mock — c'est tout l'intérêt du contrat.
import { describe, expect, it } from 'vitest'

const { composeBackupFailureReport } = await import('@/backup/failure-report')

// Date LOCALE construite champ par champ : les assertions ne dépendent ni du
// fuseau de la machine ni d'un rollover UTC→local (un `new Date('…Z')` pourrait
// tomber sur une autre date une fois converti).
const LOCAL_AT = new Date(2026, 8, 5, 18, 42, 10) // 05/09/2026 18:42:10 locale

describe('composeBackupFailureReport', () => {
  const report = (failure) => composeBackupFailureReport(failure)

  it('compose les cinq sections : contexte, date, version, dossier, erreur', () => {
    const lines = report({
      error: 'EIO: write failed',
      path: 'Documents/Rowtine',
      at: LOCAL_AT,
      version: '1.0',
      build: 1,
    }).split('\n')
    expect(lines[0]).toBe('Enregistrement automatique des données Rowtine — échec')
    expect(lines[2]).toBe("Version de l'app : 1.0 (build 1)")
    expect(lines[3]).toBe('Dossier : Documents/Rowtine')
    expect(lines[4]).toBe('Erreur :')
    expect(lines[5]).toBe('EIO: write failed')
  })

  it('date/heure locale ISO avec décalage de fuseau explicite', () => {
    const dateLine = report({ error: 'x', path: 'p', at: LOCAL_AT }).split('\n')[1]
    // Heure locale reproduite telle quelle (pas de saut UTC) + suffixe ±HH:MM.
    expect(dateLine).toMatch(/^Date : 2026-09-05T18:42:10[+-]\d{2}:\d{2}$/)
  })

  it('accepte `at` en chaîne ISO (format publié par le store)', () => {
    const at = new Date(2026, 8, 5, 9, 0, 0).toISOString()
    const dateLine = report({ error: 'x', path: 'p', at }).split('\n')[1]
    expect(dateLine).toMatch(/^Date : \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
  })

  it('le message d’erreur est repris INTÉGRAL, retours à la ligne compris', () => {
    const text = report({ error: 'ligne 1\nligne 2\nligne 3', path: 'p', at: LOCAL_AT })
    expect(text).toContain('Erreur :\nligne 1\nligne 2\nligne 3')
  })

  it('chemin inconnu (null) : dit « (inconnu) » au lieu d’un trou silencieux', () => {
    const text = report({ error: 'x', path: null, at: LOCAL_AT })
    expect(text).toContain('Dossier : (inconnu)')
  })

  it('reste collable même avec une date illisible : recopie la valeur reçue', () => {
    const text = report({ error: 'x', path: 'p', at: 'pas-une-date' })
    expect(text).toContain('Date : pas-une-date')
  })
})

// GÉNÉRALISATION (même décision du 05/09) : le compositeur sert aussi
// la restauration — paramètre `title` (contexte) et `details` (écarts readBackup).
describe('composeBackupFailureReport — généralisation A1', () => {
  it('title surcharge la première ligne (le défaut A2 reste intact)', () => {
    const text = composeBackupFailureReport({ error: 'x', path: 'p', title: 'Restauration des données — échec' })
    expect(text.split('\n')[0]).toBe('Restauration des données — échec')
  })

  it('details (objets readBackup) est normalisé en section « Écarts » lisible en texte brut', () => {
    const text = composeBackupFailureReport({
      error: 'x',
      path: 'p',
      details: [{ where: 'Patrons/x [9]', code: 'ENTITY_REJECTED' }, { where: 'Photos', error: 'EACCES' }],
    })
    expect(text).toContain('Écarts :\n- Patrons/x [9] : ENTITY_REJECTED\n- Photos : EACCES')
  })

  it('details vides ou absents : aucune section « Écarts » (le rapport A2 garde sa forme)', () => {
    expect(composeBackupFailureReport({ error: 'x', path: 'p' })).not.toContain('Écarts')
    expect(composeBackupFailureReport({ error: 'x', path: 'p', details: [] })).not.toContain('Écarts')
  })

  it('écart exotique (chaîne déjà formée, objet sans where) : reste collable', () => {
    const text = composeBackupFailureReport({ error: 'x', path: 'p', details: ['écart libre', {}] })
    expect(text).toContain('- écart libre')
    expect(text).toContain('- (destination inconnue) : (raison non consignée)')
  })
})
