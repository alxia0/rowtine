// @vitest-environment jsdom
// Unitaire — une séance saisie AU JOUR désigne un JOUR LOCAL, pas un instant (§9).
// Forme de bascule de fuseau reprise TELLE QUELLE de tests/unit/date-format.spec.js:26-47
// (mesurée le 08/08) : `process.env.TZ` prend effet à chaud dans ce Node quand il est posé
// dans un beforeEach. Une affectation en tête de fichier ne marcherait PAS : Vitest hisse les
// imports au-dessus des instructions du module.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import i18n from '@/i18n'
import { localDayToDate } from '@/utils/date-format'
import { ymdLocal } from '@/utils/time-periods'

describe('localDayToDate — à l’ouest de Greenwich', () => {
  const TZ_ORIGINE = process.env.TZ
  beforeEach(() => {
    process.env.TZ = 'America/Los_Angeles'
  })
  afterEach(() => {
    if (TZ_ORIGINE === undefined) delete process.env.TZ
    else process.env.TZ = TZ_ORIGINE
  })

  it('TÉMOIN : l’ancienne façon de faire se trompe de jour ICI — sinon ce fichier ne prouve rien', () => {
    // Cette assertion est FAUSSE depuis la France : elle ne peut passer que si la bascule de
    // fuseau a réellement eu lieu. C'est le garde-fou de tout le reste du fichier.
    expect(ymdLocal(new Date('2026-08-10'))).toBe('2026-08-09')
  })

  it('un 10 août saisi reste un 10 août relu en local', () => {
    expect(ymdLocal(localDayToDate('2026-08-10'))).toBe('2026-08-10')
  })

  it('midi : aucune bascule d’heure d’été ne fait changer le jour', () => {
    // 8 mars 2026 = passage à l'heure d'été aux États-Unis ; 1er novembre 2026 = retour à
    // l'heure d'hiver. Midi est le seul point du jour qu'aucune des deux ne déplace.
    expect(ymdLocal(localDayToDate('2026-03-08'))).toBe('2026-03-08')
    expect(ymdLocal(localDayToDate('2026-11-01'))).toBe('2026-11-01')
  })
})

describe('localDayToDate — témoin parisien (fuseau de la machine)', () => {
  it('un 10 août saisi reste un 10 août', () => {
    expect(ymdLocal(localDayToDate('2026-08-10'))).toBe('2026-08-10')
  })

  it('depuis la France, même l’ancienne façon de faire tombait juste — d’où le témoin ci-dessus', () => {
    expect(ymdLocal(new Date('2026-08-10'))).toBe('2026-08-10')
  })
})

// ─── Les deux sites d'écriture, AU NIVEAU DU COMPOSANT ──────────────────────
// Un test sur la fonction pure ne prouve pas que les vues l'appellent. Écart assumé :
// l'exemple envisagé proposait `createTestingPinia` + espionnage des
// actions de store (`useSessionsStore().add.mock.calls`), mais `ProjectDetailView.vue`
// charge son projet et ses séances via des actions RÉELLES au montage (`loadAll` appelle
// `sessionsStore.loadForProject`) — les stubber aurait empêché le composant de s'afficher
// (leçon « inventer un échafaudage a déjà coûté trois fixtures cassées »). L'échafaudage
// RÉEL de ce composant, mesuré dans tests/unit/ProjectDetailView.spec.js (Pinia + base
// Dexie réelle, routeur simulé), est repris ici à l'identique ; la preuve que chaque site
// range le bon jour se lit dans la base après l'interaction, pas dans un espion de store.
const nav = vi.hoisted(() => ({
  route: { params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({ useRoute: () => nav.route, useRouter: () => nav.router }))

import ProjectDetailView from '@/views/ProjectDetailView.vue'

async function seedProject(extra = {}) {
  const pid = await db.projects.add({
    name: 'Pull torsadé',
    technique: 'knitting',
    status: 'wip',
    sizes: [],
    ...extra,
  })
  nav.route.params = { id: String(pid) }
  nav.route.query = {}
  return pid
}

function mountDetail() {
  return mount(ProjectDetailView, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: { StatusBadge: true, CounterCard: true, CounterForm: true },
    },
  })
}

describe('les deux sites d’écriture d’une séance rangent le bon jour (composant, America/Los_Angeles)', () => {
  const TZ_ORIGINE = process.env.TZ
  beforeEach(async () => {
    process.env.TZ = 'America/Los_Angeles'
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map((t) => t.clear()))
  })
  afterEach(() => {
    if (TZ_ORIGINE === undefined) delete process.env.TZ
    else process.env.TZ = TZ_ORIGINE
  })

  it('TÉMOIN composant : ce fuseau est bien actif pendant le montage', () => {
    expect(ymdLocal(new Date('2026-08-10'))).toBe('2026-08-09')
  })

  it('CRÉATION : une séance saisie au 10 août est enregistrée au 10 août', async () => {
    await seedProject()
    const w = mountDetail()
    await flushPromises()

    await w.find('#tab-sessions').trigger('click')
    await flushPromises()
    await w.find('.sessions-tab .btn--block').trigger('click')
    await w.find('#sd').setValue('2026-08-10')
    await w.find('#sm').setValue('30')
    await w.find('.addform .btn--primary').trigger('click')
    await flushPromises()

    const rows = await db.sessions.toArray()
    expect(rows).toHaveLength(1)
    expect(ymdLocal(new Date(rows[0].date))).toBe('2026-08-10')
  })

  it('MODIFICATION : une séance rectifiée au 10 août reste au 10 août', async () => {
    const pid = await seedProject()
    // Séance existante à une date quelconque, éloignée du 10 août pour ne pas coïncider
    // avec la valeur qu'on va y écrire.
    const sid = await db.sessions.add({
      projectId: pid,
      sectionId: null,
      date: '2026-01-05T12:00:00.000Z',
      durationSec: 600,
      rowsDone: 0,
      manual: true,
    })
    const w = mountDetail()
    await flushPromises()

    await w.find('#tab-sessions').trigger('click')
    await flushPromises()
    await w.find('.ses-row__edit').trigger('click')
    await w.find('.addform input[type="date"]').setValue('2026-08-10')
    await w.find('.addform .btn--primary').trigger('click')
    await flushPromises()

    const row = await db.sessions.get(sid)
    expect(ymdLocal(new Date(row.date))).toBe('2026-08-10')
  })

  // Correction demandée après revue (10/08) : elle
  // répare l'ÉCRITURE (`saveEditSession`), mais la RELECTURE (`startEditSession`) repeuplait
  // le champ avec `(s.date || '').slice(0, 10)` — le jour UTC de la chaîne ISO, pas le jour
  // LOCAL que la grille affichera (même défaut de classe que la contrainte globale 7, côté
  // lecture). Une séance ancienne enregistrée à minuit UTC (la forme que produisait l'ANCIEN
  // code, avant ce correctif d'écriture) est le cas qui mord : à Los Angeles
  // son jour local est la VEILLE du jour UTC.
  // Séparés en deux `it` distincts (revue du 10/08) : dans un seul test, la mutation qui
  // casse le repeuplement du champ interrompt l'exécution avant d'atteindre l'assertion sur
  // l'enregistrement — celle-ci ne mordait donc JAMAIS isolément. Chaque test refait son
  // propre seed + montage pour rester indépendant de l'autre.
  it('RECTIFICATION — champ repeuplé : porte le jour LOCAL (celui de la grille), pas le jour UTC tronqué', async () => {
    const pid = await seedProject()
    await db.sessions.add({
      projectId: pid,
      sectionId: null,
      date: '2026-08-10T00:00:00.000Z', // minuit UTC : jour LOCAL à Los Angeles = 9 août
      durationSec: 600,
      rowsDone: 0,
      manual: true,
    })
    const w = mountDetail()
    await flushPromises()

    await w.find('#tab-sessions').trigger('click')
    await flushPromises()
    await w.find('.ses-row__edit').trigger('click')

    // Le champ repeuplé doit porter '2026-08-09' (jour LOCAL, celui que `ymdLocal` — et donc
    // la grille — donnera à cette séance), PAS '2026-08-10' (jour UTC tronqué par l'ancien
    // `.slice(0, 10)`).
    expect(w.find('.addform input[type="date"]').element.value).toBe('2026-08-09')
  })

  it('RECTIFICATION — enregistrement : rectifier SEULEMENT la durée ne déplace pas le jour', async () => {
    const pid = await seedProject()
    const sid = await db.sessions.add({
      projectId: pid,
      sectionId: null,
      date: '2026-08-10T00:00:00.000Z', // minuit UTC : jour LOCAL à Los Angeles = 9 août
      durationSec: 600,
      rowsDone: 0,
      manual: true,
    })
    const w = mountDetail()
    await flushPromises()

    await w.find('#tab-sessions').trigger('click')
    await flushPromises()
    await w.find('.ses-row__edit').trigger('click')

    // On NE touche PAS au champ date : on rectifie seulement la durée.
    await w.find(`#esm-${sid}`).setValue('45')
    await w.find('.addform .btn--primary').trigger('click')
    await flushPromises()

    const row = await db.sessions.get(sid)
    expect(ymdLocal(new Date(row.date))).toBe('2026-08-09') // le jour n'a PAS bougé
    expect(row.durationSec).toBe(45 * 60)
  })
})
