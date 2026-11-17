// Sème des laines directement dans IndexedDB (table `yarns`), même raison que `writeSetting`
// (helpers.js) : pas d'import du module app sous `vite preview`. Résolu à `tx.oncomplete`.
export async function seedYarns(page, rows) {
  await seedRows(page, 'yarns', rows)
}

// Même chose pour n'importe quelle table (patrons de la reprise de devise, par exemple).
export async function seedRows(page, store, rows) {
  await page.evaluate(
    ({ store, rows }) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('rowtine')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          try {
            const tx = db.transaction(store, 'readwrite')
            for (const r of rows) tx.objectStore(store).add(r)
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
          } catch (e) {
            reject(e)
          } finally {
            db.close()
          }
        }
      }),
    { store, rows },
  )
}

export async function readYarns(page) {
  return readRows(page, 'yarns')
}

export async function readRows(page, store) {
  return page.evaluate(
    (store) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('rowtine')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const r = db.transaction(store, 'readonly').objectStore(store).getAll()
          r.onsuccess = () => {
            resolve(r.result)
            db.close()
          }
          r.onerror = () => {
            reject(r.error)
            db.close()
          }
        }
      }),
    store,
  )
}
