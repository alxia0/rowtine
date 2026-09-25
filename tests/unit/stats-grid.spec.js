// Unitaire — module pur de la grille calendaire (spec 2026-08-10, lot 1).
// AUCUNE date implicite : la date de référence entre par paramètre, donc aucun faux timer
// n'est nécessaire ici — c'est précisément ce que le module garantit.
import { describe, it, expect } from 'vitest'
import {
  buildWindow, sessionsByDay, levelOf, buildGrid, WINDOW_WEEKS,
  currentStreak, longestStreakInWindow,
  weekdayTotals, bestWeekdayAllTime, totalSeconds, activeDays, bestDay, averageSecondsPerActiveDay,
  topProject, finishedInWindow, wipCount, filterByTechnique, filterProjectsByTechnique,
  monthGroups, sessionsByDayAndProject, showTechniqueFilter, dayKeyOf, MAX_WINDOW_WEEKS,
} from '@/utils/stats-grid'

// Mercredi 15 juillet 2026, 10 h locales. Semaine du lundi 13/07.
const REF = new Date(2026, 6, 15, 10, 0, 0)

// Une séance à midi local le jour demandé : midi est le seul point du jour qu'aucune
// bascule d'heure d'été ne fait changer de date.
function sess(ymd, durationSec, projectId = 1) {
  const [y, m, d] = ymd.split('-').map(Number)
  return {
    projectId,
    sectionId: null,
    date: new Date(y, m - 1, d, 12, 0, 0).toISOString(),
    durationSec,
    rowsDone: 0,
  }
}

describe('buildWindow', () => {
  it('un trimestre fait 13 semaines et se termine aujourd’hui', () => {
    const w = buildWindow(REF, 'quarter')
    expect(w.weeks).toBe(13)
    // 13 semaines finissant par celle du 13/07 → premier lundi = 13/07 − 12×7 j = 20/04/2026.
    expect(w.startDay).toBe('2026-04-20')
    expect(w.endDay).toBe('2026-07-15')
    expect(w.mondayDays).toHaveLength(13)
    expect(w.mondayDays[0]).toBe('2026-04-20')
    expect(w.mondayDays[12]).toBe('2026-07-13')
  })

  it('les quatre fenêtres ont les largeurs de la spec', () => {
    expect(WINDOW_WEEKS).toEqual({ month: 5, quarter: 13, semester: 26, year: 53 })
    expect(buildWindow(REF, 'month').startDay).toBe('2026-06-15')
    expect(buildWindow(REF, 'semester').startDay).toBe('2026-01-19')
    expect(buildWindow(REF, 'year').startDay).toBe('2025-07-14')
  })

  it('une fenêtre inconnue retombe sur le trimestre', () => {
    expect(buildWindow(REF, 'nimportequoi').weeks).toBe(13)
    expect(buildWindow(REF, 'nimportequoi').period).toBe('quarter')
  })

  // Cas du 11/08 — non-régression : sans 3e argument, buildWindow garde EXACTEMENT son
  // comportement (lundi). Protège ce qui est déjà validé sur appareil.
  it('non-régression : sans firstDay explicite, la fenêtre reste ancrée au lundi', () => {
    expect(buildWindow(REF, 'quarter').startDay).toBe(buildWindow(REF, 'quarter', 1).startDay)
    expect(buildWindow(REF, 'quarter').mondayDays).toEqual(buildWindow(REF, 'quarter', 1).mondayDays)
  })

  it('firstDay=0 (dimanche) : la fenêtre commence bien un dimanche, pas un lundi', () => {
    const w = buildWindow(REF, 'quarter', 0)
    expect(w.mondayDays).toHaveLength(13)
    // La dernière colonne (semaine courante) démarre le dimanche 12/07 — PAS le lundi 13/07
    // rendu sous le réglage par défaut (test ci-dessus).
    expect(w.mondayDays[12]).toBe('2026-07-12')
    expect(w.startDay).toBe('2026-04-19') // 13 semaines de 7 jours avant le 12/07
  })
})

describe('bornes de la fenêtre — les DEUX côtés', () => {
  // Sans ces deux assertions en paire, la borne n'est pas prouvée : une seule des deux
  // passerait avec un comparateur strictement faux dans l'autre sens.
  it('le dimanche qui précède le premier lundi est EXCLU, ce lundi est INCLUS', () => {
    const win = buildWindow(REF, 'quarter') // premier lundi = 2026-04-20
    const byDay = sessionsByDay([sess('2026-04-19', 3600), sess('2026-04-20', 1800)])
    const grid = buildGrid(win, byDay)
    const days = grid.columns.flatMap((c) => c.cells.map((x) => x.day))
    expect(days).not.toContain('2026-04-19')
    expect(days).toContain('2026-04-20')
    expect(grid.columns[0].cells[0]).toMatchObject({ day: '2026-04-20', seconds: 1800 })
  })

  it('une séance à 00 h 00 du premier lundi est comptée dans la fenêtre', () => {
    const win = buildWindow(REF, 'quarter')
    const minuit = {
      projectId: 1,
      sectionId: null,
      date: new Date(2026, 3, 20, 0, 0, 0).toISOString(),
      durationSec: 600,
      rowsDone: 0,
    }
    const byDay = sessionsByDay([minuit])
    expect(buildGrid(win, byDay).columns[0].cells[0].seconds).toBe(600)
  })

  it('deux séances le même jour cumulent `count` (sert l’info-bulle « 3 séances »)', () => {
    const win = buildWindow(REF, 'quarter')
    const byDay = sessionsByDay([sess('2026-04-20', 600), sess('2026-04-20', 300)])
    expect(byDay.get('2026-04-20').count).toBe(2)
    expect(buildGrid(win, byDay).columns[0].cells[0].count).toBe(2)
  })
})

describe('les cinq niveaux — chaque borne franchie DANS LES DEUX SENS', () => {
  it('rien du tout vaut le niveau 0', () => {
    expect(levelOf(0)).toBe(0)
    expect(levelOf(1)).toBe(1) // une seconde suffit à quitter le niveau 0
  })

  it('29 min 59 s → 1 et 30 min 00 s → 2', () => {
    expect(levelOf(29 * 60 + 59)).toBe(1)
    expect(levelOf(30 * 60)).toBe(2)
  })

  it('59 min 59 s → 2 et 1 h 00 min 00 s → 3', () => {
    expect(levelOf(59 * 60 + 59)).toBe(2)
    expect(levelOf(3600)).toBe(3)
  })

  it('1 h 59 min 59 s → 3 et 2 h 00 min 00 s → 4', () => {
    expect(levelOf(2 * 3600 - 1)).toBe(3)
    expect(levelOf(7200)).toBe(4)
  })

  it('bien au-delà reste au niveau 4 (pas d’échelle relative)', () => {
    expect(levelOf(50 * 3600)).toBe(4)
  })
})

describe('jours à venir', () => {
  it('les jours postérieurs à la référence sont marqués `future`, ET ne portent ni durée ni niveau MÊME si une séance y est enregistrée', () => {
    // REF = mercredi 15/07. Jeudi 16, vendredi 17, samedi 18, dimanche 19 sont à venir.
    // Une séance est semée le 16/07 (jeudi, à venir) : sans la garde `future`, `entry` existerait
    // et `seconds`/`count`/`level` remonteraient la valeur au lieu de 0 — le test ne prouverait
    // alors que le drapeau, jamais l'effet qu'il est censé avoir sur le rendu.
    const byDay = sessionsByDay([sess('2026-07-16', 3600)])
    const grid = buildGrid(buildWindow(REF, 'month'), byDay)
    const derniere = grid.columns[grid.columns.length - 1]
    expect(derniere.cells.map((c) => c.future)).toEqual([false, false, false, true, true, true, true])
    expect(derniere.cells[3]).toMatchObject({ day: '2026-07-16', seconds: 0, count: 0, level: 0, future: true })
  })
})

// La série reçoit un ENSEMBLE DE JOURS, jamais des séances : le lot 2 lui passera l'union
// « journal des jours actifs + séances » sans qu'une ligne de cette fonction change.
const jours = (...ds) => new Set(ds)

describe('série en cours', () => {
  it('compte les jours consécutifs jusqu’à aujourd’hui', () => {
    expect(currentStreak(jours('2026-07-13', '2026-07-14', '2026-07-15'), REF)).toBe(3)
  })

  it('un trou d’un seul jour coupe la série', () => {
    expect(currentStreak(jours('2026-07-12', '2026-07-14', '2026-07-15'), REF)).toBe(2)
  })

  it('rien aujourd’hui mais quelque chose hier : la série TIENT (elle court jusqu’à hier)', () => {
    // Sinon elle afficherait « 0 » tous les matins.
    expect(currentStreak(jours('2026-07-13', '2026-07-14'), REF)).toBe(2)
  })

  it('rien aujourd’hui ni hier : la série vaut 0', () => {
    expect(currentStreak(jours('2026-07-12', '2026-07-11'), REF)).toBe(0)
  })

  it('ensemble vide : 0', () => {
    expect(currentStreak(new Set(), REF)).toBe(0)
  })
})

describe('plus longue série SUR LA FENÊTRE', () => {
  it('une série à cheval sur le bord est comptée ENTIÈRE par la série en cours, TRONQUÉE par le record', () => {
    // Fenêtre « Mois » : premier lundi = 2026-06-15. On sème 6 jours du 12 au 17 juin,
    // dont 3 avant la fenêtre. Rien après le 17/06 : cette série est loin d'aujourd'hui (15/07).
    const win = buildWindow(REF, 'month')
    const set = jours('2026-06-12', '2026-06-13', '2026-06-14', '2026-06-15', '2026-06-16', '2026-06-17')
    expect(longestStreakInWindow(set, win)).toBe(3) // 15, 16, 17 — tronquée au bord, c'est VOULU
    // La série EN COURS ne repose pas sur la fenêtre : le 17/06 est loin d'aujourd'hui → 0.
    expect(currentStreak(set, REF)).toBe(0)
  })

  it('la série en cours ignore le bord de fenêtre : 40 jours à cheval comptent 40', () => {
    const set = new Set()
    // 40 jours consécutifs finissant aujourd'hui (15/07) → commence le 06/06, avant le
    // premier lundi de la fenêtre « Mois » (15/06).
    for (let i = 0; i < 40; i++) {
      const d = new Date(2026, 6, 15 - i, 12, 0, 0)
      set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
    }
    expect(currentStreak(set, REF)).toBe(40)
    expect(longestStreakInWindow(set, buildWindow(REF, 'month'))).toBe(31) // 15/06 → 15/07 inclus
  })
})

describe('barres par jour de semaine', () => {
  it('index 0 = LUNDI, index 6 = dimanche (jamais getDay(), qui met dimanche à 0)', () => {
    const win = buildWindow(REF, 'month')
    // 2026-07-13 est un lundi, 2026-07-12 un dimanche.
    const byDay = sessionsByDay([sess('2026-07-13', 600), sess('2026-07-12', 900)])
    const t = weekdayTotals(win, byDay)
    expect(t[0]).toBe(600)
    expect(t[6]).toBe(900)
  })

  it('cumule les mêmes jours de semaine sur toute la fenêtre', () => {
    const win = buildWindow(REF, 'month')
    const byDay = sessionsByDay([sess('2026-07-13', 600), sess('2026-07-06', 300)]) // deux lundis
    expect(weekdayTotals(win, byDay)[0]).toBe(900)
  })

  it('ne compte que les jours DANS la fenêtre — un lundi hors fenêtre n’est pas cumulé', () => {
    const win = buildWindow(REF, 'month') // premier lundi = 2026-06-15
    // 2026-05-11 est un lundi mais hors fenêtre « Mois » ; 2026-06-15 est le premier lundi dedans.
    const byDay = sessionsByDay([sess('2026-05-11', 500), sess('2026-06-15', 700)])
    expect(weekdayTotals(win, byDay)[0]).toBe(700)
  })

  it('le jour le plus assidu sur TOUT l’historique ignore la fenêtre', () => {
    // 2026-01-04 est un dimanche, largement hors d'un trimestre finissant le 15/07.
    const byDay = sessionsByDay([sess('2026-01-04', 99999), sess('2026-07-13', 600)])
    expect(bestWeekdayAllTime(byDay)).toBe(6) // dimanche
  })

  // Cas du 11/08 — même fixture que le tout premier test de ce bloc, mais firstDay=0
  // (dimanche) : les index s'INVERSENT — c'est ce qui prouve que le réglage gouverne
  // réellement l'ORDRE des cases, pas seulement leur libellé.
  it('firstDay=0 (dimanche) : index 0 = DIMANCHE, index 1 = LUNDI — décalé par rapport au défaut (index 0 = lundi, 6 = dimanche)', () => {
    const win = buildWindow(REF, 'month', 0)
    const byDay = sessionsByDay([sess('2026-07-13', 600), sess('2026-07-12', 900)]) // lundi, dimanche
    const t = weekdayTotals(win, byDay, 0)
    expect(t[0]).toBe(900) // dimanche en tête
    expect(t[1]).toBe(600) // lundi juste après (jamais index 6, qui était sa place sous lundi-premier)
  })

  it('non-régression : weekdayTotals sans firstDay explicite garde exactement son comportement (lundi)', () => {
    const win = buildWindow(REF, 'month')
    const byDay = sessionsByDay([sess('2026-07-13', 600), sess('2026-07-12', 900)])
    expect(weekdayTotals(win, byDay)).toEqual(weekdayTotals(win, byDay, 1))
  })

  it('bestWeekdayAllTime : firstDay ne change PAS quel jour gagne, seulement l’index rendu', () => {
    const byDay = sessionsByDay([sess('2026-01-04', 99999), sess('2026-07-13', 600)]) // dimanche gagne
    expect(bestWeekdayAllTime(byDay, 1)).toBe(6) // dimanche = index 6 sous lundi-premier
    expect(bestWeekdayAllTime(byDay, 0)).toBe(0) // dimanche = index 0 sous dimanche-premier
  })
})

// LE test qui prouve que cette évolution sert à quelque chose : une séance du
// dimanche qui précède le dernier lundi de la fenêtre tombe dans la colonne PRÉCÉDENTE sous
// « lundi », et dans la colonne COURANTE (la dernière) sous « dimanche » — MÊME fixture, deux
// verdicts opposés selon le seul réglage, jamais les deux à la fois.
describe('buildGrid — la fenêtre commence bien au jour choisi', () => {
  it('une séance du dimanche 12/07 change de colonne selon firstDay', () => {
    const byDay = sessionsByDay([sess('2026-07-12', 1800)])

    // Sous LUNDI (défaut) : la fenêtre « Trimestre » se termine par la semaine du lundi 13/07
    // (colonne 12, la dernière). Le dimanche 12/07 appartient à la semaine PRÉCÉDENTE, donc à
    // la colonne 11, en dernière ligne (index 6, dimanche).
    const winLundi = buildWindow(REF, 'quarter', 1)
    const gridLundi = buildGrid(winLundi, byDay)
    expect(gridLundi.columns[11].cells[6].day).toBe('2026-07-12')
    expect(gridLundi.columns[11].cells[6].seconds).toBe(1800)
    expect(gridLundi.columns[12].cells.some((c) => c.day === '2026-07-12')).toBe(false)

    // Sous DIMANCHE : la fenêtre se termine par la semaine qui COMMENCE le 12/07 (colonne 12,
    // la dernière, en PREMIÈRE ligne — index 0, dimanche-premier). Même séance, même jour
    // calendaire, colonne SUIVANTE par rapport au cas ci-dessus.
    const winDimanche = buildWindow(REF, 'quarter', 0)
    const gridDimanche = buildGrid(winDimanche, byDay)
    expect(gridDimanche.columns[12].cells[0].day).toBe('2026-07-12')
    expect(gridDimanche.columns[12].cells[0].seconds).toBe(1800)
    expect(gridDimanche.columns[11].cells.some((c) => c.day === '2026-07-12')).toBe(false)
  })
})

describe('tuiles chiffrées', () => {
  const win = buildWindow(REF, 'month') // 15/06 → 15/07 inclus, soit 31 jours ÉCOULÉS

  it('jours actifs : le dénominateur ne compte QUE les jours écoulés', () => {
    const byDay = sessionsByDay([sess('2026-07-13', 600), sess('2026-07-14', 600)])
    // Les 4 jours à venir de la semaine en cours (16, 17, 18, 19/07) sont exclus du dénominateur.
    expect(activeDays(win, byDay)).toEqual({ active: 2, elapsed: 31 })
  })

  it('meilleur jour : à durée égale, le PLUS RÉCENT gagne', () => {
    const byDay = sessionsByDay([sess('2026-06-20', 3600), sess('2026-07-10', 3600)])
    expect(bestDay(win, byDay)).toEqual({ day: '2026-07-10', seconds: 3600 })
  })

  // Revue finale (11/08) — une séance à RANGS SEULS (saveManualSession, ProjectDetailView.vue)
  // s'enregistre avec durationSec: 0 : ce jour-là DOIT compter pour « jours actifs » (spec §7 :
  // « jours avec ≥ 1 séance »), sous peine de faire dire à l'écran deux choses contraires (la
  // série le compte, cette tuile l'exclurait). AVANT correctif, cette assertion était rouge
  // (`byDay.get(day)?.seconds > 0` excluait le jour à durée nulle).
  it('jours actifs : une séance à RANGS SEULS (durée 0) compte comme un jour actif', () => {
    const byDay = sessionsByDay([sess('2026-07-13', 600), sess('2026-07-14', 0)])
    expect(activeDays(win, byDay)).toEqual({ active: 2, elapsed: 31 })
  })

  // Portée VOLONTAIREMENT différente d'activeDays : le « meilleur jour » exige une durée > 0.
  // Un jour à rangs seuls est actif, mais ce n'est pas un jour à comparer par sa durée — sans
  // cette exigence, un jour à 0 s'afficherait comme « meilleur jour » dès qu'aucun autre jour
  // n'a de durée positive dans la fenêtre.
  it('meilleur jour : un jour à RANGS SEULS (durée 0) n’est jamais désigné, même seul dans la fenêtre', () => {
    const byDay = sessionsByDay([sess('2026-07-13', 0)])
    expect(bestDay(win, byDay)).toBeNull()
  })

  it('meilleur jour : un jour à durée positive gagne toujours contre un jour à rangs seuls', () => {
    const byDay = sessionsByDay([sess('2026-07-01', 0), sess('2026-06-20', 600)])
    expect(bestDay(win, byDay)).toEqual({ day: '2026-06-20', seconds: 600 })
  })

  it('moyenne par jour actif : cas normal', () => {
    const byDay = sessionsByDay([sess('2026-07-10', 3600), sess('2026-07-11', 1200)])
    expect(averageSecondsPerActiveDay(win, byDay)).toBe(2400) // (3600 + 1200) / 2
  })

  it('moyenne par jour actif : aucun jour actif → null (pas de division par zéro)', () => {
    expect(averageSecondsPerActiveDay(win, sessionsByDay([]))).toBeNull()
  })

  // Le cas que le correctif d'activeDays REND POSSIBLE et qu'il ne faut pas laisser fuiter :
  // des jours actifs (rangs seuls) mais un total de la fenêtre resté NUL. Sans cette garde,
  // Math.round(0 / 2) rendrait 0, affiché comme « 0:00 » — un temps qui semble mesuré alors
  // qu'aucune durée n'existe (même défaut que le zéro mesuré interdit par la spec §7).
  it('moyenne par jour actif : jours actifs mais total NUL (que des séances à rangs seuls) → null, pas 0', () => {
    const byDay = sessionsByDay([sess('2026-07-10', 0), sess('2026-07-11', 0)])
    expect(averageSecondsPerActiveDay(win, byDay)).toBeNull()
  })

  it('projet le plus travaillé : à durée égale, celui dont la séance est la PLUS RÉCENTE', () => {
    const s = [sess('2026-06-20', 3600, 7), sess('2026-07-10', 3600, 9)]
    expect(topProject(s, win)).toEqual({ projectId: 9, seconds: 3600 })
  })

  it('projet le plus travaillé : aucune séance dans la fenêtre → null', () => {
    expect(topProject([sess('2020-01-01', 3600, 7)], win)).toBeNull()
  })

  it('total de la période : les séances hors fenêtre ne comptent pas', () => {
    const byDay = sessionsByDay([sess('2026-07-10', 600), sess('2026-05-10', 99999)])
    expect(totalSeconds(win, byDay)).toBe(600)
  })

  it('projets terminés : les DEUX bornes de la fenêtre, chacune franchie dans les deux sens', () => {
    const projects = [
      { id: 1, status: 'done', finishedAt: '2026-06-14' }, // veille du premier jour (15/06) → exclu
      { id: 2, status: 'done', finishedAt: '2026-06-15' }, // premier jour → inclus
      { id: 3, status: 'done', finishedAt: '' }, // reliquat
      { id: 4, status: 'abandoned', finishedAt: '2026-07-01' }, // abandonné ≠ terminé
      { id: 5, status: 'done', finishedAt: '2026-07-15' }, // dernier jour (win.endDay) → inclus
      { id: 6, status: 'done', finishedAt: '2026-07-16' }, // lendemain du dernier jour → exclu
    ]
    expect(finishedInWindow(projects, win)).toEqual({ count: 2, withoutDate: 1 })
  })

  it('projets en cours : compte au PRÉSENT, aucune borne de fenêtre', () => {
    expect(wipCount([{ status: 'wip' }, { status: 'wip' }, { status: 'done' }, { status: 'pause' }])).toBe(2)
  })
})

describe('filtre par technique', () => {
  const projects = [
    { id: 1, technique: 'knitting' },
    { id: 2, technique: 'crochet' },
    { id: 3 }, // fiche ancienne, sans technique
  ]
  const sessions = [
    sess('2026-07-13', 600, 1),
    sess('2026-07-13', 300, 2),
    sess('2026-07-13', 100, 3),
    sess('2026-07-13', 50, 99), // ORPHELINE : son projet n'existe plus
  ]

  it('les trois filtres donnent trois totaux DIFFÉRENTS', () => {
    const somme = (ss) => ss.reduce((a, s) => a + s.durationSec, 0)
    expect(somme(filterByTechnique(sessions, projects, 'all'))).toBe(1050)
    expect(somme(filterByTechnique(sessions, projects, 'knitting'))).toBe(700) // 600 + 100 (sans technique)
    expect(somme(filterByTechnique(sessions, projects, 'crochet'))).toBe(300)
  })

  it('un projet sans technique compte comme TRICOT', () => {
    expect(filterByTechnique(sessions, projects, 'knitting').map((s) => s.projectId)).toContain(3)
  })

  it('une séance ORPHELINE n’apparaît que dans « Tout » — on ne lui invente pas de technique', () => {
    expect(filterByTechnique(sessions, projects, 'all').map((s) => s.projectId)).toContain(99)
    expect(filterByTechnique(sessions, projects, 'knitting').map((s) => s.projectId)).not.toContain(99)
    expect(filterByTechnique(sessions, projects, 'crochet').map((s) => s.projectId)).not.toContain(99)
  })
})

describe('filtre par technique — côté PROJETS (tuiles « terminés » et « en cours »)', () => {
  const projects = [
    { id: 1, technique: 'knitting' },
    { id: 2, technique: 'crochet' },
    { id: 3 }, // fiche ancienne, sans technique
  ]

  it('les trois filtres rendent trois listes DIFFÉRENTES', () => {
    expect(filterProjectsByTechnique(projects, 'all').map((p) => p.id)).toEqual([1, 2, 3])
    expect(filterProjectsByTechnique(projects, 'knitting').map((p) => p.id)).toEqual([1, 3])
    expect(filterProjectsByTechnique(projects, 'crochet').map((p) => p.id)).toEqual([2])
  })

  it('un projet sans technique compte comme TRICOT', () => {
    expect(filterProjectsByTechnique(projects, 'knitting').map((p) => p.id)).toContain(3)
    expect(filterProjectsByTechnique(projects, 'crochet').map((p) => p.id)).not.toContain(3)
  })

  // Pas d'équivalent à la séance orpheline : un projet de cette liste EXISTE par définition
  // (c'est la liste elle-même). Aucune branche « projet disparu » n'a de sens ici — voir le
  // commentaire de `filterProjectsByTechnique` dans stats-grid.js.
})

// Cas du 11/08 — le sélecteur tricot/crochet ne s'affiche que si la bibliothèque contient les
// DEUX techniques. Comptage sur TOUTE la bibliothèque : la fonction ne prend qu'une liste de
// projets, jamais de fenêtre ni de séances (c'est ce qui rend « le sélecteur ne bouge jamais »
// prouvable par construction plutôt que par convention).
describe('showTechniqueFilter — le filtre ne s’affiche que si les DEUX techniques existent', () => {
  it('bibliothèque TRICOT SEUL → masqué', () => {
    expect(showTechniqueFilter([{ id: 1, technique: 'knitting' }, { id: 2, technique: 'knitting' }])).toBe(false)
  })

  it('bibliothèque CROCHET SEUL → masqué', () => {
    expect(showTechniqueFilter([{ id: 1, technique: 'crochet' }, { id: 2, technique: 'crochet' }])).toBe(false)
  })

  it('les DEUX techniques présentes → affiché', () => {
    expect(showTechniqueFilter([{ id: 1, technique: 'knitting' }, { id: 2, technique: 'crochet' }])).toBe(true)
  })

  it('bibliothèque VIDE → masqué', () => {
    expect(showTechniqueFilter([])).toBe(false)
    expect(showTechniqueFilter(null)).toBe(false)
  })

  it('un projet SANS technique (fiche ancienne) compte comme TRICOT — avec un crochet, ça affiche', () => {
    expect(showTechniqueFilter([{ id: 1 }, { id: 2, technique: 'crochet' }])).toBe(true)
  })

  it('un projet SANS technique seul (aucun crochet) → masqué — pas juste "présence d’un projet"', () => {
    expect(showTechniqueFilter([{ id: 1 }, { id: 2 }])).toBe(false)
  })

  it('ne bouge JAMAIS avec la fenêtre ni l’onglet actif : même bibliothèque → même verdict, quel que soit ce qu’on lui passerait d’autre', () => {
    const projects = [{ id: 1, technique: 'knitting' }, { id: 2, technique: 'crochet' }]
    // La signature elle-même le garantit : aucun paramètre de fenêtre/période à faire varier.
    // On rejoue simplement l'appel « pour les 4 périodes et les 2 onglets » en vérifiant que
    // le même tableau de projets rend TOUJOURS le même résultat, peu importe combien de fois
    // ou dans quel ordre on l'appelle.
    for (let i = 0; i < 8; i++) expect(showTechniqueFilter(projects)).toBe(true)
  })
})

// Cas du 11/08 — encadrement des colonnes par mois. Une colonne appartient au mois de son
// LUNDI, le même critère que les étiquettes déjà posées au-dessus de la grille (`monthStart`).
describe('monthGroups — regroupement des colonnes par mois', () => {
  it('un trimestre (13 colonnes, 20/04 → 13/07) donne QUATRE groupes, chacun de la bonne largeur', () => {
    // Mondays : 20/04, 27/04 (avril, ×2) · 04/05…25/05 (mai, ×4) · 01/06…29/06 (juin, ×5) ·
    // 06/07, 13/07 (juillet, ×2). 2+4+5+2 = 13, comme le nombre de colonnes.
    //
    // MUTATION visée : une implémentation qui regrouperait par le mois où TOMBENT LA MAJORITÉ
    // des 7 jours de la colonne (au lieu du lundi) donnerait un résultat DIFFÉRENT ici — la
    // colonne du lundi 29/06 contient 2 jours de juin (29, 30) et 5 jours de juillet
    // (01 → 05) : une règle « majorité » la classerait en JUILLET (juin = 4, juillet = 3),
    // alors que la règle du LUNDI (celle de la spec et des étiquettes déjà en place) la
    // classe en JUIN (juin = 5, juillet = 2). Cette assertion est donc rouge sous l'une des
    // deux règles et verte sous l'autre — elle ne peut pas passer par accident.
    const win = buildWindow(REF, 'quarter')
    const grid = buildGrid(win, sessionsByDay([]))
    const groups = monthGroups(grid)
    expect(groups.map((g) => ({ key: g.key, startIndex: g.startIndex, count: g.count }))).toEqual([
      { key: '2026-04', startIndex: 0, count: 2 },
      { key: '2026-05', startIndex: 2, count: 4 },
      { key: '2026-06', startIndex: 6, count: 5 },
      { key: '2026-07', startIndex: 11, count: 2 },
    ])
    // La somme des largeurs couvre EXACTEMENT les colonnes de la fenêtre, ni plus ni moins.
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(grid.columns.length)
  })

  it('le premier ET le dernier groupe sont PARTIELS — moins de colonnes qu’un mois complet du milieu', () => {
    const win = buildWindow(REF, 'quarter')
    const groups = monthGroups(buildGrid(win, sessionsByDay([])))
    // Avril et juillet (aux deux bords de la fenêtre) n'ont que 2 colonnes chacun, contre 4-5
    // pour mai et juin (entièrement dans la fenêtre) : le rectangle d'un mois de bord doit être
    // plus étroit, jamais aussi large qu'un mois complet — sans quoi il suggérerait un mois
    // entier qui n'a pas été observé en totalité.
    expect(groups[0].count).toBeLessThan(groups[2].count) // avril (2) < juin (5)
    expect(groups[3].count).toBeLessThan(groups[2].count) // juillet (2) < juin (5)
  })

  it('une fenêtre Mois (5 colonnes) peut ne toucher que DEUX mois', () => {
    const win = buildWindow(REF, 'month') // 15/06 → 15/07 : lundis 15/06, 22/06, 29/06, 06/07, 13/07
    const groups = monthGroups(buildGrid(win, sessionsByDay([])))
    expect(groups).toEqual([
      { key: '2026-06', startIndex: 0, count: 3 },
      { key: '2026-07', startIndex: 3, count: 2 },
    ])
  })
})

// Cas du 11/08 — liste des projets d'un jour, jumelle ADDITIVE de sessionsByDay.
describe('sessionsByDayAndProject — détail par projet', () => {
  it('deux projets le même jour restent SÉPARÉS, chacun avec son propre temps', () => {
    const byDay = sessionsByDayAndProject([sess('2026-07-13', 3600, 7), sess('2026-07-13', 600, 9)])
    const parJour = byDay.get('2026-07-13')
    expect(parJour.get(7)).toEqual({ seconds: 3600, count: 1 })
    expect(parJour.get(9)).toEqual({ seconds: 600, count: 1 })
  })

  it('deux séances du MÊME projet le même jour se CUMULENT (pas deux entrées)', () => {
    const byDay = sessionsByDayAndProject([sess('2026-07-13', 600, 7), sess('2026-07-13', 900, 7)])
    const parJour = byDay.get('2026-07-13')
    expect(parJour.size).toBe(1)
    expect(parJour.get(7)).toEqual({ seconds: 1500, count: 2 })
  })

  it('une séance à RANGS SEULS (durée 0) reste une entrée à part entière — pas absorbée ni perdue', () => {
    const byDay = sessionsByDayAndProject([sess('2026-07-13', 0, 7)])
    expect(byDay.get('2026-07-13').get(7)).toEqual({ seconds: 0, count: 1 })
  })

  it('RECOUPEMENT : la somme des temps par projet d’un jour vaut le temps total du jour (sessionsByDay)', () => {
    const sessions = [
      sess('2026-07-13', 3600, 7),
      sess('2026-07-13', 600, 9),
      sess('2026-07-13', 300, 7), // un second passage sur le même projet, même jour
    ]
    const totalJour = sessionsByDay(sessions).get('2026-07-13').seconds
    const parProjet = sessionsByDayAndProject(sessions).get('2026-07-13')
    const sommeProjets = [...parProjet.values()].reduce((n, e) => n + e.seconds, 0)
    expect(sommeProjets).toBe(totalJour)
    expect(totalJour).toBe(4500)
  })

  it('un jour sans aucune séance n’a pas d’entrée', () => {
    expect(sessionsByDayAndProject([sess('2026-07-13', 600, 7)]).get('2026-07-14')).toBeUndefined()
  })
})

describe('dates aberrantes (sauvegarde retouchée)', () => {
  // Protège : une séance datée d'une année hors plage n'entre dans aucun calcul de jour.
  it('dayKeyOf ignore une année hors 1900..année suivante', () => {
    expect(dayKeyOf({ date: '9999-12-31T12:00:00.000Z' })).toBeNull()
    expect(dayKeyOf({ date: '1000-01-01T12:00:00.000Z' })).toBeNull()
    expect(dayKeyOf(sess('2026-07-15', 60))).toBe('2026-07-15')
  })

  // Protège : une fenêtre démesurée est parcourue sur au plus MAX_WINDOW_WEEKS semaines.
  it('longestStreakInWindow borne le parcours aux dernières semaines', () => {
    const days = new Set(['1950-01-01', '1950-01-02', '1950-01-03', '1950-01-04', '2026-07-14', '2026-07-15'])
    expect(longestStreakInWindow(days, { startDay: '1950-01-01', endDay: '2026-07-15' })).toBe(2)
  })

  it('totalSeconds et activeDays bornés de la même façon', () => {
    const byDay = sessionsByDay([sess('2026-07-15', 60)])
    const win = { startDay: '1950-01-01', endDay: '2026-07-15' }
    expect(totalSeconds(win, byDay)).toBe(60)
    expect(activeDays(win, byDay).elapsed).toBeLessThanOrEqual(MAX_WINDOW_WEEKS * 7)
  })

  it('buildGrid garde au plus MAX_WINDOW_WEEKS colonnes, les plus récentes', () => {
    const mondayDays = Array.from({ length: MAX_WINDOW_WEEKS + 50 }, (_, i) => `2026-07-${String((i % 28) + 1).padStart(2, '0')}`)
    const grid = buildGrid({ mondayDays, endDay: '2026-07-15' }, new Map())
    expect(grid.columns).toHaveLength(MAX_WINDOW_WEEKS)
    expect(grid.columns.at(-1).monday).toBe(mondayDays.at(-1))
  })
})
