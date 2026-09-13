// Unitaire — les TROIS décisions pures de « la séance visible dès la pause » (plan du
// 30/08, règle 8) : chunk à committer, adoption de la ligne de fusion, split — ce dernier
// lu sur le `null` de l'adoption depuis le retrait d'`isSplit`, son double devenu mort
// (fonctionnalité laissée de côté). Aucune base
// ici : le store chrono (activeSession) consomme ce module, les tests l'éprouvent sans
// Dexie. Chaque garde porte en commentaire LA mutation qu'elle doit faire passer au rouge
// (cahier des charges du lot) — c'est le seul langage d'un test de décision pure.
import { describe, it, expect } from 'vitest'
import { SESSION_MERGE_GAP_MS, chunkToCommit, adoptMergeTarget } from '@/utils/chrono-episode'

const H = 3_600_000 // une heure en ms, pour lire les écarts comme des heures
// Repère fixe et injecté (aucun Date.now() non contrôlé) : 2026-08-30T12:00:00.000Z, un
// dimanche à midi — jour du design, choisit pour rien d'autre que d'être fixe.
const NOW = Date.UTC(2026, 7, 30, 12, 0, 0)
const iso = (ms) => new Date(ms).toISOString()

// Ligne de journal écrite par le chrono, forme Dexie : `manual` ABSENT (une saisie à la
// main porte `manual: true`), `date` = naissance de la ligne, `lastWriteAt` = dernier
// commit chrono (champ nouveau de ce lot — les lignes anciennes n'en ont pas).
const chronoLine = (over = {}) => ({
  id: 42,
  projectId: 7,
  sectionId: 3,
  date: iso(NOW - 3 * H),
  lastWriteAt: iso(NOW - 10 * 60_000),
  durationSec: 600,
  rowsDone: 5,
  ...over,
})

describe('SESSION_MERGE_GAP_MS', () => {
  it('vaut exactement deux heures', () => {
    // Mutation interceptée : changer la constante (1 h, 90 min...) — la règle métier
    // « fusion si pause < 2 h » vient de l'entrée intend du lot, pas d'un goût du jour.
    expect(SESSION_MERGE_GAP_MS).toBe(2 * 60 * 60 * 1000)
  })
})

describe('chunkToCommit(elapsedSec, committedSec)', () => {
  it('floor : 65,7 s non écrites donnent 65 s, pas 66', () => {
    // Mutation interceptée : Math.round (ou pas de floor du tout) -> 66. Le chrono
    // accumule des deltas Date.now() fractionnaires ; le journal ne vit qu'en secondes
    // entières, et arrondir au-dessus ferait écrire du temps jamais couru.
    expect(chunkToCommit(65.7, 0)).toBe(65)
  })

  it('soustrait le filigrane committedSec : 125,7 écoulées dont 60 committées -> 65', () => {
    // Mutation interceptée : mesurer sur elapsedSec seul (ignorer committedSec) -> 125.
    // Le filigrane est ce qui empêche la double écriture : pause puis fermeture, ou
    // double pause, doivent la deuxième fois ne rien avoir à committer.
    expect(chunkToCommit(125.7, 60)).toBe(65)
  })

  it('0,4 s non écrites -> null (et pas 0)', () => {
    // Mutation interceptée : renvoyer le floor nu -> 0. Sur null le store n'ouvre AUCUNE
    // transaction Dexie ; sur 0 il en ouvrirait une pour écrire une durée vide à chaque
    // double pause — bruit de journal et lastWriteAt rafraîchi pour rien.
    expect(chunkToCommit(0.4, 0)).toBeNull()
    expect(chunkToCommit(0.99, 0)).toBeNull()
  })

  it('1 s pile -> 1 : la borne « au moins 1 s » est incluse', () => {
    // Mutation interceptée : `diff > 1` au lieu de `diff >= 1` -> null. Une seconde de
    // vrai tricot existe ; ne rien écrire à partir de 1 s c'est perdre du temps réel.
    expect(chunkToCommit(1, 0)).toBe(1)
    expect(chunkToCommit(1.2, 0)).toBe(1)
  })

  it('committedSec au-dessus d’elapsedSec -> null, jamais une durée négative', () => {
    // Mutation interceptée : `diff || null` (ou floor nu) -> -2, vérité de -2 non nulle
    // pour ||. Un état recollé (restauration de sauvegarde, recul d'horloge) ne doit
    // pouvoir décrémenter aucune ligne du journal.
    expect(chunkToCommit(10, 12)).toBeNull()
  })

  it('entrées non finies -> null : le contrat est « null ou entier >= 1 », jamais NaN', () => {
    // Mutation interceptée : retirer la garde (renvoyer le floor tel quel) -> NaN se
    // propage jusqu'à durationSec en base. NaN >= 1 est faux, donc la forme du test
    // épingle aussi toute réécriture « optimisée » de la comparaison.
    expect(chunkToCommit(NaN, 0)).toBeNull()
    expect(chunkToCommit(undefined, undefined)).toBeNull()
  })
})

describe('adoptMergeTarget(lastLine, now)', () => {
  it('ligne chrono touchée il y a 10 min -> son id', () => {
    // Cas de base : la fusion micro-séance (sortie/retour rapide du projet) est le but
    // même de la règle. Mutation interceptée : comparaison d'écart inversée -> null.
    expect(adoptMergeTarget(chronoLine(), NOW)).toBe(42)
  })

  it("touchée il y a 2 h moins 1 ms -> adoption : la borne est stricte côté fusion", () => {
    // Mutation interceptée : `< GAP - epsilon` ou arrondi à la minute -> null alors que
    // l'écart est encore dans la fenêtre.
    const ligne = chronoLine({ lastWriteAt: iso(NOW - SESSION_MERGE_GAP_MS + 1) })
    expect(adoptMergeTarget(ligne, NOW)).toBe(42)
  })

  it('touche il y a exactement 2 h -> null : le bord pile est un split', () => {
    // Mutation interceptée : `<` remplacé par `<=` -> 42. Décision du design : à 2 h
    // piles de pause, l'épisode est déclaré mort ; les deux moitiés du bord (2 h - 1 ms
    // / 2 h pile) pinnent la comparaison de part et d'autre.
    const ligne = chronoLine({ lastWriteAt: iso(NOW - SESSION_MERGE_GAP_MS) })
    expect(adoptMergeTarget(ligne, NOW)).toBeNull()
    const vieux = chronoLine({ lastWriteAt: iso(NOW - 3 * H) })
    expect(adoptMergeTarget(vieux, NOW)).toBeNull()
  })

  it('dernière ligne manuelle -> null, même saisie il y a 1 min', () => {
    // Mutation interceptée : retirer le filtre `manual` -> 42. Une ligne saisie à la
    // main (et les rangs corrigés inline qui vivent dessus) appartient à l'utilisatrice :
    // le chrono ne grossit JAMAIS une ligne qu'il n'a pas écrite.
    const ligne = chronoLine({ manual: true, lastWriteAt: iso(NOW - 60_000) })
    expect(adoptMergeTarget(ligne, NOW)).toBeNull()
  })

  it('mesure sur lastWriteAt, pas sur date : née il y a 3 h, touchée il y a 10 min -> adoption', () => {
    // Mutation interceptée : mesurer l'écart sur `date` -> 3 h >= GAP -> null. `date`
    // est l'acte de naissance de la ligne, pas son dernier contact : la mèche des 2 h
    // redémarre à CHAQUE commit du chrono (règle 2 du plan).
    const ligne = chronoLine({ date: iso(NOW - 3 * H), lastWriteAt: iso(NOW - 10 * 60_000) })
    expect(adoptMergeTarget(ligne, NOW)).toBe(42)
  })

  it('repli sur date pour une ligne ancienne sans lastWriteAt (touchée il y a 30 min -> adoption)', () => {
    // Mutation interceptée : mesurer sur `lastWriteAt` seul (sans repli `|| date`) ->
    // âge illisible -> null. `lastWriteAt` naît avec CE lot : toutes les lignes déjà en
    // base n'en ont pas, et doivent pourtant pouvoir fusionner.
    const ancienne = { id: 42, projectId: 7, sectionId: 3, date: iso(NOW - 30 * 60_000), durationSec: 900, rowsDone: 2 }
    expect(adoptMergeTarget(ancienne, NOW)).toBe(42)
  })

  it('aucune ligne (null ou undefined) -> null, sans lever', () => {
    // Mutation interceptée : lire line.manual sans garde -> TypeError. La requête
    // « dernière ligne non manuelle » peut ne rien renvoyer : projet neuf, ou toutes les
    // lignes du projet sont manuelles ou supprimées.
    expect(adoptMergeTarget(null, NOW)).toBeNull()
    expect(adoptMergeTarget(undefined, NOW)).toBeNull()
  })

  it('âge illisible (ni lastWriteAt ni date, ou date foutue) -> null : le refus est le côté sûr', () => {
    // Mutation interceptée : traiter un âge illisible comme adoptable (NaN < GAP
    // évalué « vrai » via une coercition) -> 42. Une ligne d'âge inconnu peut être
    // d'hier comme de l'an dernier : fusionner dedans au jugé, c'est grossir une ligne
    // peut-être fossile ; le split ne casse rien.
    expect(adoptMergeTarget({ id: 42, projectId: 7, durationSec: 10 }, NOW)).toBeNull()
    expect(adoptMergeTarget(chronoLine({ date: 'pas-une-date', lastWriteAt: undefined }), NOW)).toBeNull()
  })
})

// Le split (repartir à zéro) n'a plus de fonction propre : `isSplit`, double de l'adoption,
// a été retiré (fonctionnalité laissée de côté). Vu du play(), l'épisode
// est neuf EXACTEMENT quand `adoptMergeTarget(lastLine, now) === null` — on rejoue ici les
// mêmes cas sous cet angle, pour que la règle du split survive à la disparition de son
// ancien nom (une divergence entre les deux describes doit être impossible : même fonction).
describe('split (vu du store) — adoptMergeTarget(lastLine, now) === null', () => {
  it('reprise sous la fenêtre -> non null : l épisode continue dans sa ligne', () => {
    // Mutation interceptée : un split à tort (règle lue inversée) remettrait le triplet à
    // zéro au moment même où le chrono vient de fusionner dans sa ligne.
    expect(adoptMergeTarget(chronoLine(), NOW)).not.toBeNull()
  })

  it("reprise à 2 h pile ou au-delà -> null : épisode neuf, pastille à zéro", () => {
    // Mutation interceptée : `<=` côté adoption rendrait non-null au bord pile — le bord
    // est pinné de l'autre côté (2 h − 1 ms -> non-null) par le describe adoptMergeTarget.
    expect(adoptMergeTarget(chronoLine({ lastWriteAt: iso(NOW - SESSION_MERGE_GAP_MS) }), NOW)).toBeNull()
    expect(adoptMergeTarget(chronoLine({ lastWriteAt: iso(NOW - 5 * H) }), NOW)).toBeNull()
  })

  it("pas de ligne, ligne manuelle, âge illisible -> null : rien à fusionner, épisode neuf", () => {
    // Mutation interceptée : ne tester QUE l'écart horaire (oublier manuel/absence de
    // ligne) -> non-null. Le split est la décision par défaut quand il n'existe aucune
    // cible saine : projet vierge, dernière saisie manuelle, données exotiques.
    expect(adoptMergeTarget(null, NOW)).toBeNull()
    expect(adoptMergeTarget(chronoLine({ manual: true }), NOW)).toBeNull()
    expect(adoptMergeTarget({ id: 9, projectId: 7, durationSec: 10 }, NOW)).toBeNull()
  })
})
