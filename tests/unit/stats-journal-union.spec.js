// @vitest-environment jsdom
// Unitaire — l'écran Statistiques compte l'UNION « journal des jours actifs + jours de séance »
// (§7ter + décisions D1/D2 du 11/08). Un chantier antérieur avait posé la frontière : `stats-grid.js`
// reçoit un ENSEMBLE DE JOURS et ne va jamais chercher les séances lui-même — ce fichier vérifie
// que l'élargissement se fait bien par cet ensemble, sans changer une seule règle de calcul.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import i18n from '@/i18n'
import { db } from '@/db/db'
import StatsView from '@/views/StatsView.vue'
import { useSessionsStore } from '@/stores/sessions'
import { useProjectsStore } from '@/stores/projects'
import EmptyStateArt from '@/components/EmptyStateArt.vue'
import {
  currentStreak, longestStreakInWindow, activeDays, averageSecondsPerActiveDay, sessionsByDay,
} from '@/utils/stats-grid'
import { makeTk } from './helpers/i18n-router'

const tk = makeTk(i18n)

const WIN = { startDay: '2026-08-01', endDay: '2026-08-11' }

describe('union journal + séances — les fonctions pures', () => {
  it('un jour présent UNIQUEMENT au journal compte dans la série', () => {
    // 10 et 11 août : le 10 vient d'une séance, le 11 du seul journal. Sans l'union, la série
    // vaudrait 1 (le 11 manquerait et le bord d'aujourd'hui reculerait au 10).
    const jours = new Set(['2026-08-10', '2026-08-11'])
    expect(currentStreak(jours, new Date(2026, 7, 11, 12, 0, 0))).toBe(2)
  })

  it('un jour présent DANS LES DEUX ne compte QU’UNE fois', () => {
    const seances = ['2026-08-09', '2026-08-10']
    const journal = ['2026-08-10', '2026-08-11']
    const union = new Set([...seances, ...journal])
    expect(union.size).toBe(3)
    expect(longestStreakInWindow(union, WIN)).toBe(3)
  })

  it('`activeDays` accepte un Set de jours aussi bien qu’une Map de séances', () => {
    const byDay = sessionsByDay([{ date: '2026-08-10T10:00:00', durationSec: 600 }])
    expect(activeDays(WIN, byDay)).toEqual({ active: 1, elapsed: 11 })
    expect(activeDays(WIN, new Set(['2026-08-10', '2026-08-11']))).toEqual({ active: 2, elapsed: 11 })
  })

  it('la moyenne divise le total des SÉANCES par les jours actifs de l’UNION (D1)', () => {
    // 3600 s sur un seul jour de séance, plus un jour connu du seul journal ⇒ 3600 / 2 = 1800.
    // Cette baisse a été acceptée en connaissance de cause (choix produit, D1) : c'est ce qui garde
    // `moyenne = total ÷ jours actifs` vérifiable à la main sur les trois tuiles affichées.
    const byDay = sessionsByDay([{ date: '2026-08-10T10:00:00', durationSec: 3600 }])
    expect(averageSecondsPerActiveDay(WIN, byDay)).toBe(3600)
    expect(averageSecondsPerActiveDay(WIN, byDay, new Set(['2026-08-10', '2026-08-11']))).toBe(1800)
  })
})

describe('union journal + séances — l’écran', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 7, 11, 10, 0, 0)) // mardi 11/08/2026
    i18n.global.locale.value = 'fr'
    await db.activeDays.clear()
  })
  afterEach(() => vi.useRealTimers())

  async function monter(sessions, journalDays) {
    await db.activeDays.bulkPut(journalDays.map((day) => ({ day })))
    const pinia = createTestingPinia({ createSpy: vi.fn })
    const s = useSessionsStore(pinia)
    s.allSessions = vi.fn().mockResolvedValue(sessions)
    const p = useProjectsStore(pinia)
    p.projects = [{ id: 1, name: 'Pull marin', technique: 'knitting', status: 'wip' }]
    p.loaded = true
    const w = mount(StatsView, { global: { plugins: [pinia, i18n] } })
    await flushPromises()
    return w
  }

  it('un rang coché HIER, aucune séance hier : la série vaut 2 et les jours actifs 2', async () => {
    const w = await monter(
      [{ projectId: 1, date: '2026-08-11T09:00:00', durationSec: 3600 }], // séance aujourd'hui
      ['2026-08-10'],                                                     // journal : hier seul
    )
    // ⛔ Ne pas ancrer sur `w.text()).toContain('2')` : `rangeLabel` affiche l'année « 2026 », donc
    // cette forme d'assertion ne peut jamais échouer. On ancre directement sur la tuile visée, et
    // sur la forme LOCALISÉE complète (« {active} sur {elapsed} ») — pas seulement le chiffre :
    // fenêtre trimestre par défaut, du 2026-05-18 (13 semaines avant, lundi) au 2026-08-11
    // (aujourd'hui inclus) ⇒ 86 jours écoulés, lus sur `elapsed`, pas supposés.
    expect(w.find('[data-stat="activeDays"]').text()).toContain(tk('stats.tiles.activeDaysValue', { active: 2, elapsed: 86 }))
    // D1 (décision produit, 11/08) : la tuile 7 divise le total des SÉANCES (3600 s, la seule séance
    // d'aujourd'hui) par les jours actifs de l'UNION (2 : aujourd'hui + hier via le journal),
    // pas par les seuls jours de séance (1, qui donnerait 1:00:00). 3600 ÷ 2 = 1800 s.
    // `fmtDuration` n'ajoute le préfixe heures que si h > 0 (src/stores/activeSession.js:131) :
    // 1800 s ⇒ « 30:00 », jamais « 0:30:00 ». Sans cette assertion, retirer le 3e argument de
    // `averageSecondsPerActiveDay` dans StatsView.vue (D1 non appliquée sur la moyenne) restait
    // invisible aux 122 tests existants — tous insensibles au dénominateur sur cette tuile.
    expect(w.find('[data-stat="average"]').text()).toContain('30:00')
  })

  it("un journal SANS aucune séance fait quitter l'état vide de l'écran", async () => {
    // Avant ce chantier, `hasAnySession` gouvernait seul l'état vide : une utilisatrice qui coche des
    // rangs pendant dix jours sans jamais chronométrer voyait l'écran vide alors que sa série
    // valait 10. Le critère honnête est « aucune ACTIVITÉ du tout », pas « aucune séance ».
    const w = await monter([], ['2026-08-10', '2026-08-11'])
    expect(w.findComponent(EmptyStateArt).exists()).toBe(false)
    expect(w.find('[data-stat="activeDays"]').text()).toContain('2')
  })

  it("⛔ ÉTAT JAMAIS RENDU AVANT CE LOT : journal seul, ZÉRO séance — les NEUF tuiles tiennent", async () => {
    // C'est l'état que le changement d'état vide fait apparaître, et qu'aucun des 4705 tests
    // existants n'a jamais rendu : l'écran s'affiche avec un `byDay` VIDE. `buildGrid`,
    // `bestDay`, `topProject`, `weekdayTotals`, `averageSecondsPerActiveDay` tournent tous
    // contre rien. Les neuf tuiles sont vérifiées UNE PAR UNE — pas seulement `activeDays` —
    // parce qu'il suffit qu'une seule jette pour que l'écran devienne blanc.
    const w = await monter([], ['2026-08-10', '2026-08-11'])
    for (const nom of ['total', 'activeDays', 'streak', 'longest', 'topProject', 'bestDay', 'average', 'finished', 'wip']) {
      expect(w.find(`[data-stat="${nom}"]`).exists()).toBe(true)
    }
    // Les tuiles de TEMPS disent « — » (une ignorance ne se présente pas comme un zéro mesuré,
    // §7) ; celles de JOURS disent le vrai nombre venu du journal.
    expect(w.find('[data-stat="total"]').text()).toContain('—')
    expect(w.find('[data-stat="average"]').text()).toContain('—')
    expect(w.find('[data-stat="bestDay"]').text()).toContain('—')
    expect(w.find('[data-stat="topProject"]').text()).toContain('—')
    expect(w.find('[data-stat="activeDays"]').text()).toContain('2')
    expect(w.find('[data-stat="streak"]').text()).toContain('2')
    // Et la grille est bien rendue, entièrement en niveau 0 — sur les jours RÉELS. ⛔ `.hm__cols
    // .hm__cell` et non `.hm__cell` : la LÉGENDE porte les mêmes classes et est toujours rendue
    // (piège connu). ⚠️ Écart par rapport au plan initial : `:not(.hm__cell--future)` est nécessaire — la semaine
    // en cours (fenêtre partielle) porte TOUJOURS des jours futurs, rendus ABSENTS et non « l0 »
    // (`buildGrid`, stats-grid.js ; documenté aussi par stats-heatmap.spec.js:66-69). Sans cette
    // exclusion l'assertion échouerait à chaque exécution, y compris avant ce chantier — un défaut de
    // l'assertion elle-même, pas un défaut que ce chantier introduit.
    expect(w.findAll('.hm__cols .hm__cell--l0').length).toBeGreaterThan(0)
    expect(w.findAll('.hm__cols .hm__cell:not(.hm__cell--l0):not(.hm__cell--future)').length).toBe(0)
  })

  it("une base réellement vierge garde son état vide", async () => {
    const w = await monter([], [])
    expect(w.findComponent(EmptyStateArt).exists()).toBe(true)
  })
})

// ⚖️ Décision produit du 11/08, prise APRÈS avoir vu le cas sur son appareil : sous un filtre
// technique, la moyenne divise un total FILTRÉ par un dénominateur que le filtre ne peut pas
// réduire (le journal ne retient qu'un jour, ni projet ni technique — §7ter, D2). Mesuré sur
// le Huawei avec les vraies données : filtre Crochet, un rang de TRICOT coché fait passer les jours
// actifs de 8 à 9 et la moyenne de 1:11:03 à 1:03:09, alors que le temps de crochet, lui, n'a pas
// bougé. Un rang de tricot faisait donc baisser la moyenne de crochet de huit minutes.
// ⇒ la moyenne affiche « — » plutôt qu'un nombre qui ne répond à aucune question.
//
// ⚠️ La garde est CONDITIONNELLE, et c'est le point le plus important de ce bloc : elle ne se
// déclenche que s'il existe réellement, dans la fenêtre, un jour que le numérateur ne peut pas
// expliquer. Un filtre actif sur une base dont le journal est vide (ou dont tous les jours de
// journal portent aussi une séance de la technique retenue) garde son chiffre — sinon on
// remplacerait un nombre HONNÊTE par un tiret, ce qui serait une perte d'information gratuite.
describe("moyenne par jour actif — le tiret sous filtre technique", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 7, 11, 10, 0, 0)) // mardi 11/08/2026
    i18n.global.locale.value = 'fr'
    await db.activeDays.clear()
  })
  afterEach(() => vi.useRealTimers())

  // Deux techniques dans la bibliothèque : sans elles, `showTechniqueFilter` masque le sélecteur
  // et `effectiveTechnique` retombe sur « Tout » (ÉVO D) — le test ne prouverait alors rien.
  const DEUX_TECHNIQUES = [
    { id: 1, name: 'Pull marin', technique: 'knitting', status: 'wip' },
    { id: 2, name: 'Châle Marisol', technique: 'crochet', status: 'wip' },
  ]

  async function monterAvecFiltre(sessions, journalDays) {
    await db.activeDays.bulkPut(journalDays.map((day) => ({ day })))
    const pinia = createTestingPinia({ createSpy: vi.fn })
    const s = useSessionsStore(pinia)
    s.allSessions = vi.fn().mockResolvedValue(sessions)
    const p = useProjectsStore(pinia)
    p.projects = DEUX_TECHNIQUES
    p.loaded = true
    const w = mount(StatsView, { global: { plugins: [pinia, i18n] } })
    await flushPromises()
    return w
  }

  // Passe par le VRAI bouton du sélecteur, pas par une affectation sur le composant : c'est le
  // geste de l'utilisatrice qui doit produire le tiret. Le libellé est lu dans l'i18n (« Crochet »
  // vient de `technique.crochet`), jamais supposé.
  async function choisir(w, libelle) {
    const bouton = w.findAll('.toggle__opt').find((b) => b.text() === libelle)
    expect(bouton, `bouton « ${libelle} » absent du sélecteur`).toBeTruthy()
    await bouton.trigger('click')
    await flushPromises()
    return bouton
  }

  it('filtre Crochet + un jour connu du seul journal ⇒ la moyenne affiche « — »', async () => {
    const w = await monterAvecFiltre(
      [
        { projectId: 2, date: '2026-08-05T10:00:00', durationSec: 3600 }, // crochet, 1 h
        { projectId: 1, date: '2026-08-11T09:00:00', durationSec: 7200 }, // tricot, 2 h
      ],
      ['2026-08-10'], // jour du journal : aucune séance, ni tricot ni crochet
    )
    // Sous « Tout », la moyenne s'affiche : le numérateur et le dénominateur parlent des mêmes
    // jours. 3 h sur 3 jours actifs (05, 10 via le journal, 11) ⇒ 1:00:00.
    expect(w.find('[data-stat="average"]').text()).toContain('1:00:00')

    await choisir(w, 'Crochet')

    // Le total suit le filtre (1 h de crochet), les jours actifs non (D2) : le 11/08 est du tricot
    // et le 10/08 vient du journal. Diviser l'un par l'autre n'aurait aucun sens.
    expect(w.find('[data-stat="total"]').text()).toContain('1:00:00')
    expect(w.find('[data-stat="average"]').text()).toContain('—')
    expect(w.find('[data-stat="average"]').text()).not.toContain(':')
  })

  it("filtre Crochet + journal VIDE ⇒ la moyenne garde son chiffre (pas de tiret gratuit)", async () => {
    // Sans jour de journal, l'union se réduit aux séances filtrées : le dénominateur est alors
    // exactement le bon, et le chiffre est honnête. Ce test est la contre-épreuve du précédent —
    // sans lui, une garde inconditionnelle (« filtre actif ⇒ tiret ») passerait pour correcte.
    const w = await monterAvecFiltre(
      [
        { projectId: 2, date: '2026-08-05T10:00:00', durationSec: 3600 },
        { projectId: 2, date: '2026-08-07T10:00:00', durationSec: 1800 },
        { projectId: 1, date: '2026-08-11T09:00:00', durationSec: 7200 },
      ],
      [],
    )
    await choisir(w, 'Crochet')
    expect(w.find('[data-stat="total"]').text()).toContain('1:30:00')
    expect(w.find('[data-stat="activeDays"]').text()).toContain('2 sur')
    expect(w.find('[data-stat="average"]').text()).toContain('45:00') // 5400 ÷ 2
    expect(w.find('[data-stat="average"]').text()).not.toContain('—')
  })

  it("filtre Crochet + un jour de journal qui porte AUSSI du crochet ⇒ la moyenne garde son chiffre", async () => {
    // Le jour du journal est déjà compté par une séance de crochet : il n'ajoute rien au
    // dénominateur, donc rien n'est bancal. La garde doit rester muette.
    const w = await monterAvecFiltre(
      [{ projectId: 2, date: '2026-08-05T10:00:00', durationSec: 3600 }],
      ['2026-08-05'],
    )
    await choisir(w, 'Crochet')
    expect(w.find('[data-stat="activeDays"]').text()).toContain('1 sur')
    expect(w.find('[data-stat="average"]').text()).toContain('1:00:00')
  })

  it("filtre « Tout » + un jour connu du seul journal ⇒ la moyenne BAISSE et ne prend PAS le tiret (D1)", async () => {
    // D1 a été acceptée en connaissance de cause : sous « Tout », un jour sans durée entre au
    // dénominateur et la moyenne baisse. Le tiret ne doit surtout pas manger ce cas — sinon la
    // garde annulerait la décision qu'elle est censée compléter.
    const w = await monterAvecFiltre(
      [{ projectId: 1, date: '2026-08-11T09:00:00', durationSec: 3600 }],
      ['2026-08-10'],
    )
    expect(w.find('[data-stat="activeDays"]').text()).toContain('2 sur')
    expect(w.find('[data-stat="average"]').text()).toContain('30:00') // 3600 ÷ 2, pas 1:00:00
    expect(w.find('[data-stat="average"]').text()).not.toContain('—')
  })

  it("le tiret ne concerne QUE la moyenne : total, jours actifs et série gardent leurs chiffres", async () => {
    const w = await monterAvecFiltre(
      [
        { projectId: 2, date: '2026-08-05T10:00:00', durationSec: 3600 },
        { projectId: 1, date: '2026-08-11T09:00:00', durationSec: 7200 },
      ],
      ['2026-08-10'],
    )
    await choisir(w, 'Crochet')
    expect(w.find('[data-stat="total"]').text()).toContain('1:00:00')
    // ⚠️ 2 jours et non 3 : l'union part des séances DÉJÀ FILTRÉES (`byDay`), donc le 11/08 —
    // journée de tricot — n'y figure pas sous « Crochet ». Restent le 05/08 (séance de crochet) et
    // le 10/08 (journal, que le filtre ne peut pas réduire). C'est exactement ce mélange qui rend
    // la moyenne bancale, et c'est pourquoi elle seule prend le tiret.
    expect(w.find('[data-stat="activeDays"]').text()).toContain(tk('stats.tiles.activeDaysValue', { active: 2, elapsed: 86 }))
    // Série : aujourd'hui (11/08) n'est pas dans l'union sous « Crochet », donc le bord
    // d'aujourd'hui recule à hier (10/08, présent au journal) et la série vaut 1 — au singulier.
    expect(w.find('[data-stat="streak"]').text()).toContain('1 jour')
    expect(w.find('[data-stat="streak"]').text()).not.toContain('1 jours')
  })
})
