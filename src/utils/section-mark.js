// Bascule « section faite » d'un projet, piloté par la case des tuiles de section.
// Transforme un readerState ({ done, counters, sectionSnap }) SANS toucher au lecteur
// ni à readerProgress (qui lisent déjà done/counters). Sans perte : au cochage on
// mémorise un instantané de la section ; au décochage on le restaure (sinon on vide).
import { checkableStepsOf, stepIsDone, repeatTotal } from './reader'
import { copiesOf, copyView, withCopyView } from './section-copies'

// Exemplaire 1 aux clés historiques (done/counters), exemplaires 2+ dans copyState : on ne
// mute jamais les objets rendus par copyView (références de l'état), on les copie d'abord.
export function toggleSectionDone(reader, state = {}, secId, size) {
  const sec = (reader?.sections || []).find((s) => s.id === secId)
  if (!sec) return state
  const steps = checkableStepsOf(sec)
  const n = copiesOf(sec)
  const sectionSnap = { ...state.sectionSnap }
  const views = []
  for (let c = 1; c <= n; c++) {
    const v = copyView(state, c)
    views.push({ done: { ...v.done }, counters: { ...v.counters } })
  }
  const complete =
    steps.length > 0 && views.every((v) => steps.every((s) => stepIsDone(s, v.done, v.counters, size)))

  if (!complete) {
    // COCHER : instantané de l'état d'avant (valeurs présentes uniquement), puis tout marquer.
    const snaps = views.map(({ done, counters }) => {
      const snapDone = {}
      const snapCounters = {}
      for (const s of steps) {
        if (s.repeat) { if (s.id in counters) snapCounters[s.id] = counters[s.id] }
        else if (done[s.id]) snapDone[s.id] = true
      }
      return { done: snapDone, counters: snapCounters }
    })
    const snap = snaps[0]
    if (n > 1) {
      snap.copies = {}
      for (let c = 2; c <= n; c++) snap.copies[c] = snaps[c - 1]
    }
    sectionSnap[secId] = snap
    for (const { done, counters } of views) {
      for (const s of steps) {
        if (s.repeat) counters[s.id] = repeatTotal(s, size)
        else done[s.id] = true
      }
    }
  } else {
    // DÉCOCHER : effacer les rangs de la section, puis restaurer l'instantané s'il existe.
    const snap = sectionSnap[secId]
    views.forEach(({ done, counters }, i) => {
      for (const s of steps) {
        if (s.repeat) delete counters[s.id]
        else delete done[s.id]
      }
      const part = i === 0 ? snap : snap?.copies?.[i + 1]
      if (part) {
        for (const id of Object.keys(part.done || {})) done[id] = true
        for (const id of Object.keys(part.counters || {})) counters[id] = part.counters[id]
      }
    })
    delete sectionSnap[secId]
  }
  let next = { ...state }
  views.forEach((v, i) => { next = withCopyView(next, i + 1, v) })
  return { ...next, sectionSnap }
}
