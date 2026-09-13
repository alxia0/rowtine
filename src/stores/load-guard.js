// Jeton de rechargement générique, partagé par les stores dont `load()`/`loadForProject()`
// relit une table Dexie en entier (cf. bug du 06/08, mesuré sur `stores/purchases.js` : deux
// écritures rapprochées lancent deux lectures, et RIEN ne garantit qu'elles se terminent dans
// l'ordre où elles sont parties). Sans garde, une lecture PARTIE avant une autre pouvait
// réassigner son instantané par-dessus une lecture plus récente : une ligne pourtant bien en
// base disparaissait de l'écran jusqu'au redémarrage.
//
// `run(worker)` incrémente le jeton puis appelle `worker(isCurrent)`. `worker` doit vérifier
// `isCurrent()` juste avant d'écrire son résultat dans l'état réactif (`if (!isCurrent()) return`)
// — tout ce qui précède cette écriture (la lecture Dexie elle-même) s'exécute sans condition.
// Un lancement dépassé n'écrit rien et sa promesse ATTEND celle du gagnant : `await load()`
// reste ainsi toujours synonyme de « l'état reflète la dernière écriture ». Sortir sèchement
// dès qu'un appel est dépassé romprait cette garantie pour qui lit l'état juste après son
// `await` (ex. `useProjectConsumption.requestStatusChange()` sur une liste encore périmée).
export function createLoadGuard() {
  let token = 0
  let latest = Promise.resolve()
  function run(worker) {
    const mine = ++token
    const isCurrent = () => mine === token
    latest = (async () => {
      const result = await worker(isCurrent)
      return isCurrent() ? result : latest
    })()
    return latest
  }
  return { run }
}
