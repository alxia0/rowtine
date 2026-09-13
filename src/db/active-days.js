// Rowtine — journal des jours actifs. Les DEUX seules opérations du journal.
// Isolées dans leur propre module plutôt que dans le store `projects` : la lecture sert à
// l'écran Statistiques, qui n'a rien à voir avec le store des projets, et l'écriture doit
// pouvoir être testée sans monter aucun composant.
import { db } from '@/db/db'
import { ymdLocal } from '@/utils/time-periods'

// Inscrit le JOUR LOCAL de `instant` (une valeur de `lastWorkedAt` : chaîne ISO ou Date).
// `put` sur une clé primaire qui EST le jour ⇒ idempotent : rien à lire d'abord, aucun doublon.
//
// Deux gardes, chacune pour une raison précise :
//   1. Date invalide → on sort. Sans elle, `ymdLocal` produirait la clé 'NaN-NaN-NaN' : une
//      ligne fantôme que la série compterait comme un jour. Même forme que `dayKeyOf`
//      (src/utils/stats-grid.js:65).
//   2. Échec d'écriture avalé. Cette fonction est appelée APRÈS que le geste de progression a
//      été enregistré sur le projet : un journal indisponible (quota, base fermée) ne doit
//      JAMAIS faire échouer un geste déjà écrit. Même raisonnement que le `catch` autour de
//      `runReprise` dans src/backup/restore.js. La conséquence d'un échec se limite à un jour
//      manquant dans la série — une dégradation, jamais une perte de travail.
export async function recordActiveDay(instant) {
  if (instant == null || instant === '') return
  const d = instant instanceof Date ? instant : new Date(instant)
  if (Number.isNaN(d.getTime())) return
  try {
    await db.activeDays.put({ day: ymdLocal(d) })
  } catch {
    /* voir garde 2 ci-dessus */
  }
}

// Les jours du journal, en chaînes 'AAAA-MM-JJ'. Non trié : les appelants en font un `Set`
// (StatsView.vue) ou les trient eux-mêmes.
export async function allActiveDays() {
  return (await db.activeDays.toArray()).map((r) => r.day)
}
