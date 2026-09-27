// @vitest-environment jsdom
// Les identifiants créés par le semis du 1er lancement sont ENREGISTRÉS, pas devinés :
// c'est ce qui permet à `isDbRestorable` de distinguer « base neuve avec ses
// 3 exemples » de « base où l'utilisatrice a travaillé », sans jamais se tromper sur
// des données réelles.
import { describe, it, expect, beforeEach } from 'vitest'
import { db, setSetting } from '@/db/db'
import { recordSeededSamples, getSeededSampleIds, getTourProjectIds, isSampleOnlyHome } from '@/utils/seeded-samples'

describe('mémoire des exemples semés', () => {
  beforeEach(async () => {
    await db.settings.clear()
  })

  it('sans rien d’enregistré, renvoie des tableaux vides (repli sûr)', async () => {
    expect(await getSeededSampleIds()).toEqual({ patterns: [], projects: [] })
  })

  it('relit ce qui a été enregistré', async () => {
    await recordSeededSamples({ patterns: [7, 8, 9], projects: [3, 4] })
    expect(await getSeededSampleIds()).toEqual({ patterns: [7, 8, 9], projects: [3, 4] })
  })

  it('normalise en entiers strictement positifs, écarte le bruit et déduplique', async () => {
    // Un identifiant Dexie est TOUJOURS un entier strictement positif : tout le reste est
    // du bruit à écarter, y compris ce qui se coercerait naïvement en nombre (`''`,
    // `false`, `[]` valent 0 par `Number()`) et ce qui n'est pas un entier positif (0,
    // négatif, flottant). Le doublon de `7` vérifie la déduplication : une longueur
    // gonflée par du bruit ou des doublons rendrait une comparaison par LONGUEUR
    // permissive dans le sens dangereux — prendre du travail réel pour un exemple.
    await recordSeededSamples({
      patterns: ['7', null, 8, undefined, NaN, '', false, [], 'abc', 0, -1, 1.5, 7],
      projects: [3, 3, 4],
    })
    expect(await getSeededSampleIds()).toEqual({ patterns: [7, 8], projects: [3, 4] })
  })

  it('un second enregistrement remplace le premier (idempotent)', async () => {
    await recordSeededSamples({ patterns: [1], projects: [1] })
    await recordSeededSamples({ patterns: [5, 6], projects: [2] })
    expect(await getSeededSampleIds()).toEqual({ patterns: [5, 6], projects: [2] })
  })

  it('un réglage corrompu se comporte comme « rien d’enregistré »', async () => {
    await db.settings.put({ key: 'seededSampleIds', value: 'pas un objet' })
    expect(await getSeededSampleIds()).toEqual({ patterns: [], projects: [] })
  })

  // Le 3e cas de repli, distinct des deux précédents : ici le réglage EXISTE et est bien
  // formé, mais enregistre explicitement « aucun exemple ». C'est le cas le plus subtil :
  // c'est celui où `isDbRestorable` doit s'en tenir à la garde stricte
  // (aucun id de secours ne doit apparaître), pas un cas qu'on peut déduire du repli sur
  // absence/corruption.
  it('un réglage présent mais vide reste vide (pas confondu avec absent/corrompu)', async () => {
    await recordSeededSamples({ patterns: [], projects: [] })
    expect(await getSeededSampleIds()).toEqual({ patterns: [], projects: [] })
  })
})

describe('projet de la visite guidée', () => {
  beforeEach(async () => {
    await db.settings.clear()
  })

  // Protège la lecture bornée partagée par l'accueil et isDbRestorable.
  it('renvoie [id] pour un entier strictement positif, [] sinon', async () => {
    expect(await getTourProjectIds()).toEqual([])
    await setSetting('tourProjectId', 12)
    expect(await getTourProjectIds()).toEqual([12])
    await setSetting('tourProjectId', '12')
    expect(await getTourProjectIds()).toEqual([12])
    for (const bruit of [0, -3, 1.5, 'abc', null]) {
      await setSetting('tourProjectId', bruit)
      expect(await getTourProjectIds()).toEqual([])
    }
  })
})

describe('accueil allégé (isSampleOnlyHome)', () => {
  const seeded = { patterns: [7, 8, 9], projects: [3, 4] }

  // Protège le cas nominal : une base neuve avec ses seuls exemples.
  it('exemples seuls : vrai', () => {
    expect(
      isSampleOnlyHome({ projects: [{ id: 3 }, { id: 4 }], libraryPatterns: [{ id: 7 }, { id: 8 }, { id: 9 }], seeded }),
    ).toBe(true)
  })

  // Protège la sortie du mode allégé dès le premier projet à soi.
  it('un projet non semé : faux', () => {
    expect(isSampleOnlyHome({ projects: [{ id: 3 }, { id: 5 }], libraryPatterns: [], seeded })).toBe(false)
  })

  // Protège la sortie du mode allégé dès le premier patron importé.
  it('un patron de bibliothèque non semé : faux', () => {
    expect(isSampleOnlyHome({ projects: [{ id: 3 }], libraryPatterns: [{ id: 7 }, { id: 10 }], seeded })).toBe(false)
  })

  // Protège le projet de visite recréé hors semis : il reste un exemple.
  it('projet de visite recréé : vrai', () => {
    expect(isSampleOnlyHome({ projects: [{ id: 3 }, { id: 20 }], libraryPatterns: [], seeded, tourProjectIds: [20] })).toBe(
      true,
    )
  })

  // Protège la visite guidée : avancer sur un exemple ne fait pas quitter le mode allégé.
  it('avancement sur un exemple : reste vrai', () => {
    const bonnet = { id: 4, readerState: { s1: { done: 3 } }, lastWorkedAt: '2026-09-26T08:00:00', photos: ['x'] }
    expect(isSampleOnlyHome({ projects: [bonnet], libraryPatterns: [], seeded })).toBe(true)
  })

  // Protège la base vidée de ses exemples : l'import reste mis en avant.
  it('base vide : vrai', () => {
    expect(isSampleOnlyHome({ projects: [], libraryPatterns: [], seeded })).toBe(true)
  })

  // Protège les installations antérieures au semis enregistré : leur contenu garde l'accueil complet.
  it('aucun id enregistré : vrai seulement sans contenu', () => {
    const vide = { patterns: [], projects: [] }
    expect(isSampleOnlyHome({ projects: [], libraryPatterns: [], seeded: vide })).toBe(true)
    expect(isSampleOnlyHome({ projects: [{ id: 1 }], libraryPatterns: [], seeded: vide })).toBe(false)
    expect(isSampleOnlyHome({ projects: [], libraryPatterns: [{ id: 1 }], seeded: vide })).toBe(false)
  })
})
