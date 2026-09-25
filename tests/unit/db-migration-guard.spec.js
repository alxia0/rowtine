// @vitest-environment jsdom
// tests/unit/db-migration-guard.spec.js
// Filet de sécurité de l'unique déclaration de schéma (cf. src/db/db.js). La question
// qu'il posait jusqu'au 13/08/2026 — « une base v1 monte-t-elle vers le schéma courant ? »
// — n'a plus d'objet : le fichier ne déclare plus qu'une seule `db.version(1)` portant les
// onze tables, il n'y a plus de montée de version à rejouer.
//
// LA QUESTION QUI LA REMPLACE, et qui est la seule qui compte au moment du ménage pré-1.0 :
// UNE BASE ÉCRITE PAR L'APK ACTUELLEMENT INSTALLÉ S'OUVRE-T-ELLE AVEC CE CODE ?
// L'APK installé sur les deux appareils de la maison a construit sa base par paliers
// v1 → v2 → v3, donc à la version 30 côté IndexedDB (Dexie multiplie par 10). Le code
// réduit, lui, ne déclare plus que la version 10. C'est exactement le scénario du
// garde-fou de démarrage (src/db/version-guard.js), et ce test l'exerce de bout en bout
// contre le VRAI singleton `db` du dépôt — jamais contre une copie du schéma.
//
// ⚠️ Ce que ce fichier vérifie N'EST PAS que « tout va bien » : la phase 1 a mesuré, et le
// Pixel 7 a confirmé, qu'un code déclarant MOINS DE TABLES que la base voit ces tables
// disparaître EN SILENCE et bloque toute sauvegarde automatique sans un mot. La fusion
// déclare les onze tables, donc aucune ne manque — mais c'est un fait à MESURER, pas à
// déduire : les assertions ci-dessous le vérifient une par une, y compris la collecte de
// sauvegarde réelle (`collectBackupData`), qui est ce qui s'arrêtait entièrement.
//
// Doit être le seul test du fichier : il détruit et recrée la base « rowtine ».
import { describe, it, expect, afterEach } from 'vitest'
import Dexie from 'dexie'
import { db } from '@/db/db'
import { collectBackupData } from '@/backup/collect'
import { checkVersionGuardOnStartup, versionGuardState } from '@/db/version-guard'

// Schémas HISTORIQUES, tels que src/db/db.js les déclarait en trois versions avant la
// fusion du 13/08/2026 — recopiés VOLONTAIREMENT (et non importés) : ils décrivent l'état
// figé d'une base déjà écrite sur un appareil, qui ne doit pas suivre les évolutions
// futures du module. Le schéma COURANT, lui, n'est jamais recopié ici : il arrive par
// l'import de `@/db/db` ci-dessus.
const SCHEMA_V1 = {
  projects: '++id, name, technique, status, startedAt, finishedAt',
  yarns: '++id, brand, weight, reservedFor',
  patterns: '++id, name, type, category',
  sections: '++id, projectId, patternId, state, order',
  diagrams: '++id, projectId, patternId, sectionId',
  counters: '++id, projectId, name',
  sessions: '++id, projectId, sectionId, date',
  settings: 'key',
  trash: '++id, type, deletedAt',
}
const SCHEMA_V2 = { purchases: '++id, yarnId, date' }
const SCHEMA_V3 = { activeDays: 'day' }

afterEach(() => {
  versionGuardState.triggered = false
})

describe("base écrite par l'APK installé (paliers v1→v2→v3, version 30) ouverte par le code fusionné (version 10)", () => {
  it('ouvre sans erreur, garde les onze tables visibles et leurs données, sauvegarde comprise', async () => {
    // 1. La base de l'appareil : construite par paliers, comme l'a fait l'APK installé.
    db.close()
    await Dexie.delete('rowtine')

    const appareil = new Dexie('rowtine')
    appareil.version(1).stores(SCHEMA_V1)
    appareil.version(2).stores(SCHEMA_V2)
    appareil.version(3).stores(SCHEMA_V3)
    await appareil.open()
    expect(appareil.verno).toBe(3)
    // Prémisse du test : la base est RÉELLEMENT à 30 côté IndexedDB. Sans elle, tout ce
    // qui suit pourrait passer contre une base neuve et ne rien prouver.
    expect(appareil.backendDB().version).toBe(30)

    const projectId = await appareil.projects.add({
      name: 'Pull marin',
      technique: 'knitting',
      status: 'wip',
      startedAt: '2026-01-05',
    })
    const yarnId = await appareil.yarns.add({
      brand: 'Drops',
      colorName: 'Bleu nuit',
      weight: 'DK',
      quantity: 6,
      price: '4,90',
    })
    const patternId = await appareil.patterns.add({
      name: 'Écharpe torsadée',
      type: 'knitting',
      category: 'accessoire',
      sections: [{ name: 'Corps', instructions: 'Rg 1\nRg 2' }],
    })
    await appareil.sections.add({ projectId, patternId, state: 'todo', order: 0 })
    await appareil.settings.put({ key: 'currency', value: 'EUR' })
    const purchaseId = await appareil.purchases.add({ yarnId, kind: 'buy', quantity: 6, unitPrice: '4,90' })
    await appareil.activeDays.put({ day: '2026-08-11' })
    appareil.close()

    // 2. Le nouveau code ouvre cette base — le singleton réel du dépôt, celui que l'app
    // utilise au lancement. Aucune erreur ne doit remonter.
    let erreur = null
    try {
      await db.open()
    } catch (e) {
      erreur = e
    }
    expect(erreur).toBeNull()
    expect(db.verno).toBe(1) // le code déclare bien UNE seule version

    // 3. Le fait que la phase 1 a rendu dangereux : une table déclarée en moins devient
    // INVISIBLE en silence. Les onze doivent être là, comme PROPRIÉTÉS (c'est par la
    // propriété que tout le code applicatif y accède, `db.purchases.toArray()` etc. —
    // `db.table('x')`, lui, lève proprement, ce qui n'est PAS le chemin réel).
    const attendues = [
      'projects', 'yarns', 'patterns', 'sections', 'diagrams', 'counters',
      'sessions', 'settings', 'trash', 'purchases', 'activeDays',
    ]
    for (const nom of attendues) {
      expect(db[nom], `table ${nom} invisible au code : elle disparaîtrait en silence`).toBeDefined()
    }
    expect(db.tables.map((t) => t.name).sort()).toEqual([...attendues].sort())

    // 4. Les données écrites par l'APK installé sont intactes et lisibles.
    expect(await db.projects.get(projectId)).toMatchObject({
      name: 'Pull marin',
      technique: 'knitting',
      status: 'wip',
      startedAt: '2026-01-05',
    })
    expect(await db.yarns.get(yarnId)).toMatchObject({
      brand: 'Drops',
      colorName: 'Bleu nuit',
      weight: 'DK',
      quantity: 6,
      price: '4,90',
    })
    const pattern = await db.patterns.get(patternId)
    expect(pattern).toMatchObject({ name: 'Écharpe torsadée', type: 'knitting', category: 'accessoire' })
    expect(pattern.sections).toEqual([{ name: 'Corps', instructions: 'Rg 1\nRg 2' }])
    expect(await db.sections.count()).toBe(1)
    expect((await db.settings.get('currency')).value).toBe('EUR')
    expect((await db.purchases.get(purchaseId)).yarnId).toBe(yarnId)
    expect((await db.activeDays.get('2026-08-11')).day).toBe('2026-08-11')

    // 5. L'écriture fonctionne encore, sur les deux tables ex-v2/v3 comme sur les autres,
    // et les requêtes INDEXÉES aussi (un index perdu se verrait ici).
    const nouvelAchat = await db.purchases.add({ yarnId, kind: 'buy', quantity: 2, unitPrice: '5,10' })
    expect(await db.purchases.where('yarnId').equals(yarnId).count()).toBe(2)
    await db.activeDays.put({ day: '2026-08-13' })
    await db.activeDays.put({ day: '2026-08-13' }) // clé primaire = le jour ⇒ idempotent
    expect(await db.activeDays.count()).toBe(2)
    expect(await db.yarns.where('brand').equals('Drops').count()).toBe(1)
    await db.purchases.delete(nouvelAchat)

    // 6. LA SAUVEGARDE AUTOMATIQUE — ce qui s'arrêtait ENTIÈREMENT et sans un mot dans le
    // scénario mesuré en phase 1 (`collect.js` nomme chaque table une par une : une seule
    // manquante fait rejeter toute la collecte, aucun fichier n'est réécrit, et la seule
    // trace est la date des Réglages qui cesse d'avancer). Ici, la collecte RÉELLE doit
    // rendre un snapshot COMPLET, achats et jours actifs compris.
    const snapshot = await collectBackupData()
    expect(snapshot.purchases).toHaveLength(1)
    expect(snapshot.purchases[0].id).toBe(purchaseId)
    expect(snapshot.activeDays.map((j) => j.day).sort()).toEqual(['2026-08-11', '2026-08-13'])
    expect(snapshot.yarns).toHaveLength(1)
    expect(snapshot.projects).toHaveLength(1)

    // 7. La base reste à 30 côté IndexedDB : Dexie ne renumérote pas vers le bas. C'est
    // précisément ce qui fait que le garde-fou de démarrage se déclenche — vérifié ici sur
    // le chemin de production exact (aucune injection), contre cette base réelle.
    expect(db.backendDB().version).toBe(30)
    versionGuardState.triggered = false
    await checkVersionGuardOnStartup()
    expect(
      versionGuardState.triggered,
      'base 30 contre un code en 10 : le garde-fou doit prévenir, jamais laisser la situation muette',
    ).toBe(true)

    db.close()
    await Dexie.delete('rowtine')
  })
})
