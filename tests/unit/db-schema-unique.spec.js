// tests/unit/db-schema-unique.spec.js
// GARDE PERMANENTE du schéma unique (ex-db-fusion-v3-mesure.spec.js, promu le 13/08/2026
// à la fusion des trois `db.version()` de src/db/db.js en une seule).
//
// LA QUESTION, ET RIEN D'AUTRE : sur une base NEUVE, l'unique déclaration de src/db/db.js
// produit-elle EXACTEMENT le schéma que produisait la montée par paliers v1 → v2 → v3 ?
// C'est le seul contrôle qui porte la fusion : sur une base déjà existante, Dexie ne rejoue
// aucune migration, donc rien de ce que la déclaration contient n'y est appliqué (mesuré en
// phase 1) — une déclaration fausse y resterait INVISIBLE. C'est l'installation NEUVE, et
// elle seule, qui applique réellement ce fichier.
//
// ⚠️⚠️ CE TEST IMPORTE LE VRAI `src/db/db.js` (ligne `import { db } from '@/db/db'`
// ci-dessous). Il ne recopie PAS le schéma courant : un test qui recopierait les deux côtés
// de la comparaison serait vert par construction et ne prouverait rien. Seuls les schémas
// HISTORIQUES v1/v2/v3 sont recopiés — ils décrivent un état figé du passé, la référence à
// laquelle le fichier réel doit se comparer, et ne doivent surtout pas suivre ses évolutions.
//
// ⚠️ Ce que la comparaison relève : les index RÉELS, lus dans l'IDBDatabase par
// `backendDB()` — jamais `table.schema.indexes`, qui reflète ce que le CODE a DÉCLARÉ et
// rendrait le test vert quoi qu'il arrive. Le relevé porte `autoIncrement` (sur
// l'objectStore), `unique` et `multiEntry` (sur chaque index) : NEUF tables sur onze portent
// `++id` — la phase 1 en annonçait huit, ce qui était le compte de la v1 SEULE (8 sur 9,
// `settings` exceptée) ; `purchases` en porte une aussi, seules `settings` (clé `key`) et
// `activeDays` (clé `day`) n'en ont pas. Le point 4 ci-dessous les nomme une par une.
// Une déclaration qui écrirait `id` au lieu de `++id` laisserait les deux relevés
// identiques SANS ces trois propriétés, alors qu'elle casse toute insertion dès la première
// installation neuve. Mesuré par mutation le 13/08 (`projects: '++id, …'` → `'id, …'` dans
// src/db/db.js) : ce fichier ROUGIT sur `autoIncrement: false` reçu là où `true` était
// attendu.
//
// Doit être SEUL dans son fichier : il détruit et recrée la base « rowtine ».
import { describe, it, expect } from 'vitest'
import Dexie from 'dexie'
import { db } from '@/db/db'

// Schémas HISTORIQUES, tels que src/db/db.js les déclarait avant la fusion — la référence,
// recopiée volontairement (cf. en-tête).
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

// Relevé des index RÉELLEMENT présents dans IndexedDB, lus par l'API native.
function releverIndexReels(dexie) {
  const brut = dexie.backendDB()
  const noms = Array.from(brut.objectStoreNames)
  const tx = brut.transaction(noms, 'readonly')
  const releve = {}
  for (const nom of noms) {
    const store = tx.objectStore(nom)
    releve[nom] = {
      cle: String(store.keyPath ?? '(auto)'),
      autoIncrement: store.autoIncrement,
      index: Array.from(store.indexNames)
        .sort()
        .map((nomIndex) => {
          const index = store.index(nomIndex)
          return { nom: nomIndex, unique: index.unique, multiEntry: index.multiEntry }
        }),
    }
  }
  return releve
}

describe('schéma unique de src/db/db.js — installation NEUVE', () => {
  it('produit exactement les mêmes index réels que la montée par paliers v1→v2→v3', async () => {
    // 1. La référence : une base neuve montée par paliers, comme le faisait l'app avant.
    await Dexie.delete('rowtine-paliers-reference')
    const paliers = new Dexie('rowtine-paliers-reference')
    paliers.version(1).stores(SCHEMA_V1)
    paliers.version(2).stores(SCHEMA_V2)
    paliers.version(3).stores(SCHEMA_V3)
    await paliers.open()
    const indexPaliers = releverIndexReels(paliers)
    paliers.close()
    await Dexie.delete('rowtine-paliers-reference')

    // 2. Le VRAI fichier du dépôt, sur une base neuve : c'est ici, et ici seulement, que sa
    // déclaration est réellement appliquée par IndexedDB.
    db.close()
    await Dexie.delete('rowtine')
    await db.open()
    expect(db.verno, 'src/db/db.js doit ne déclarer QU’UNE seule version').toBe(1)
    const indexReel = releverIndexReels(db)

    // 3. Table par table, index par index, avec autoIncrement / unique / multiEntry.
    expect(indexReel).toEqual(indexPaliers)

    // 4. Filet indépendant de la référence ci-dessus, au cas où les deux dériveraient
    // ensemble un jour : les onze tables, et les NEUF clés auto-incrémentées nommément
    // (neuf, pas huit : le « 8 sur 11 » qui circulait était le compte de la v1 SEULE,
    // cf. l'en-tête de ce fichier — l'assertion ci-dessous en liste bien neuf).
    expect(Object.keys(indexReel).sort()).toEqual(
      [
        'activeDays',
        'counters',
        'diagrams',
        'patterns',
        'projects',
        'purchases',
        'sections',
        'sessions',
        'settings',
        'trash',
        'yarns',
      ].sort(),
    )
    const autoIncrementees = Object.entries(indexReel)
      .filter(([, t]) => t.autoIncrement)
      .map(([nom]) => nom)
      .sort()
    expect(
      autoIncrementees,
      'une seule ++id oubliée casse toute insertion sur une installation neuve',
    ).toEqual(
      ['counters', 'diagrams', 'patterns', 'projects', 'purchases', 'sections', 'sessions', 'trash', 'yarns'].sort(),
    )
    expect(indexReel.settings.cle).toBe('key') // clé métier, pas d'auto-increment
    expect(indexReel.activeDays.cle).toBe('day') // la clé primaire EST le jour

    // 5. Une insertion réelle sur une base neuve : ce que `++id` garantit et qu'un relevé
    // d'index seul ne montre pas — l'id est attribué tout seul.
    const yarnId = await db.yarns.add({ brand: 'Drops', weight: 'DK', quantity: 6 })
    expect(typeof yarnId).toBe('number')
    const purchaseId = await db.purchases.add({ yarnId, date: '2026-08-13', quantity: 6 })
    expect(typeof purchaseId).toBe('number')
    await db.activeDays.put({ day: '2026-08-13' })
    expect(await db.yarns.where('brand').equals('Drops').count()).toBe(1)
    expect(await db.purchases.where('yarnId').equals(yarnId).count()).toBe(1)
    expect((await db.activeDays.get('2026-08-13')).day).toBe('2026-08-13')

    db.close()
    await Dexie.delete('rowtine')
  })
})
