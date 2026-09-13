// Rowtine — utilitaire debounce générique, trailing-edge, avec `maxWait`.
// Sert de brique à la sauvegarde automatique débouncée sur
// mutation (src/backup/auto-backup.js) : coalesce une rafale de mutations DB
// en un seul appel, tout en garantissant un déclenchement au moins toutes les
// `maxWait` ms si la rafale ne s'arrête jamais assez longtemps pour laisser
// s'écouler `wait`. Pur (aucune dépendance externe), testé aux fake timers.
export function debounce(fn, wait, { maxWait } = {}) {
  let timer = null
  let maxTimer = null
  let lastArgs = null
  let lastThis = null
  let pending = false

  function clearTimers() {
    if (timer) clearTimeout(timer)
    if (maxTimer) clearTimeout(maxTimer)
    timer = null
    maxTimer = null
  }

  function invoke() {
    const args = lastArgs
    const thisArg = lastThis
    pending = false
    lastArgs = null
    lastThis = null
    clearTimers()
    fn.apply(thisArg, args)
  }

  function debounced(...args) {
    lastArgs = args
    lastThis = this
    pending = true
    if (timer) clearTimeout(timer)
    timer = setTimeout(invoke, wait)
    // Le minuteur maxWait n'est armé qu'au DÉBUT d'une rafale (il n'existe pas
    // encore) : il ne bouge plus tant que la rafale continue, ce qui garantit
    // un déclenchement au plus tard `maxWait` ms après le premier appel non
    // encore honoré.
    if (maxWait != null && !maxTimer) {
      maxTimer = setTimeout(invoke, maxWait)
    }
  }

  debounced.cancel = function cancel() {
    pending = false
    lastArgs = null
    lastThis = null
    clearTimers()
  }

  debounced.flush = function flush() {
    if (pending) invoke()
  }

  return debounced
}
