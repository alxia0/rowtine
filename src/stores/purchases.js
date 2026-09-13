// src/stores/purchases.js
// Registre d'achats de laine (les travaux sur le budget, 31/07). Une ligne = un lot acquis :
// quantité, prix unitaire, date, bain, devise estampillée à l'écriture.
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db, plain } from '@/db/db'
import { emptyPurchase } from '@/utils/purchases'
import { createLoadGuard } from '@/stores/load-guard'

// Plus récent d'abord. Une ligne SANS date ne peut pas être placée dans la
// chronologie : elle va en fin de liste (même convention que le tri du stock,
// utils/yarn-filter.js:34), et l'id départage à égalité.
function byRecentFirst(a, b) {
  const da = String(a.date || '')
  const db_ = String(b.date || '')
  if (da && db_ && da !== db_) return da < db_ ? 1 : -1
  if (da && !db_) return -1
  if (!da && db_) return 1
  return (b.id || 0) - (a.id || 0)
}

export const usePurchasesStore = defineStore('purchases', () => {
  const purchases = ref([])
  const loaded = ref(false)

  // Jeton de rechargement (cf. `stores/load-guard.js` pour le raisonnement complet et le
  // bug d'origine du 06/08 : deux ajouts enchaînés lançaient deux lectures de la table, et
  // rien ne garantissait qu'elles se terminaient dans l'ordre où elles étaient parties — la
  // 2ᵉ ligne d'achat disparaissait de l'écran Dépenses jusqu'au redémarrage). Même schéma
  // dans les sept autres magasins.
  const loadGuard = createLoadGuard()
  function load() {
    return loadGuard.run(async (isCurrent) => {
      const lines = await db.purchases.orderBy('id').reverse().toArray()
      if (!isCurrent()) return
      purchases.value = lines
      loaded.value = true
    })
  }
  async function add(data) {
    const id = await db.purchases.add({ ...emptyPurchase(), ...plain(data) })
    await load()
    return id
  }
  async function update(id, data) {
    await db.purchases.update(Number(id), plain(data))
    await load()
  }
  async function remove(id) {
    const line = await db.purchases.get(Number(id))
    await db.purchases.delete(Number(id))
    await load()
    return line
  }
  async function restore(line) {
    await db.purchases.put(plain(line))
    await load()
  }
  // Coercion alignée sur `orphanYarn` (qui fait `Number(yarnId)` avant sa requête
  // Dexie) : un appelant qui transmet un identifiant en chaîne (paramètre de route
  // non converti, cas fréquent dans cette appli) doit retrouver les mêmes lignes
  // qu'avec le nombre — pas un tableau vide silencieux. `null`/`undefined` sont un
  // cas à part : `Number(null) === 0` ramènerait par accident des lignes d'id 0, et
  // ne doit PAS non plus servir à lister les lignes orphelines (`yarnId === null`) —
  // cette fonction répond « quelles lignes pour CETTE laine », pas « quelles lignes
  // orphelines » ; sans identifiant valable, la réponse est délibérément vide.
  function forYarn(yarnId) {
    if (yarnId === null || yarnId === undefined) return []
    const id = Number(yarnId)
    return purchases.value.filter((l) => l.yarnId === id).sort(byRecentFirst)
  }
  // Suppression DÉFINITIVE d'une laine : la dépense reste, le lien tombe. Le libellé
  // figé (`yarnLabel`) devient la seule façon de reconnaître la ligne à l'écran.
  async function orphanYarn(yarnId) {
    const ids = (await db.purchases.where('yarnId').equals(Number(yarnId)).toArray()).map((l) => l.id)
    for (const id of ids) await db.purchases.update(id, { yarnId: null })
    await load()
  }

  return { purchases, loaded, load, add, update, remove, restore, forYarn, orphanYarn }
})
