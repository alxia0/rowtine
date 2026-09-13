// Rowtine — déclencheur de la synchro MD aux frontières de l'app.
// Isolé d'App.vue pour rester testable sans monter le composant (même esprit que
// `auto-trigger.js` pour la sauvegarde-pause) : rassemble les dépendances réelles
// (DB Dexie + stores Pinia), applique les mêmes gardes que la sauvegarde/restauration
// (natif, stockage désigné, permission), appelle `syncPatronMd`, puis remonte le
// rapport au store `syncReport` pour que l'UI puisse le présenter.
//
// Le drapeau anti-course PRINCIPAL est celui interne à `syncPatronMd` (module-level,
// renvoie `{ skipped:'running' }` en cas de chevauchement) — celui-ci n'est qu'une
// garde légère locale pour éviter de reconstruire les dépendances (instances de
// store) en cas d'appels rapprochés (ex. deux `resume` coup sur coup).
//
// Ne lève JAMAIS : un échec de synchro ne doit jamais casser le lancement de l'app
// ni la reprise au premier plan.
import { Capacitor } from '@capacitor/core'
import { db } from '@/db/db'
import { usePatternsStore } from '@/stores/patterns'
import { useProjectsStore } from '@/stores/projects'
import { useSyncReportStore } from '@/stores/sync-report'
import { getBackupStorage } from './backup-service'
import { syncPatronMd } from './patron-md-sync'

let inFlight = false

export async function runPatronMdSync() {
  if (!Capacitor.isNativePlatform()) return
  if (inFlight) return
  inFlight = true
  try {
    const storage = await getBackupStorage()
    // `storage` truthy garantit déjà hasFolder()==vrai, et getBackupPermissionOk()
    // n'est que hasFolder() : inutile de refaire l'appel IPC SAF (coûteux) ici.
    if (!storage) return

    const deps = { db, patternsStore: usePatternsStore(), projectsStore: useProjectsStore() }
    const report = await syncPatronMd(storage, deps)
    useSyncReportStore().setReport(report)
  } catch (err) {
    // Jamais de perte silencieuse dans les logs non plus, mais surtout : jamais
    // d'exception qui remonte et casse le lancement/la reprise de l'app.
    console.error('[patron-md-sync] échec de la synchro au lancement/reprise', err)
  } finally {
    inFlight = false
  }
}
