// Une date de l'app ('YYYY-MM-DD') affichée dans la langue de l'utilisatrice, SANS reculer
// d'un jour. C'est tout l'enjeu : `new Date('2026-08-07')` est interprété en UTC, donc à
// l'ouest de Greenwich il rend le 6 août.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { formatLocalDate } from '@/utils/date-format'

describe('formatLocalDate', () => {
  it('1. rend la date dans la langue demandée', () => {
    expect(formatLocalDate('2026-08-07', 'fr')).toBe('07/08/2026')
    expect(formatLocalDate('2026-08-07', 'de')).toBe('7.8.2026')
  })

  it('2. une date-instant (heure incluse) se lit au jour LOCAL de la machine, pas tronquée en UTC', () => {
    // Renommé et l'attente CHANGÉE (revue du 10/08) : ce test s'appelait « tronque une date
    // ISO longue au jour » et attendait '07/08/2026' — c'était le jour UTC tronqué de la
    // chaîne, pas le jour local. Sous Europe/Paris (fuseau de CETTE machine, UTC+2 en août),
    // 22 h 30 UTC le 7 août, c'est déjà minuit passé le 8 août en heure locale : le bon jour
    // est le 8, pas le 7. L'ancienne attente encodait le défaut que ce correctif corrige (une
    // séance minutée près de minuit UTC s'affichait la veille de son vrai jour local).
    expect(formatLocalDate('2026-08-07T22:30:00.000Z', 'fr')).toBe('08/08/2026')
  })

  it('3. rien à afficher ⇒ chaîne vide, jamais « Invalid Date »', () => {
    for (const v of ['', null, undefined]) expect(formatLocalDate(v, 'fr')).toBe('')
  })

  it('4. valeur illisible ⇒ repli sur la valeur brute, aucune exception', () => {
    expect(formatLocalDate('bientôt', 'fr')).toBe('bientôt')
  })
})

// Deux formes distinctes, deux comportements (revue du 10/08, après le défaut de lecture
// trouvé lors du travail sur « grille calendaire du temps ») : une date-JOUR ('AAAA-MM-JJ', ex.
// startedAt/finishedAt/purchasedAt) désigne un jour SANS heure ni fuseau — la découper est
// exact. Une date-INSTANT (ISO complète, ex. le `date` d'une séance) désigne un MOMENT dont
// le jour dépend d'OÙ on se trouvait — il se lit avec `ymdLocal(new Date(value))`, jamais en
// tronquant la chaîne UTC. Voir le commentaire de `formatLocalDate` (src/utils/date-format.js)
// pour le détail complet du raisonnement.
describe('formatLocalDate — date-instant, fuseau de la machine (Europe/Paris)', () => {
  it('5b. une séance minutée à 23 h UTC est déjà le LENDEMAIN ici — PREUVE DU CORRECTIF', () => {
    // Cette assertion est FAUSSE avec l'ancien code (`slice(0, 10)` aurait tronqué la chaîne
    // UTC et rendu '10/08/2026', le jour du 'T' et non le jour local) : c'est elle qui
    // prouve que la relecture d'une date-instant passe désormais par le jour LOCAL.
    expect(formatLocalDate('2026-08-10T23:00:00.000Z', 'fr')).toBe('11/08/2026')
  })
})

// Le fuseau de la machine (Europe/Paris) est à l'EST de Greenwich : la version buguée et la
// bonne y donnent le MÊME résultat, un test écrit dans ce fuseau ne peut donc pas mordre.
// MESURÉ le 08/08 : `process.env.TZ` prend effet à chaud dans ce Node — on bascule à l'ouest
// le temps de ce bloc, et le témoin ci-dessous prouve que la bascule a bien eu lieu.
describe('formatLocalDate — à l’ouest de Greenwich', () => {
  const TZ_ORIGINE = process.env.TZ
  beforeEach(() => {
    process.env.TZ = 'America/New_York'
  })
  afterEach(() => {
    if (TZ_ORIGINE === undefined) delete process.env.TZ
    else process.env.TZ = TZ_ORIGINE
  })

  it('5. ne recule PAS d’un jour (le piège que cette fonction existe pour éviter)', () => {
    // TÉMOIN, à garder : il prouve que la bascule de fuseau a réellement pris effet. Sans
    // lui, l'assertion suivante passerait trivialement le jour où la bascule cesserait de
    // fonctionner — et le test ne prouverait plus rien.
    expect(new Date('2026-08-07').toLocaleDateString('fr')).toBe('06/08/2026')
    // Mutation qui doit faire rougir : `new Date(String(value).slice(0, 10))`.
    expect(formatLocalDate('2026-08-07', 'fr')).toBe('07/08/2026')
  })
})

// Bascule reprise du bloc ci-dessus (même mesure du 08/08) : le témoin du bloc précédent
// prouve déjà que `process.env.TZ` prend effet à chaud dans ce Node — le mécanisme ne dépend
// pas de LA zone choisie, pas besoin de le reprouver ici pour America/Los_Angeles.
describe('formatLocalDate — date-jour et date-instant, vues depuis l’ouest (America/Los_Angeles)', () => {
  const TZ_ORIGINE = process.env.TZ
  beforeEach(() => {
    process.env.TZ = 'America/Los_Angeles'
  })
  afterEach(() => {
    if (TZ_ORIGINE === undefined) delete process.env.TZ
    else process.env.TZ = TZ_ORIGINE
  })

  it('6. non-régression : une date-JOUR reste juste aussi à l’ouest', () => {
    expect(formatLocalDate('2026-08-07', 'fr')).toBe('07/08/2026')
  })

  it('7. une date-instant proche de minuit UTC est encore la VEILLE ici — PREUVE DU CORRECTIF', () => {
    // 2026-08-11T02:00:00.000Z = 10 août 19 h heure du Pacifique (UTC-7 en août, heure
    // d'été) : le jour LOCAL n'est pas celui que porte la date UTC. Fausse avec l'ancien
    // code (`slice(0, 10)` aurait rendu '11/08/2026', le jour UTC).
    expect(formatLocalDate('2026-08-11T02:00:00.000Z', 'fr')).toBe('10/08/2026')
  })
})
