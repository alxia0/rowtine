import { describe, it, expect } from 'vitest'
import { buildProjectWindow, aggregateProjectStats, formatDuration, projectYarnUsage } from '@/utils/project-stats'

describe('aggregateProjectStats', () => {
  const project = { id: 1, startedAt: '2026-01-05', finishedAt: '2026-01-19' }
  const sessions = [
    { projectId: 1, date: '2026-01-05T10:00:00.000Z', durationSec: 1800 },
    { projectId: 1, date: '2026-01-06T10:00:00.000Z', durationSec: 3600 },
    { projectId: 1, date: '2026-01-07T10:00:00.000Z', durationSec: 0 },
    { projectId: 1, date: '2026-01-12T10:00:00.000Z', durationSec: 2700 },
  ]

  it('agrège temps total, nombre de séances, pelotes et mètres utilisés', () => {
    const yarns = [
      { reservations: { 1: 2 }, consumed: {}, lengthM: 100 },
      { reservations: {}, consumed: { 1: 1 }, lengthM: '50,5' }, // virgule décimale (saisie ancienne)
      { reservations: { 2: 5 }, consumed: {}, lengthM: 999 }, // autre projet, ne compte pas
    ]
    const stats = aggregateProjectStats(project, sessions, yarns)
    expect(stats.sessionsCount).toBe(4)
    expect(stats.ballsUsed).toBe(3) // 2 réservées + 1 consommée, pour CE projet
    expect(stats.metersUsed).toBe(250.5) // 2×100 + 1×50,5
    expect(stats.totalSeconds).toBe(1800 + 3600 + 0 + 2700)
  })

  it('projectYarnUsage : une entrée par laine rattachée, jamais de total agrégé', () => {
    const yarns = [
      { id: 'a', brand: 'Drops', model: 'Merino', reservations: { 1: 2 }, consumed: {}, lengthM: 100 },
      { id: 'b', brand: 'Rico', model: 'Creative', reservations: {}, consumed: { 1: 1 }, lengthM: 50 },
      { id: 'c', brand: 'X', model: 'Y', reservations: { 2: 5 }, consumed: {}, lengthM: 10 }, // autre projet
      { id: 'd', brand: 'Z', model: 'W', reservations: { 1: 0 }, consumed: {}, lengthM: 10 }, // 0 pelote
    ]
    expect(projectYarnUsage(project, yarns)).toEqual([
      { yarn: yarns[0], balls: 2 },
      { yarn: yarns[1], balls: 1 },
    ])
  })

  it('projectYarnUsage : tableau vide sans laine liée (pas une exception)', () => {
    expect(projectYarnUsage(project, [])).toEqual([])
  })

  it('pelotes et mètres utilisés à 0 sans laine liée (pas une exception)', () => {
    const stats = aggregateProjectStats(project, sessions, [])
    expect(stats.ballsUsed).toBe(0)
    expect(stats.metersUsed).toBe(0)
  })

  it('pelote sans métrage renseigné : comptée dans ballsUsed, 0 mètre (pas une exception)', () => {
    const stats = aggregateProjectStats(project, sessions, [{ reservations: { 1: 2 }, consumed: {}, lengthM: '' }])
    expect(stats.ballsUsed).toBe(2)
    expect(stats.metersUsed).toBe(0)
  })

  it('marque un projet sans finishedAt comme en cours, fenetre bornee a aujourd hui', () => {
    const stats = aggregateProjectStats(
      { startedAt: '2026-01-05', finishedAt: '' },
      sessions,
      [],
      null, // pattern : 4e paramètre, aucun patron lié (cf. aggregateProjectStats)
      new Date(2026, 0, 20, 12),
    )
    expect(stats.ongoing).toBe(true)
    expect(stats.endDay).toBe('2026-01-20')
  })

  it('trouve la plus longue série de jours actifs consécutifs', () => {
    const stats = aggregateProjectStats(project, sessions, [])
    expect(stats.bestStreak).toBe(3) // 05, 06, 07
  })

  it('renvoie un agrégat à zéro (pas une exception) pour un projet sans session', () => {
    const stats = aggregateProjectStats({ startedAt: '2026-01-05', finishedAt: '2026-01-05' }, [], [])
    expect(stats.sessionsCount).toBe(0)
    expect(stats.totalSeconds).toBe(0)
    expect(stats.grid.columns.length).toBeGreaterThan(0)
  })
})

describe('rowsProgress (lecteur de patron)', () => {
  it('agrège rangs faits / rangs totaux depuis readerProgress, pas depuis les sections', () => {
    const project = { id: 1, readerState: { done: { 'a#0': true, 'a#1': true } } }
    const pattern = {
      reader: {
        sizeLabels: [],
        sections: [
          { id: 'a', kind: 'pelote', title: 'Devant', steps: [{ t: 'Rang 1' }, { t: 'Rang 2' }, { t: 'Rang 3' }] },
        ],
      },
    }
    const result = aggregateProjectStats(project, [], [], pattern)
    expect(result.rowsProgress).toEqual({ done: 2, total: 3 })
  })

  it('vaut null quand aucun patron n\'est lié', () => {
    const project = { id: 1 }
    const result = aggregateProjectStats(project, [], [], null)
    expect(result.rowsProgress).toBeNull()
  })

  it('vaut null quand le patron lié n\'a aucune étape comptable (que des notes/diagrammes)', () => {
    const project = { id: 1, readerState: {} }
    const pattern = {
      reader: { sizeLabels: [], sections: [{ id: 'a', kind: 'pelote', title: 'X', steps: [{ t: 'note', note: true }] }] },
    }
    const result = aggregateProjectStats(project, [], [], pattern)
    expect(result.rowsProgress).toBeNull()
  })
})

describe('buildProjectWindow', () => {
  it('replie sur la date de la session la plus ancienne si startedAt est vide', () => {
    const win = buildProjectWindow(
      { startedAt: '', finishedAt: '2026-01-10' },
      [{ date: '2026-01-03T08:00:00.000Z' }],
      new Date(2026, 0, 15),
    )
    expect(win.startDay).toBe('2026-01-03')
  })

  it('date de fin mal formée (sauvegarde retouchée) : fenêtre bornée, jamais de boucle infinie', () => {
    const win = buildProjectWindow({ startedAt: '2026-01-05', finishedAt: '2026-01-19T00:00:00.000Z' }, [], new Date(2026, 0, 25))
    expect(win.endDay).toBe('2026-01-19')
    expect(win.mondayDays).toHaveLength(3)
  })
})

describe('buildProjectWindow : dates aberrantes (sauvegarde retouchée)', () => {
  // Protège : une date déclarée ou une séance d'année hors plage ne produit jamais une fenêtre démesurée.
  it('finishedAt en 9999 et startedAt en l’an 1000 sont ignorées', () => {
    const win = buildProjectWindow({ startedAt: '1000-01-01', finishedAt: '9999-12-31' }, [], new Date(2026, 0, 15))
    expect(win.startDay).toBe('2026-01-15')
    expect(win.endDay).toBe('2026-01-15')
  })

  it('une séance datée 9999 n’étend pas la fenêtre', () => {
    const win = buildProjectWindow({ startedAt: '2026-01-05' }, [{ date: '9999-06-01T10:00:00.000Z' }], new Date(2026, 0, 15))
    expect(win.endDay).toBe('2026-01-15')
  })

  it('une fenêtre de plus d’un siècle est plafonnée en semaines', () => {
    const win = buildProjectWindow({ startedAt: '1901-01-01' }, [], new Date(2026, 0, 15))
    expect(win.mondayDays.length).toBeLessThanOrEqual(520)
    expect(win.mondayDays.at(-1)).toBe('2026-01-12')
  })
})

// Toute séance du projet compte dans le temps total, même hors des dates déclarées.
describe('séances hors des dates déclarées du projet', () => {
  it('séance antidatée avant startedAt, séance après finishedAt (projet rouvert) : comptées', () => {
    const stats = aggregateProjectStats(
      { id: 1, startedAt: '2026-09-20', finishedAt: '2026-09-22' },
      [
        { date: '2026-09-12T10:00:00.000Z', durationSec: 5400 },
        { date: '2026-09-21T10:00:00.000Z', durationSec: 1800 },
        { date: '2026-09-24T10:00:00.000Z', durationSec: 3600 },
      ],
      [],
      null,
      new Date(2026, 8, 25),
    )
    expect(stats.totalSeconds).toBe(5400 + 1800 + 3600)
    expect(stats.activeDaysCount).toBe(3)
    expect(stats.startDay).toBe('2026-09-12')
    expect(stats.endDay).toBe('2026-09-24')
  })
})

describe('formatDuration', () => {
  it('affiche les minutes seules sous une heure', () => {
    expect(formatDuration(1800)).toBe('30 min')
  })
  it('affiche des heures rondes sans minutes', () => {
    expect(formatDuration(7200)).toBe('2 h')
  })
  it('affiche heures et minutes', () => {
    expect(formatDuration(8100)).toBe('2 h 15 min')
  })
  it('n\'affiche jamais "60 min" ni un report de minutes manque pres d\'une heure pleine', () => {
    expect(formatDuration(7199)).toBe('2 h')
    expect(formatDuration(3590)).toBe('1 h')
  })
})
