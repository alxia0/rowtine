// Bascule « section faite » d'un projet, piloté par la case des tuiles de section.
// Transforme un readerState ({ done, counters, sectionSnap }) SANS toucher au lecteur
// ni à readerProgress (qui lisent déjà done/counters). Sans perte : au cochage on
// mémorise un instantané de la section ; au décochage on le restaure (sinon on vide).
import { checkableStepsOf, stepIsDone, repeatTotal } from './reader'

export function toggleSectionDone(reader, state = {}, secId, size) {
  const sec = (reader?.sections || []).find((s) => s.id === secId)
  if (!sec) return state
  const steps = checkableStepsOf(sec)
  const done = { ...state.done }
  const counters = { ...state.counters }
  const sectionSnap = { ...state.sectionSnap }
  const complete = steps.length > 0 && steps.every((s) => stepIsDone(s, done, counters, size))

  if (!complete) {
    // COCHER : instantané de l'état d'avant (valeurs présentes uniquement), puis tout marquer.
    const snapDone = {}
    const snapCounters = {}
    for (const s of steps) {
      if (s.repeat) { if (s.id in counters) snapCounters[s.id] = counters[s.id] }
      else if (done[s.id]) snapDone[s.id] = true
    }
    sectionSnap[secId] = { done: snapDone, counters: snapCounters }
    for (const s of steps) {
      if (s.repeat) counters[s.id] = repeatTotal(s, size)
      else done[s.id] = true
    }
  } else {
    // DÉCOCHER : effacer les rangs de la section, puis restaurer l'instantané s'il existe.
    for (const s of steps) {
      if (s.repeat) delete counters[s.id]
      else delete done[s.id]
    }
    const snap = sectionSnap[secId]
    if (snap) {
      for (const id of Object.keys(snap.done || {})) done[id] = true
      for (const id of Object.keys(snap.counters || {})) counters[id] = snap.counters[id]
    }
    delete sectionSnap[secId]
  }
  return { ...state, done, counters, sectionSnap }
}
