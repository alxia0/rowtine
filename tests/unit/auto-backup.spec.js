// Unitaire — sauvegarde automatique débouncée sur mutation.
// `runBackup` (backup-service) est mocké : on ne teste ici que l'armement du
// debounce et le drapeau de suppression (compteur, imbrication) — pas la
// collecte/écriture réelle (couverte par backup-service.spec.js/orchestrator).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runBackup = vi.hoisted(() => vi.fn())
const isAutoBackupRunning = vi.hoisted(() => vi.fn(() => false))
vi.mock('@/backup/backup-service', () => ({
  runBackup: (...a) => runBackup(...a),
  isAutoBackupRunning: (...a) => isAutoBackupRunning(...a),
}))

// `callRunBackup` (auto-backup.js) résout `isSyncRunning` par import dynamique
// de patron-md-sync.js (cf. commentaire de tête de fichier du module testé) :
// mocké ici pour piloter la garde d'exclusion mutuelle sans tirer tout le
// reste de patron-md-sync.js (reconciliation, merge...), hors sujet ici.
const isSyncRunning = vi.hoisted(() => vi.fn(() => false))
vi.mock('@/backup/patron-md-sync', () => ({
  isSyncRunning: (...a) => isSyncRunning(...a),
}))

// Publication de l'échec : `publishAutoBackupFailure` résout le
// chemin par import dynamique de saf-folder-label.js — mocké ici pour piloter
// le libellé sans tirer le vrai module (qui importerait `@/db/db` et le plugin
// natif SAF, hors sujet : on teste la PUBLICATION, pas la composition du
// chemin, couverte par saf-folder-section.spec.js côté Réglages).
const folderDisplayPath = vi.hoisted(() => vi.fn())
vi.mock('@/backup/saf-folder-label', () => ({
  folderDisplayPath: (...a) => folderDisplayPath(...a),
}))

// Le store, lui, est importé pour de VRAI (statiquement, donc déjà en cache
// quand le code testé fait son `import()` dynamique — même piège des fake
// timers que pour patron-md-sync ci-dessus, cf. auto-backup-loop-guard.spec.js)
// : c'est le vrai câblage store qu'on veut éprouver, pas un double.
import { createPinia, setActivePinia } from 'pinia'
import { useBackupFailureStore } from '@/stores/backup-failure'
// Drapeau « dossier propre depuis la restauration » (lot du 06/09/2026) : module
// réel (pur, sans dépendance, donc sans risque pour les mocks ci-dessus) — on pilote
// le drapeau à la main pour prouver la garde du TIR décrite plus bas.
const { clearFolderClean, markFolderClean } = await import('@/backup/restore-guard')

const {
  scheduleAutoBackup,
  flushAutoBackup,
  suppressAutoBackup,
  isAutoBackupSuppressed,
  AUTO_BACKUP_WAIT_MS,
  AUTO_BACKUP_MAX_WAIT_MS,
} = await import('@/backup/auto-backup')

beforeEach(() => {
  vi.useFakeTimers()
  setActivePinia(createPinia())
  runBackup.mockClear()
  runBackup.mockResolvedValue({ ok: true })
  isAutoBackupRunning.mockReturnValue(false)
  isSyncRunning.mockReturnValue(false)
  clearFolderClean() // état mémoire de la garde restauration : vierge par test
  folderDisplayPath.mockReset()
  folderDisplayPath.mockResolvedValue('Documents/Rowtine')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('constantes', () => {
  it('expose des intervalles généreux (SAF est lent)', () => {
    expect(AUTO_BACKUP_WAIT_MS).toBe(8000)
    expect(AUTO_BACKUP_MAX_WAIT_MS).toBe(30000)
  })
})

describe('scheduleAutoBackup', () => {
  it("arme le debounce et appelle runBackup après l'intervalle d'inactivité", async () => {
    scheduleAutoBackup()
    expect(runBackup).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(AUTO_BACKUP_WAIT_MS)
    expect(runBackup).toHaveBeenCalledTimes(1)
  })

  it('ne fait rien pendant une suppression active', async () => {
    await suppressAutoBackup(async () => {
      scheduleAutoBackup()
      await vi.advanceTimersByTimeAsync(AUTO_BACKUP_WAIT_MS + 1000)
      expect(runBackup).not.toHaveBeenCalled()
    })
  })
})

describe('flushAutoBackup', () => {
  it('déclenche immédiatement un backup en attente', async () => {
    scheduleAutoBackup()
    flushAutoBackup()
    // callRunBackup est async (import dynamique) : laisser les microtasks se résoudre.
    await vi.advanceTimersByTimeAsync(0)
    expect(runBackup).toHaveBeenCalledTimes(1)
  })

  it("ne fait rien s'il n'y a rien en attente", async () => {
    flushAutoBackup()
    await vi.advanceTimersByTimeAsync(0)
    expect(runBackup).not.toHaveBeenCalled()
  })
})

describe('suppressAutoBackup', () => {
  it('isAutoBackupSuppressed() reflète un compteur imbriqué (nesting sûr)', async () => {
    expect(isAutoBackupSuppressed()).toBe(false)
    let sawNestedSuppressed = false
    await suppressAutoBackup(async () => {
      expect(isAutoBackupSuppressed()).toBe(true)
      await suppressAutoBackup(async () => {
        sawNestedSuppressed = isAutoBackupSuppressed()
      })
      // Toujours supprimé après la sortie de la suppression imbriquée : le
      // compteur ne doit pas retomber à 0 tant que le niveau externe tourne.
      expect(isAutoBackupSuppressed()).toBe(true)
    })
    expect(sawNestedSuppressed).toBe(true)
    expect(isAutoBackupSuppressed()).toBe(false)
  })

  it('restaure le compteur même si asyncFn lève', async () => {
    await expect(
      suppressAutoBackup(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(isAutoBackupSuppressed()).toBe(false)
  })

  it('renvoie le résultat de asyncFn', async () => {
    const result = await suppressAutoBackup(async () => 'valeur')
    expect(result).toBe('valeur')
  })
})

// Correctif revue (exclusion mutuelle backup↔sync, même lot) : `suppressAutoBackup`
// ne bloque que l'ARMEMENT (`scheduleAutoBackup`). Ces tests ciblent le TIR
// (`callRunBackup`, résolu au déclenchement du debounce), qui doit lui aussi être
// gaté — sans quoi un timer déjà armé AVANT une suppression tire quand même
// PENDANT celle-ci (cf. tête de fichier de auto-backup.js).
describe('exclusion mutuelle backup↔sync (correctif revue)', () => {
  it('un debounce armé AVANT une suppression ne tire PAS pendant celle-ci, et se réarme (tire après la fin de la suppression)', async () => {
    scheduleAutoBackup() // armé alors qu'aucune suppression n'est active
    await suppressAutoBackup(async () => {
      // La fenêtre de suppression dépasse largement AUTO_BACKUP_WAIT_MS : sans le
      // correctif (gate au TIR), le timer déjà armé appellerait runBackup ici.
      await vi.advanceTimersByTimeAsync(AUTO_BACKUP_WAIT_MS + 1000)
      expect(runBackup).not.toHaveBeenCalled()
    })
    // Le tir gaté s'est réarmé au lieu d'être perdu : il finit par aboutir une
    // fois la suppression levée.
    await vi.advanceTimersByTimeAsync(AUTO_BACKUP_WAIT_MS)
    expect(runBackup).toHaveBeenCalledTimes(1)
  })

  it('une synchro en cours (isSyncRunning) bloque le tir : le debounce se réarme plutôt que d’appeler runBackup, puis tire une fois la synchro terminée', async () => {
    isSyncRunning.mockReturnValue(true)
    scheduleAutoBackup()
    await vi.advanceTimersByTimeAsync(AUTO_BACKUP_WAIT_MS + 1000)
    expect(runBackup).not.toHaveBeenCalled()

    isSyncRunning.mockReturnValue(false)
    await vi.advanceTimersByTimeAsync(AUTO_BACKUP_WAIT_MS)
    expect(runBackup).toHaveBeenCalledTimes(1)
  })
})

// Lot « restauration lourde » (06/09/2026) : après une restauration allée au bout,
// la base est l'image exacte du dossier et rien n'a pu y écrire depuis (toute
// mutation efface le drapeau via le hook Dexie de db.js). Le tir du debounce —
// y compris via `flushAutoBackup` à la mise en pause, qui passe par le même
// `callRunBackup` — ne doit donc PAS relire/réécrire tout le dossier (mesure
// du 06/09 : ~255 s de requêtes SAF pour un résultat identique).
describe('drapeau « dossier propre depuis la restauration »', () => {
  it('drapeau posé : le tir n’appelle PAS runBackup et ne publie rien (skip silencieux)', async () => {
    markFolderClean()
    scheduleAutoBackup()
    await vi.advanceTimersByTimeAsync(AUTO_BACKUP_WAIT_MS)
    expect(runBackup).not.toHaveBeenCalled()
    // Deux tours de microtasks : une publication (à tort) armée par le tir serait
    // déjà passée ici — l'absence est donc bien mesurée (même style que les tests
    // « skipped silencieux » du describe « annonce des échecs »).
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(useBackupFailureStore().failure).toBeNull()
  })

  it('la garde couvre aussi le chemin flush-pause : flushAutoBackup passe par callRunBackup', async () => {
    scheduleAutoBackup()
    markFolderClean()
    flushAutoBackup()
    // callRunBackup est async (imports dynamiques) : laisser les microtasks se résoudre.
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(runBackup).not.toHaveBeenCalled()
    expect(useBackupFailureStore().failure).toBeNull()
  })

  it('sans drapeau : le tir a bien lieu (contre-épreuve — la garde ne doit pas tout bloquer)', async () => {
    scheduleAutoBackup()
    await vi.advanceTimersByTimeAsync(AUTO_BACKUP_WAIT_MS)
    expect(runBackup).toHaveBeenCalledTimes(1)
  })
})

// Annonce des échecs (décision produit du 05/09/2026) : le tir du
// debounce lit ENFIN le compte rendu de `runBackup`. Un échec d'ÉCRITURE
// (`{ ok:false, error }`) est publié au store `backup-failure` (consommé par
// App.vue) et loggé ; les `skipped` restent silencieux (ce ne sont pas des
// erreurs d'écriture — cf. en-tête du module testé).
describe('annonce des échecs', () => {
  let consoleError

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('publie un échec d’écriture ({ ok:false, error }) au store, avec le chemin composé comme dans les Réglages', async () => {
    runBackup.mockResolvedValue({ ok: false, error: 'EIO: write failed' })
    scheduleAutoBackup()
    await vi.advanceTimersByTimeAsync(AUTO_BACKUP_WAIT_MS)
    // Publication asynchrone (imports dynamiques dans le .then) : on attend
    // qu'elle atterrisse — vi.waitFor avance les fake timers tout seul.
    await vi.waitFor(() => expect(useBackupFailureStore().failure).not.toBeNull())
    const failure = useBackupFailureStore().failure
    expect(failure).toMatchObject({ error: 'EIO: write failed', path: 'Documents/Rowtine' })
    // `at` : horodatage ISO de la publication (consommé par le rapport copiable).
    expect(typeof failure.at).toBe('string')
    expect(Number.isNaN(new Date(failure.at).getTime())).toBe(false)
    // Le console.error reste, indépendant de la publication (précédent :
    // run-patron-md-sync.js) — trace minimale même si le store échoue.
    expect(consoleError).toHaveBeenCalledWith(
      '[auto-backup] échec de l’enregistrement automatique des données',
      'EIO: write failed',
    )
  })

  it.each(['web', 'permission', 'restorable'])('skipped %r : silence TOTAL (ni store, ni console) — ce n’est pas une erreur d’écriture', async (skipped) => {
    runBackup.mockResolvedValue({ ok: false, skipped })
    scheduleAutoBackup()
    await vi.advanceTimersByTimeAsync(AUTO_BACKUP_WAIT_MS)
    // Deux tours de microtasks : si une publication avait (à tort) été armée,
    // elle serait déjà passée ici — l'absence est donc bien mesurée.
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(useBackupFailureStore().failure).toBeNull()
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('résultat sans res.error (res absent ou ok:true) : aucun traitement d’échec', async () => {
    runBackup.mockResolvedValue(undefined)
    scheduleAutoBackup()
    await vi.advanceTimersByTimeAsync(AUTO_BACKUP_WAIT_MS)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(useBackupFailureStore().failure).toBeNull()
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('chemin illisible (folderDisplayPath rejette) : publie QUAND MÊME avec path=null, sans rejet non géré', async () => {
    folderDisplayPath.mockRejectedValue(new Error('UNIMPLEMENTED'))
    runBackup.mockResolvedValue({ ok: false, error: 'boom' })
    scheduleAutoBackup()
    await vi.advanceTimersByTimeAsync(AUTO_BACKUP_WAIT_MS)
    await vi.waitFor(() => expect(useBackupFailureStore().failure).not.toBeNull())
    expect(useBackupFailureStore().failure).toMatchObject({ error: 'boom', path: null })
  })

  it('la publication est fire-and-forget : le debounce reste ré-armable et le store porte le DERNIER échec', async () => {
    runBackup.mockResolvedValueOnce({ ok: false, error: 'premier' })
    scheduleAutoBackup()
    await vi.advanceTimersByTimeAsync(AUTO_BACKUP_WAIT_MS)
    await vi.waitFor(() => expect(useBackupFailureStore().failure).not.toBeNull())
    expect(runBackup).toHaveBeenCalledTimes(1)

    runBackup.mockResolvedValueOnce({ ok: false, error: 'second' })
    scheduleAutoBackup()
    await vi.advanceTimersByTimeAsync(AUTO_BACKUP_WAIT_MS)
    await vi.waitFor(() => expect(useBackupFailureStore().failure?.error).toBe('second'))
    expect(runBackup).toHaveBeenCalledTimes(2)
  })
})
