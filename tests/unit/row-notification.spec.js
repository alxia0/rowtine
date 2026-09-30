// Contenu de la notification du rang en cours : rang, compteur, rappel de diagramme, étape suivante, cas sans notification.
import { describe, it, expect } from 'vitest'
import { createTestI18n } from './helpers/i18n-router.js'
import { withStepIds } from '../../src/utils/reader.js'
import { buildRowNotification, rowNotificationTarget, canApplyPendingRowTarget } from '../../src/utils/row-notification.js'

const i18n = createTestI18n()
const t = i18n.global.t

const reader = {
  sections: [
    { id: 'presentation', title: 'Présentation', steps: [{ t: 'Fournitures' }] },
    {
      id: 'devant',
      title: 'Devant',
      steps: [{ t: 'Monter {{0}} mailles', c: [[80, 90]] }, { t: 'Tricoter en jersey' }],
    },
    { id: 'dos', title: 'Dos', steps: [{ t: 'Rang un' }, { t: 'Rang deux' }] },
  ],
}
const project = { id: '7', name: 'Pull test' }
const build = (r, state) => buildRowNotification({ project, reader: r, state, t })

describe('buildRowNotification', () => {
  it('titre, texte brut selon la taille, projectId numérique, stepId et libellé', () => {
    const p = build(reader, { size: 1, done: { 'presentation#0': true } })
    expect(p.title).toBe(t('rowNotif.title', { index: 1, total: 2, section: 'Devant' }))
    expect(p.text).toBe('Monter 90 mailles')
    expect(p.projectId).toBe(7)
    expect(p.stepId).toBe('devant#0')
    expect(p.actionLabel).toBe(t('rowNotif.check'))
    expect(p.subText).toBe('Pull test')
    expect(p.channelName).toBe(t('rowNotif.channel'))
    expect(p.closedTitle).toBe(t('rowNotif.closedTitle'))
    expect(p.closedText).toBe(t('rowNotif.closedText'))
  })

  it('sans taille choisie, toutes les tailles', () => {
    const p = build(reader, { size: null, done: { 'presentation#0': true } })
    expect(p.text).toBe('Monter 80 (90) mailles')
  })

  it('rang suivant de la même section : rowNotif.next', () => {
    const p = build(reader, { size: 0, done: { 'presentation#0': true } })
    expect(p.bigText).toBe(`${p.text}\n\n${t('rowNotif.next', { text: 'Tricoter en jersey' })}`)
  })

  it('rang suivant dans une autre section : rowNotif.nextIn', () => {
    const p = build(reader, {
      size: 0,
      done: { 'presentation#0': true, 'devant#0': true },
    })
    expect(p.text).toBe('Tricoter en jersey')
    expect(p.bigText).toBe(
      `${p.text}\n\n${t('rowNotif.nextIn', { section: 'Dos', text: 'Rang un' })}`,
    )
  })

  it('dernier rang : bigText égal au texte', () => {
    const p = build(reader, {
      size: 0,
      done: { 'presentation#0': true, 'devant#0': true, 'devant#1': true, 'dos#0': true },
    })
    expect(p.title).toBe(t('rowNotif.title', { index: 2, total: 2, section: 'Dos' }))
    expect(p.text).toBe('Rang deux')
    expect(p.bigText).toBe(p.text)
  })

  it('section presentation : titre via reader.section.intro', () => {
    const p = build(reader, { size: 0, done: {} })
    expect(p.title).toBe(
      t('rowNotif.title', { index: 1, total: 1, section: t('reader.section.intro') }),
    )
  })

  it('tout coché ou aucun rang texte : null', () => {
    const all = {}
    for (const s of withStepIds(reader.sections)) for (const st of s.steps) all[st.id] = true
    expect(build(reader, { size: 0, done: all })).toBeNull()
    const chartOnly = { sections: [{ id: 'a', title: 'A', steps: [{ t: 'x', chart: {} }] }] }
    expect(build(chartOnly, { size: 0, done: {} })).toBeNull()
    expect(build({}, { size: 0, done: {} })).toBeNull()
  })
})

// Patron avec compteur de répétition, grille seule et grille rattachée à une section de rangs.
const mixed = {
  sections: [
    {
      id: 'dos',
      title: 'Dos',
      steps: [
        { t: 'Rang un' },
        { repeat: true, t: 'Répéter {{0}} fois', c: [[8, 10]], total: [8, 10] },
        { t: 'Rang deux' },
      ],
    },
    { id: 'motif', title: 'Motif', chart: { rows: 24, cols: 8 }, steps: [{ chart: true }] },
    { id: 'manche', title: 'Manche', steps: [{ note: true, t: 'n' }, { t: 'Rang manche' }] },
    {
      id: 'col',
      title: 'Col',
      chart: { rows: 0, cols: 4 },
      steps: [{ t: 'Rang col' }, { chart: true }, { t: 'Rang col deux' }],
    },
  ],
}
// État où l'étape en cours est `manche#1`, juste après la grille de `motif`.
const afterMotif = (extra = {}) => ({
  size: 0,
  done: { 'dos#0': true, 'dos#2': true },
  counters: { 'dos#1': 8 },
  ...extra,
})

describe('buildRowNotification : kind', () => {
  it('rang : kind row, position k/N parmi les étapes suivies, Ensuite vers le compteur', () => {
    const p = build(mixed, { size: 0, done: {}, counters: {} })
    expect(p.kind).toBe('row')
    expect(p.stepId).toBe('dos#0')
    expect(p.title).toBe(t('rowNotif.title', { index: 1, total: 3, section: 'Dos' }))
    expect(p.actionLabel).toBe(t('rowNotif.check'))
    expect(p.bigText).toBe(`Rang un\n\n${t('rowNotif.next', { text: 'Répéter 8 fois' })}`)
  })

  it('compteur : kind counter, valeur et total de la taille, stepper moins/plus, Ensuite', () => {
    const p = build(mixed, { size: 0, done: { 'dos#0': true }, counters: { 'dos#1': 3 } })
    expect(p.kind).toBe('counter')
    expect(p.stepId).toBe('dos#1')
    expect(p.title).toBe(t('rowNotif.counterTitle', { count: 3, total: 8, section: 'Dos' }))
    expect(p.text).toBe('Répéter 8 fois')
    expect(p.actionLabel).toBeUndefined()
    expect(p.counter).toEqual({
      label: t('rowNotif.counterLabel', { count: 3, total: 8 }),
      section: 'Dos',
      canMinus: true,
      minusLabel: t('reader.repeatMinus'),
      plusLabel: t('reader.repeatPlus'),
    })
    expect(p.bigText).toBe(`Répéter 8 fois\n\n${t('rowNotif.next', { text: 'Rang deux' })}`)
    expect(p.subText).toBe('Pull test')
    expect(p.projectId).toBe(7)
  })

  it('compteur sans taille choisie : total de toutes les tailles, comme le texte', () => {
    const p = build(mixed, { size: null, done: { 'dos#0': true }, counters: { 'dos#1': 3 } })
    expect(p.title).toBe(t('rowNotif.counterTitle', { count: 3, total: '8 (10)', section: 'Dos' }))
    expect(p.text).toBe('Répéter 8 (10) fois')
    expect(p.counter.label).toBe(t('rowNotif.counterLabel', { count: 3, total: '8 (10)' }))
  })

  it('compteur à 0 : bouton moins inactif', () => {
    const p = build(mixed, { size: 0, done: { 'dos#0': true }, counters: {} })
    expect(p.counter.label).toBe(t('rowNotif.counterLabel', { count: 0, total: 8 }))
    expect(p.counter.canMinus).toBe(false)
  })

  it('compteur à cadence : « tous les N rangs » après une virgule (repliée), sur sa ligne dans bigText et Ensuite', () => {
    const r = {
      sections: [
        {
          id: 'a',
          title: 'A',
          steps: [{ t: 'R0' }, { repeat: true, t: 'Diminuer', total: [6], every: 4 }, { t: 'R2' }],
        },
      ],
    }
    const cadence = t('reader.cadenceEvery', { every: 4 })
    const row = build(r, { size: 0, done: {} })
    expect(row.bigText).toBe(`R0\n\n${t('rowNotif.next', { text: `Diminuer\n${cadence}` })}`)
    const counter = build(r, { size: 0, done: { 'a#0': true } })
    expect(counter.kind).toBe('counter')
    expect(counter.text).toBe(`Diminuer, ${cadence}`)
    expect(counter.bigText).toBe(`Diminuer\n${cadence}\n\n${t('rowNotif.next', { text: 'R2' })}`)
  })

  it('rang : un compteur au total 0 pour la taille ne compte pas dans k/N', () => {
    const r = {
      sections: [{ id: 'a', title: 'A', steps: [{ repeat: true, t: 'x', total: [2, 0] }, { t: 'R1' }] }],
    }
    expect(build(r, { size: 1, done: {} }).title).toBe(
      t('rowNotif.title', { index: 1, total: 1, section: 'A' }),
    )
  })

  it('compteur : le total suit la taille choisie', () => {
    const p = build(mixed, { size: 1, done: { 'dos#0': true }, counters: { 'dos#1': 3 } })
    expect(p.title).toBe(t('rowNotif.counterTitle', { count: 3, total: 10, section: 'Dos' }))
    expect(p.text).toBe('Répéter 10 fois')
  })

  it('diagramme franchi : kind chart, stepId du diagramme, position de la grille, Ensuite vers l\'étape', () => {
    const p = build(mixed, afterMotif({ chartRows: { motif: 5 } }))
    expect(p.kind).toBe('chart')
    expect(p.stepId).toBe('motif#0')
    expect(p.title).toBe(t('rowNotif.chartTitle', { section: 'Motif' }))
    expect(p.text).toBe(t('rowNotif.chartRow', { row: 5, rows: 24 }))
    expect(p.actionLabel).toBe(t('rowNotif.chartDone'))
    expect(p.bigText).toBe(
      `${p.text}\n\n${t('rowNotif.nextIn', { section: 'Manche', text: 'Rang manche' })}`,
    )
  })

  it('grille aux rangs connus sans position enregistrée : rang 1, comme le lecteur', () => {
    expect(build(mixed, afterMotif()).text).toBe(t('rowNotif.chartRow', { row: 1, rows: 24 }))
  })

  it('grille sans nombre de rangs : chartText', () => {
    const colState = { size: 0, done: { 'dos#0': true, 'dos#2': true, 'manche#1': true, 'col#0': true }, counters: { 'dos#1': 8 }, chartRows: { col: 3 } }
    const p = build(mixed, colState)
    expect(p.kind).toBe('chart')
    expect(p.stepId).toBe('col#1')
    expect(p.text).toBe(t('rowNotif.chartText'))
    expect(p.bigText).toBe(`${p.text}\n\n${t('rowNotif.next', { text: 'Rang col deux' })}`)
  })

  it('grille héritée (reader.chart, sans grille de section) : position lue sur reader.chart', () => {
    const legacy = {
      chart: { rows: 12, cols: 4 },
      sections: [{ id: 'g', title: 'G', steps: [{ chart: true }] }, { id: 'b', title: 'B', steps: [{ t: 'R' }] }],
    }
    expect(build(legacy, { size: 0, done: {}, chartRows: { g: 2 } }).text).toBe(
      t('rowNotif.chartRow', { row: 2, rows: 12 }),
    )
  })

  it('diagramme acquitté (Set ou tableau) : l\'étape en cours, sans rappel', () => {
    for (const chartAcks of [new Set(['motif#0']), ['motif#0']]) {
      const p = build(mixed, afterMotif({ chartAcks }))
      expect(p.kind).toBe('row')
      expect(p.stepId).toBe('manche#1')
    }
  })

  it('compteur sans répétition pour la taille entre le diagramme et l\'étape : rappel', () => {
    const r = {
      sections: [
        { id: 'g', title: 'G', chart: { rows: 4 }, steps: [{ chart: true }] },
        { id: 'b', title: 'B', steps: [{ repeat: true, t: 'x', total: [2, 0] }, { t: 'R' }] },
      ],
    }
    expect(build(r, { size: 1, done: {} })).toMatchObject({ kind: 'chart', stepId: 'g#0' })
  })

  it('diagramme invisible pour la taille : aucun rappel', () => {
    const p = build(mixed, afterMotif({ isChartVisible: (sec) => sec.id !== 'motif' }))
    expect(p.kind).toBe('row')
    expect(p.stepId).toBe('manche#1')
  })

  it('patron fini (rangs cochés, compteurs atteints ou à 0 pour la taille) : null', () => {
    const done = { 'dos#0': true, 'dos#2': true, 'manche#1': true, 'col#0': true, 'col#2': true }
    expect(build(mixed, { size: 0, done, counters: { 'dos#1': 8 } })).toBeNull()
    const zero = { sections: [{ id: 'a', title: 'A', steps: [{ t: 'R' }, { repeat: true, t: 'x', total: [2, 0] }] }] }
    expect(build(zero, { size: 1, done: { 'a#0': true }, counters: {} })).toBeNull()
  })
})

describe('rowNotificationTarget', () => {
  const home = { name: 'home', params: {} }
  const reading = (id) => ({ name: 'project-read', params: { id } })

  it('projet existant, ailleurs dans l\'app : route du lecteur, id en chaîne', () => {
    expect(rowNotificationTarget(7, home, true)).toEqual({ name: 'project-read', params: { id: '7' } })
  })

  it('lecteur d\'un autre projet : navigue vers le bon', () => {
    expect(rowNotificationTarget(7, reading('8'), true)).toEqual({
      name: 'project-read',
      params: { id: '7' },
    })
  })

  it('déjà dans le lecteur de ce projet : null', () => {
    expect(rowNotificationTarget(7, reading('7'), true)).toBeNull()
  })

  it('projectId absent ou projet inexistant : null', () => {
    expect(rowNotificationTarget(null, home, true)).toBeNull()
    expect(rowNotificationTarget(undefined, home, true)).toBeNull()
    expect(rowNotificationTarget(7, home, false)).toBeNull()
  })
})

describe('canApplyPendingRowTarget', () => {
  const ok = { startupDone: true, onboarded: true, activeNotice: null }

  it('démarrage fini, onboarding fait, file libre : oui', () => {
    expect(canApplyPendingRowTarget(ok)).toBe(true)
  })

  it('démarrage en cours, onboarding pas fait ou message affiché : non', () => {
    expect(canApplyPendingRowTarget({ ...ok, startupDone: false })).toBe(false)
    expect(canApplyPendingRowTarget({ ...ok, onboarded: false })).toBe(false)
    expect(canApplyPendingRowTarget({ ...ok, activeNotice: 'folderGate' })).toBe(false)
  })
})
