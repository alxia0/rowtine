// Unitaire — utilitaires purs de périodes (semaine lundi / mois / année). Dates INJECTÉES
// (aucun Date.now() non contrôlé dans les asserts) pour rester déterministe.
import { describe, it, expect } from 'vitest'
import {
  startOfWeekMonday,
  startOfWeek,
  startOfMonth,
  startOfYear,
  periodKey,
  aggregateByPeriod,
  currentWeekSeconds,
} from '@/utils/time-periods'

// Repères (vérifiés) : 2026-07-13 = lundi, 2026-07-15 = mercredi, 2026-07-19 = dimanche,
// 2026-07-20 = lundi suivant.
const MON = (h = 0, mi = 0, s = 0, ms = 0) => new Date(2026, 6, 13, h, mi, s, ms)
const WED = (h = 0, mi = 0, s = 0, ms = 0) => new Date(2026, 6, 15, h, mi, s, ms)
const SUN = (h = 0, mi = 0, s = 0, ms = 0) => new Date(2026, 6, 19, h, mi, s, ms)
const NEXT_MON = (h = 0, mi = 0, s = 0, ms = 0) => new Date(2026, 6, 20, h, mi, s, ms)

describe('startOfWeekMonday', () => {
  it('un lundi : inchangé sauf remise à 00:00:00.000', () => {
    const result = startOfWeekMonday(MON(15, 30, 45, 123))
    expect(result.getTime()).toBe(MON(0, 0, 0, 0).getTime())
  })

  it('un mercredi (milieu de semaine) : recule au lundi de la même semaine', () => {
    const result = startOfWeekMonday(WED(9, 0))
    expect(result.getTime()).toBe(MON(0, 0, 0, 0).getTime())
  })

  it('un dimanche : recule de 6 jours au lundi de la semaine qui s’achève, PAS au lendemain', () => {
    const result = startOfWeekMonday(SUN(23, 59, 59, 999))
    expect(result.getTime()).toBe(MON(0, 0, 0, 0).getTime())
    expect(result.getTime()).not.toBe(NEXT_MON(0, 0, 0, 0).getTime())
  })
})

// Cas du 11/08 — premier jour de la semaine choisi dans les Réglages. `firstDay` suit la
// convention Date.getDay() (1 = lundi, 0 = dimanche) et entre TOUJOURS par paramètre — aucune
// date ni réglage implicite. Les DEUX valeurs sont testées, pas seulement le défaut.
describe('startOfWeek(date, firstDay) — les DEUX réglages', () => {
  // 2026-07-12 est un dimanche (vérifié : 07-13 est un lundi). C'est le DÉBUT de la semaine
  // « dimanche » qui contient le mercredi 07-15 — à distinguer de SUN (07-19), qui est le
  // dimanche SUIVANT (fin de la semaine « lundi » du 07-13, début de la semaine « dimanche »
  // d'APRÈS).
  const PREV_SUN = (h = 0, mi = 0, s = 0, ms = 0) => new Date(2026, 6, 12, h, mi, s, ms)

  it('non-régression : firstDay=1 (lundi, défaut implicite) rend EXACTEMENT startOfWeekMonday, sur les 3 repères', () => {
    for (const d of [MON(15, 30), WED(9, 0), SUN(23, 59, 59, 999)]) {
      expect(startOfWeek(d, 1).getTime()).toBe(startOfWeekMonday(d).getTime())
    }
  })

  it('firstDay=0 (dimanche) : un dimanche est INCHANGÉ (sauf 00:00) — pas de recul de 6 jours comme sous lundi', () => {
    const result = startOfWeek(SUN(23, 59, 59, 999), 0) // 07-19, un dimanche
    expect(result.getTime()).toBe(SUN(0, 0, 0, 0).getTime())
  })

  it('firstDay=0 (dimanche) : un mercredi (milieu de semaine) recule au dimanche PRÉCÉDENT — pas celui déjà couvert par firstDay=1', () => {
    const result = startOfWeek(WED(9, 0), 0)
    expect(result.getTime()).toBe(PREV_SUN(0, 0, 0, 0).getTime())
    // Preuve que le réglage a RÉELLEMENT changé la borne : sous lundi, ce même mercredi
    // recule au lundi 07-13, deux jours APRÈS ce dimanche 07-12.
    expect(result.getTime()).not.toBe(startOfWeek(WED(9, 0), 1).getTime())
  })

  it('firstDay=0 (dimanche) : un lundi (07-13) recule d’un jour au dimanche 07-12', () => {
    const result = startOfWeek(MON(15, 30), 0)
    expect(result.getTime()).toBe(PREV_SUN(0, 0, 0, 0).getTime())
  })
})

describe('startOfMonth / startOfYear', () => {
  it('startOfMonth : 1er du mois à 00:00 local', () => {
    const result = startOfMonth(WED(14, 22))
    expect(result.getTime()).toBe(new Date(2026, 6, 1, 0, 0, 0, 0).getTime())
  })

  it('startOfYear : 1er janvier à 00:00 local', () => {
    const result = startOfYear(WED(14, 22))
    expect(result.getTime()).toBe(new Date(2026, 0, 1, 0, 0, 0, 0).getTime())
  })
})

describe('periodKey', () => {
  it('week : date du lundi au format YYYY-MM-DD (pas un numéro de semaine ISO)', () => {
    expect(periodKey(WED(9, 0), 'week')).toBe('2026-07-13')
    expect(periodKey(MON(9, 0), 'week')).toBe('2026-07-13')
  })

  it('month : YYYY-MM', () => {
    expect(periodKey(WED(9, 0), 'month')).toBe('2026-07')
    expect(periodKey(new Date(2026, 0, 20), 'month')).toBe('2026-01') // mois à 2 chiffres, padding
  })

  it('year : YYYY', () => {
    expect(periodKey(WED(9, 0), 'year')).toBe('2026')
  })
})

describe('aggregateByPeriod', () => {
  it('regroupe et somme deux sessions de la même semaine', () => {
    const sessions = [
      { date: MON(8, 0).toISOString(), durationSec: 100 },
      { date: WED(19, 0).toISOString(), durationSec: 50 },
    ]
    const result = aggregateByPeriod(sessions, 'week')
    expect(result).toHaveLength(1)
    expect(result[0].key).toBe('2026-07-13')
    expect(result[0].seconds).toBe(150)
    expect(result[0].startDate.getTime()).toBe(MON(0, 0, 0, 0).getTime())
  })

  it('sépare deux semaines différentes et trie décroissant (plus récent en premier)', () => {
    const sessions = [
      { date: MON(8, 0).toISOString(), durationSec: 100 }, // semaine du 13/07
      { date: NEXT_MON(8, 0).toISOString(), durationSec: 200 }, // semaine du 20/07
    ]
    const result = aggregateByPeriod(sessions, 'week')
    expect(result.map((r) => r.key)).toEqual(['2026-07-20', '2026-07-13'])
    expect(result.map((r) => r.seconds)).toEqual([200, 100])
  })

  it('sessions à cheval sur deux mois : clés distinctes', () => {
    const sessions = [
      { date: new Date(2026, 5, 15, 10, 0).toISOString(), durationSec: 60 }, // juin
      { date: new Date(2026, 6, 15, 10, 0).toISOString(), durationSec: 90 }, // juillet
    ]
    const result = aggregateByPeriod(sessions, 'month')
    expect(result.map((r) => r.key)).toEqual(['2026-07', '2026-06'])
    expect(result.map((r) => r.seconds)).toEqual([90, 60])
  })

  it('ignore les sessions sans date valide (absente ou invalide)', () => {
    const sessions = [
      { date: MON(8, 0).toISOString(), durationSec: 100 },
      { date: null, durationSec: 999 },
      { durationSec: 999 }, // pas de champ date du tout
      { date: 'pas-une-date', durationSec: 999 },
    ]
    const result = aggregateByPeriod(sessions, 'week')
    expect(result).toHaveLength(1)
    expect(result[0].seconds).toBe(100)
  })
})

describe('currentWeekSeconds', () => {
  it('inclut une session pile à lundi 00:00 et exclut le dimanche précédent 23:59:59', () => {
    const now = WED(10, 0)
    const sessions = [
      { date: MON(0, 0, 0, 0).toISOString(), durationSec: 100 }, // borne incluse
      { date: new Date(2026, 6, 12, 23, 59, 59, 999).toISOString(), durationSec: 500 }, // dimanche précédent, exclu
      { date: WED(9, 0).toISOString(), durationSec: 30 },
    ]
    expect(currentWeekSeconds(sessions, now)).toBe(130)
  })

  // Même fixture que ci-dessus, réglage « dimanche » : la séance du 12/07 23:59:59,
  // exclue sous lundi, tombe maintenant DANS la semaine courante (elle commence le 12/07 00:00
  // sous ce réglage). Résultat opposé sur la MÊME fixture : c'est ce qui prouve que le
  // paramètre gouverne réellement la borne, pas seulement qu'il existe.
  it('firstDay=0 (dimanche) : la MÊME fixture inclut la séance du dimanche précédent — résultat opposé au défaut', () => {
    const now = WED(10, 0)
    const sessions = [
      { date: MON(0, 0, 0, 0).toISOString(), durationSec: 100 },
      { date: new Date(2026, 6, 12, 23, 59, 59, 999).toISOString(), durationSec: 500 }, // désormais DANS la semaine
      { date: WED(9, 0).toISOString(), durationSec: 30 },
    ]
    expect(currentWeekSeconds(sessions, now, 0)).toBe(630) // 100 + 500 + 30
    expect(currentWeekSeconds(sessions, now, 0)).not.toBe(currentWeekSeconds(sessions, now, 1))
  })

  it('non-régression : sans 3e argument, currentWeekSeconds garde exactement son comportement (lundi)', () => {
    const now = WED(10, 0)
    const sessions = [{ date: new Date(2026, 6, 12, 23, 59, 59, 999).toISOString(), durationSec: 500 }]
    expect(currentWeekSeconds(sessions, now)).toBe(0)
  })
})

// periodKey/aggregateByPeriod en granularité 'week' suivent aussi `firstDay`, pour que
// les barres de période (onglet Rythme) restent alignées sur le MÊME premier jour que la
// fenêtre/la grille (sinon une incohérence de la même famille que les deux axes de temps opposés
// déjà corrigés par les onglets).
describe('periodKey / aggregateByPeriod — granularité "week" avec firstDay', () => {
  it('periodKey : sous "dimanche", le mercredi 07-15 appartient à la semaine du 07-12 (pas du 07-13)', () => {
    expect(periodKey(WED(9, 0), 'week', 0)).toBe('2026-07-12')
    expect(periodKey(WED(9, 0), 'week', 1)).toBe('2026-07-13')
  })

  it('aggregateByPeriod : sous "dimanche", une séance du dimanche 07-12 et une du mercredi 07-15 tombent dans la MÊME semaine (exclues sous "lundi")', () => {
    const sessions = [
      { date: new Date(2026, 6, 12, 10, 0).toISOString(), durationSec: 100 },
      { date: WED(9, 0).toISOString(), durationSec: 50 },
    ]
    const sousLundi = aggregateByPeriod(sessions, 'week', 1)
    expect(sousLundi).toHaveLength(2) // le dimanche appartient à la semaine PRÉCÉDENTE sous lundi
    const sousDimanche = aggregateByPeriod(sessions, 'week', 0)
    expect(sousDimanche).toHaveLength(1) // les deux tombent dans la même semaine sous dimanche
    expect(sousDimanche[0].seconds).toBe(150)
  })

  it('non-régression : sans 3e argument, aggregateByPeriod garde exactement son comportement (lundi)', () => {
    const sessions = [
      { date: new Date(2026, 6, 12, 10, 0).toISOString(), durationSec: 100 },
      { date: WED(9, 0).toISOString(), durationSec: 50 },
    ]
    expect(aggregateByPeriod(sessions, 'week')).toHaveLength(2)
  })
})
