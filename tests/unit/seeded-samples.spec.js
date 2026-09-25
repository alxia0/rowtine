// @vitest-environment jsdom
// Les identifiants créés par le semis du 1er lancement sont ENREGISTRÉS, pas devinés :
// c'est ce qui permet à `isDbRestorable` de distinguer « base neuve avec ses
// 3 exemples » de « base où l'utilisatrice a travaillé », sans jamais se tromper sur
// des données réelles.
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '@/db/db'
import { recordSeededSamples, getSeededSampleIds } from '@/utils/seeded-samples'

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
