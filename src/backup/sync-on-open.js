// Rowtine — synchro MD ciblée à l'ouverture d'un patron/projet (Lot N3). Symétrique
// à `run-patron-md-sync.js` (synchro COMPLÈTE au lancement/reprise) mais restreinte
// à un seul dossier (`{ only }`, cf. `patron-md-sync.js`) : quand l'utilisateur ouvre
// un patron précis, on veut qu'il voie IMMÉDIATEMENT les éditions faites côté PC,
// sans attendre le prochain lancement/reprise de l'app ni rescanner toute
// l'arborescence SAF.
//
// Attend `whenSyncIdle()` avant de lancer sa propre synchro ciblée : si une synchro
// COMPLÈTE est déjà en train de tourner (lancement/reprise concurrent), elle a peut-
// être déjà fusionné CE dossier — mieux vaut attendre son terme (le lecteur affichera
// alors un état forcément à jour) que d'être éconduit par le drapeau `running` et
// rendre un contenu potentiellement dépassé.
//
// Ne lève JAMAIS : un échec de cette synchro ne doit jamais empêcher l'ouverture du
// patron/projet par l'utilisateur.
import { Capacitor } from '@capacitor/core'
import { db } from '@/db/db'
import { usePatternsStore } from '@/stores/patterns'
import { useProjectsStore } from '@/stores/projects'
import { useSyncReportStore } from '@/stores/sync-report'
import { classifySyncReport } from './sync-report-decision'
import { getBackupStorage } from './backup-service'
import { syncPatronMd, whenSyncIdle } from './patron-md-sync'

// syncPatronMdOnOpen({ kind: 'pattern'|'project', id }) : synchronise UNIQUEMENT le
// dossier concerné avant que l'appelant (ouverture du Lecteur) n'affiche le patron.
export async function syncPatronMdOnOpen({ kind, id }) {
  if (!Capacitor.isNativePlatform()) return
  try {
    const storage = await getBackupStorage()
    // `storage` truthy garantit déjà hasFolder()==vrai, et getBackupPermissionOk()
    // n'est que hasFolder() : inutile de refaire l'appel IPC SAF (coûteux) ici.
    if (!storage) return

    // Laisse d'abord filer une éventuelle synchro complète en cours — elle a pu
    // déjà traiter ce dossier ; ATTENDRE (pas juste renoncer) est le point même de
    // cette fonction : le Lecteur doit refléter le contenu le plus frais possible.
    await whenSyncIdle()

    const deps = { db, patternsStore: usePatternsStore(), projectsStore: useProjectsStore() }
    const report = await syncPatronMd(storage, deps, { only: { kind, id } })

    // Rapport proportionné à l'ouverture (appliqué ici à la synchro
    // ciblée) : le contenu à jour EST le retour visible d'une synchro propre — pas
    // besoin d'une snackbar en plus. En revanche, si l'édition PC a fait perdre une
    // progression ou soulevé un avertissement, l'utilisateur doit voir la modale,
    // exactement comme pour la synchro complète.
    if (classifySyncReport(report).kind === 'modal') {
      useSyncReportStore().setReport(report)
    }
  } catch (err) {
    // Jamais de perte silencieuse dans les logs, mais surtout : jamais d'exception
    // qui remonte et casse l'ouverture du patron/projet par l'utilisateur.
    console.error('[patron-md-sync] échec de la synchro ciblée à l’ouverture', err)
  }
}
