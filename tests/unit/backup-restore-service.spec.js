// @vitest-environment jsdom
// Unitaire — service de restauration runtime : sélection du
// stockage natif (mêmes règles que backup-service.js), permission, lecture de
// l'arbo + écriture DB, rechargement des stores Pinia globaux. Toutes les
// dépendances externes sont mockées — on teste la logique JS, pas le natif
// (validé sur device par ailleurs). `shouldOfferRestore` est pure, testée à part.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getBackupStorage = vi.fn()
const getBackupPermissionOk = vi.fn()
vi.mock('@/backup/backup-service', () => ({
  getBackupStorage: (...a) => getBackupStorage(...a),
  getBackupPermissionOk: (...a) => getBackupPermissionOk(...a),
}))

const hasBackup = vi.fn()
const readBackup = vi.fn()
const writeSnapshotToDb = vi.fn()
vi.mock('@/backup/restore', () => ({
  hasBackup: (...a) => hasBackup(...a),
  readBackup: (...a) => readBackup(...a),
  writeSnapshotToDb: (...a) => writeSnapshotToDb(...a),
}))

// Anti-boucle : `runRestore` doit envelopper l'écriture DB dans
// `suppressAutoBackup` — on espionne l'armement réel (pas un mock qui se contente
// d'exécuter `asyncFn`), pour prouver que l'armement est bien désactivé PENDANT
// l'exécution, cf. tests/unit/auto-backup.spec.js pour le style de cette garde.
const { suppressAutoBackup, isAutoBackupSuppressedDuring } = vi.hoisted(() => {
  let suppressedDuring = false
  return {
    isAutoBackupSuppressedDuring: () => suppressedDuring,
    suppressAutoBackup: vi.fn(async (fn) => {
      suppressedDuring = true
      try {
        return await fn()
      } finally {
        suppressedDuring = false
      }
    }),
  }
})
vi.mock('@/backup/auto-backup', () => ({ suppressAutoBackup, scheduleAutoBackup: vi.fn() }))

const patternsLoad = vi.fn()
vi.mock('@/stores/patterns', () => ({
  usePatternsStore: () => ({ load: patternsLoad }),
}))
const projectsLoad = vi.fn()
vi.mock('@/stores/projects', () => ({
  useProjectsStore: () => ({ load: projectsLoad }),
}))
const yarnsLoad = vi.fn()
vi.mock('@/stores/yarns', () => ({
  useYarnsStore: () => ({ load: yarnsLoad }),
}))
// Budget laine cumulé : correctif remonté par une revue précédente —
// `reloadStores` doit aussi recharger `purchases`, sans quoi l'écran Dépenses
// afficherait un budget périmé juste après une restauration de sauvegarde.
const purchasesLoad = vi.fn()
vi.mock('@/stores/purchases', () => ({
  usePurchasesStore: () => ({ load: purchasesLoad }),
}))
// `locale` simule la valeur RECHARGÉE par `settingsStore.load()` depuis la base
// restaurée (lot 3 bloquants avant diffusion, 01/08) — statique ici (le mock
// ne rejoue pas la réactivité de `load()`), suffisant pour prouver que `reloadStores`
// la reporte bien sur `i18n.global.locale`.
const settingsLoad = vi.fn()
vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({ load: settingsLoad, locale: 'de' }),
}))
// Instance i18n mockée : on n'a besoin que de la forme `global.locale.value` que
// `reloadStores` écrit, cf. tests/unit/App.restore-offer.spec.js pour le même besoin
// ailleurs avec la VRAIE instance (pas nécessaire ici, ce fichier ne monte aucun
// composant).
const fakeI18n = { global: { locale: { value: 'fr' } } }
vi.mock('@/i18n', () => ({ default: fakeI18n }))
const trashLoad = vi.fn()
vi.mock('@/stores/trash', () => ({
  useTrashStore: () => ({ load: trashLoad }),
}))
const activeSessionLoad = vi.fn()
vi.mock('@/stores/activeSession', () => ({
  useActiveSessionStore: () => ({ load: activeSessionLoad }),
}))

// Décision (avenant 04/08/2026) : `runRestore` acquitte le
// dossier après une restauration réussie et remonte le résultat (`decided`) —
// mockée à son propre niveau, comme `hasBackupDecision`/`recordBackupDecision`
// le sont dans les autres fichiers de ce lot. Sans ce mock, le VRAI module
// tournerait ici et échouerait à joindre le plugin natif SAF (proxy Capacitor
// "not implemented" en environnement de test), ce qui produirait `decided: false`
// silencieusement plutôt que de tester ce que ce fichier veut réellement isoler.
const recordBackupDecision = vi.fn()
const clearBackupDecision = vi.fn()
vi.mock('@/backup/backup-decision', () => ({
  recordBackupDecision: (...a) => recordBackupDecision(...a),
  clearBackupDecision: (...a) => clearBackupDecision(...a),
}))

// Fiche d'identité du dossier (lot du 06/08/2026) : `runRestore` écrit la fiche
// à SON nom après un succès — restaurer, c'est prendre possession du dossier. Mockée à
// son propre niveau, comme `backup-decision` juste au-dessus et pour la même raison :
// le VRAI module irait interroger le plugin natif SAF (`deviceName`) et taperait la
// base pour l'identifiant, deux choses que ce fichier n'isole pas et qui ne feraient
// qu'ajouter du bruit à des assertions portant sur les APPELS.
const writeManifest = vi.fn()
vi.mock('@/backup/backup-manifest', () => ({ writeManifest: (...a) => writeManifest(...a) }))

const { runRestore, shouldOfferRestore, shouldRestoreFromFolder, isDbEmpty, isDbRestorable } = await import(
  '@/backup/restore-service'
)
const { db, getSetting, setSetting } = await import('@/db/db')
const { recordSeededSamples } = await import('@/utils/seeded-samples')
// Drapeau « dossier propre depuis la restauration » (lot du 06/09/2026) : module
// réel (pur, sans dépendance), jamais mocké ici — les assertions portent sur son
// état de session, posé par `runRestore` lui-même.
const { clearFolderClean, isFolderCleanSinceRestore, markFolderClean } = await import('@/backup/restore-guard')

// `isDbEmpty` (appelée en interne par `runRestore`, cf. describe dédié plus bas) tape
// la vraie base (fake-indexeddb) — jamais mockée dans ce fichier. On la remet à vide
// avant CHAQUE test (pas seulement ceux du describe `isDbEmpty`) pour que les tests
// `runRestore` existants (chemin nominal, anti-boucle, erreurs) continuent de
// franchir la garde finale sans avoir à connaître son existence.
beforeEach(async () => {
  vi.clearAllMocks()
  fakeI18n.global.locale.value = 'fr' // état témoin, indépendant de l'ordre des tests
  recordBackupDecision.mockResolvedValue(true) // cas nominal : le dossier s'acquitte
  // Drapeau « dossier propre » : état de module mémoire — remis à zéro avant CHAQUE
  // test, sinon un `markFolderClean()` fuirait du test précédent dans le suivant.
  clearFolderClean()
  // `mockReset()` et pas seulement `mockClear()` (ce que fait `clearAllMocks` ci-dessus) :
  // deux tests ci-dessous posent une `mockImplementation` — sans remise à zéro, elle
  // fuirait dans les tests suivants, qui se mettraient à mesurer autre chose que ce
  // qu'ils annoncent.
  writeManifest.mockReset().mockResolvedValue(true) // cas nominal : la fiche s'écrit
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('runRestore', () => {
  it("skipped:'web' quand pas de stockage natif", async () => {
    getBackupStorage.mockReturnValue(null)
    const res = await runRestore()
    expect(res).toEqual({ ok: false, skipped: 'web' })
    expect(getBackupPermissionOk).not.toHaveBeenCalled()
  })

  it("skipped:'permission' quand la permission n'est pas accordée (sans la demander)", async () => {
    getBackupStorage.mockReturnValue({})
    getBackupPermissionOk.mockResolvedValue(false)
    const res = await runRestore()
    expect(res).toEqual({ ok: false, skipped: 'permission' })
    expect(hasBackup).not.toHaveBeenCalled()
  })

  it("skipped:'empty' quand aucune sauvegarde n'est présente sur le stockage", async () => {
    getBackupStorage.mockReturnValue({})
    getBackupPermissionOk.mockResolvedValue(true)
    hasBackup.mockResolvedValue(false)
    const res = await runRestore()
    expect(res).toEqual({ ok: false, skipped: 'empty' })
    expect(readBackup).not.toHaveBeenCalled()
    expect(writeSnapshotToDb).not.toHaveBeenCalled()
  })

  it('chemin nominal : lit l’arbo, écrit la base, recharge tous les stores globaux', async () => {
    const storage = {}
    getBackupStorage.mockReturnValue(storage)
    getBackupPermissionOk.mockResolvedValue(true)
    hasBackup.mockResolvedValue(true)
    const snapshot = { projects: [{ id: 1 }] }
    readBackup.mockResolvedValue(snapshot)
    // Enregistre si la suppression était active AU MOMENT de l'écriture/rechargement
    // (et pas seulement que suppressAutoBackup a été appelé) — cf. test dédié
    // ci-dessous pour la vérification explicite de la fenêtre de suppression.
    let suppressedAtWrite = null
    writeSnapshotToDb.mockImplementation(async () => {
      suppressedAtWrite = isAutoBackupSuppressedDuring()
    })

    const res = await runRestore()

    expect(res).toEqual({ ok: true, decided: true })
    expect(readBackup).toHaveBeenCalledWith(storage, expect.any(Object))
    expect(writeSnapshotToDb).toHaveBeenCalledWith(snapshot)
    expect(patternsLoad).toHaveBeenCalledTimes(1)
    expect(projectsLoad).toHaveBeenCalledTimes(1)
    expect(yarnsLoad).toHaveBeenCalledTimes(1)
    expect(purchasesLoad).toHaveBeenCalledTimes(1)
    expect(settingsLoad).toHaveBeenCalledTimes(1)
    expect(trashLoad).toHaveBeenCalledTimes(1)
    expect(activeSessionLoad).toHaveBeenCalledTimes(1)
    expect(suppressedAtWrite).toBe(true)
    expect(isAutoBackupSuppressedDuring()).toBe(false) // remis en état après coup
    // (lot 3 bloquants avant diffusion) : la locale i18n doit suivre celle
    // rechargée par `settingsStore.load()` — sans ce report, l'interface resterait
    // affichée dans l'ancienne langue jusqu'au redémarrage suivant.
    expect(fakeI18n.global.locale.value).toBe('de')
  })

  // Étape 4b : `recordBackupDecision()` échouant (permission perdue entre le clic
  // et l'écriture, base illisible) ne doit PAS faire renvoyer `{ ok: false, error }`
  // sur une restauration qui a pourtant intégralement réussi — la base a été
  // écrite, seul l'acquittement du dossier n'a pas pu l'être.
  it("recordBackupDecision() renvoie false : la restauration reste un succès, decided:false", async () => {
    getBackupStorage.mockReturnValue({})
    getBackupPermissionOk.mockResolvedValue(true)
    hasBackup.mockResolvedValue(true)
    readBackup.mockResolvedValue({ projects: [] })
    writeSnapshotToDb.mockResolvedValue()
    recordBackupDecision.mockResolvedValue(false)

    const res = await runRestore()

    expect(res).toEqual({ ok: true, decided: false })
  })

  // Preuve par mutation de l'emplacement (étape 4b, « hors du try principal ») :
  // si `recordBackupDecision()` était encore À L'INTÉRIEUR du try principal (ou si
  // son propre try/catch de défense en profondeur manquait), une levée ici
  // ferait tomber `runRestore` dans le catch général et renverrait
  // `{ ok: false, error }` — sur une base pourtant intégralement restaurée. Ce
  // test échouerait alors (il attend `{ ok: true, decided: false }`).
  it("recordBackupDecision() lève : n'affecte PAS `ok` (base restaurée avec succès), decided:false", async () => {
    getBackupStorage.mockReturnValue({})
    getBackupPermissionOk.mockResolvedValue(true)
    hasBackup.mockResolvedValue(true)
    readBackup.mockResolvedValue({ projects: [] })
    writeSnapshotToDb.mockResolvedValue()
    recordBackupDecision.mockRejectedValue(new Error('permission SAF perdue'))

    const res = await runRestore()

    expect(res).toEqual({ ok: true, decided: false })
  })

  // ─── Appropriation du dossier (lot du 06/08/2026) ────────────────────────
  //
  // CE QUE CES TESTS FERMENT. Le travail précédent a posé la fiche d'identité et la mise
  // en pause « un autre appareil a écrit ici ». Il manquait la contrepartie : après une
  // restauration réussie depuis l'ancien téléphone, la fiche du dossier porte encore
  // l'identifiant de CELUI-CI. La toute première sauvegarde du NOUVEAU téléphone se
  // suspendrait donc — et toutes les suivantes aussi, définitivement, en silence, la
  // seule porte agissante affichée étant le bouton destructeur. C'est le jumeau exact du
  // défaut trouvé le 04/08 en exécutant du code (« pause définitive »), à ceci près
  // qu'il se déclenche sur le chemin même que le guide promet : « tu réinstalles, tu
  // redésignes ce dossier, tout revient comme avant ».
  it("une restauration réussie s'approprie le dossier (sinon : pause définitive)", async () => {
    const storage = {}
    getBackupStorage.mockReturnValue(storage)
    getBackupPermissionOk.mockResolvedValue(true)
    hasBackup.mockResolvedValue(true)
    readBackup.mockResolvedValue({ projects: [] })
    writeSnapshotToDb.mockResolvedValue()

    const res = await runRestore()

    expect(res).toEqual({ ok: true, decided: true })
    expect(writeManifest).toHaveBeenCalledTimes(1)
    // Le stockage passé est bien CELUI de la restauration, pas un autre résolu au vol :
    // écrire la fiche dans un autre dossier que celui qu'on vient de lire ne
    // s'approprierait rien.
    expect(writeManifest).toHaveBeenCalledWith(storage)
  })

  // Protège le dossier d'une restauration incomplète : sans appropriation ni décision, la sauvegarde reste en pause.
  it("restauration avec écarts : ni fiche, ni décision, ni dossier propre, ni message de retour, owned:false", async () => {
    getBackupStorage.mockReturnValue({})
    getBackupPermissionOk.mockResolvedValue(true)
    hasBackup.mockResolvedValue(true)
    const ecarts = [{ where: 'Projets/Marisol [3]', error: 'Unexpected end of JSON input' }]
    readBackup.mockResolvedValue({ projects: [], errors: ecarts })
    writeSnapshotToDb.mockResolvedValue()

    const res = await runRestore({ notifyRestored: true })

    expect(res).toEqual({ ok: true, decided: false, owned: false, errors: ecarts })
    expect(writeManifest).not.toHaveBeenCalled()
    expect(recordBackupDecision).not.toHaveBeenCalled()
    expect(clearBackupDecision).toHaveBeenCalledTimes(1)
    expect(isFolderCleanSinceRestore()).toBe(false)
    await expect(getSetting('restoredDue')).resolves.toBe(false)
  })

  // Contrainte de PLACEMENT, pas cosmétique — même exigence que `readBackup` et
  // `writeSnapshotToDb` juste au-dessus. Hors de la fenêtre de suppression, une
  // sauvegarde débouncée déjà armée pourrait tirer et réconcilier le dossier PENDANT
  // l'opération : le mécanisme exact du sinistre du 04/08. Deux raisons concrètes ici :
  // l'écriture de la fiche touche le dossier SAF, et `deviceId()` peut elle-même écrire
  // en base (elle crée l'identifiant au premier appel) — donc réarmer le hook Dexie.
  //
  // FORME : le drapeau est CAPTURÉ puis asserté au-dehors (convention de ce fichier,
  // cf. `suppressedAtWrite`/`suppressedAtRead`), jamais asserté DANS le mock — une
  // exception d'assertion levée là serait avalée par la seconde ceinture try/catch
  // qui entoure l'appel dans `runRestore`, et ce test deviendrait incapable d'échouer.
  it("l'appropriation a lieu SOUS suppressAutoBackup", async () => {
    getBackupStorage.mockReturnValue({})
    getBackupPermissionOk.mockResolvedValue(true)
    hasBackup.mockResolvedValue(true)
    readBackup.mockResolvedValue({ projects: [] })
    writeSnapshotToDb.mockResolvedValue()
    let suppressedAtManifest = null
    writeManifest.mockImplementation(async () => {
      suppressedAtManifest = isAutoBackupSuppressedDuring()
      return true
    })

    await runRestore()

    expect(writeManifest).toHaveBeenCalledTimes(1)
    expect(suppressedAtManifest).toBe(true)
  })

  // Contrainte d'ORDRE, distincte de la contrainte de fenêtre ci-dessus, et sans quoi le
  // commentaire de `runRestore` qui la revendique ne serait qu'une intention : les
  // décomptes de la fiche (`contenu` — projets/patrons/laines, cf. buildManifest) sont
  // LUS DANS LA BASE. Écrite avant `writeSnapshotToDb`, la fiche annoncerait les
  // décomptes de la base d'AVANT la restauration — et l'écran dont le seul rôle est de
  // rassurer annoncerait ceux-là. PAS « zéro » (correctif de revue : la magnitude était
  // fausse) : `isDbRestorable` admet aussi une base ne contenant que les exemples semés,
  // soit 2 projets et 3 patrons dans le cas réaliste du téléphone neuf qui vient de
  // passer l'écran d'accueil. Un chiffre faux y est pire qu'un chiffre absent.
  // Remonter l'appel d'une seule ligne laisse tous les autres tests de ce bloc verts :
  // c'est celui-ci, et lui seul, qui rougirait.
  it('la fiche est écrite APRÈS la base (sinon ses décomptes sont ceux d’avant la restauration)', async () => {
    getBackupStorage.mockReturnValue({})
    getBackupPermissionOk.mockResolvedValue(true)
    hasBackup.mockResolvedValue(true)
    readBackup.mockResolvedValue({ projects: [] })
    const ordre = []
    writeSnapshotToDb.mockImplementation(async () => {
      ordre.push('base')
    })
    writeManifest.mockImplementation(async () => {
      ordre.push('fiche')
      return true
    })

    await runRestore()

    expect(ordre).toEqual(['base', 'fiche'])
  })

  // Symétrique indispensable : s'approprier un dossier qu'on n'a PAS restauré ferait
  // exactement le contraire du but du lot — cet appareil se déclarerait propriétaire
  // d'une sauvegarde qu'il n'a jamais lue, et la garde « un autre appareil a écrit
  // ici » cesserait de protéger le travail de l'autre téléphone.
  it("une restauration EN ÉCHEC ne s'approprie rien", async () => {
    getBackupStorage.mockReturnValue({})
    getBackupPermissionOk.mockResolvedValue(true)
    hasBackup.mockResolvedValue(false) // → { ok:false, skipped:'empty' }

    const res = await runRestore()

    expect(res).toEqual({ ok: false, skipped: 'empty' })
    expect(writeManifest).not.toHaveBeenCalled()
  })

  it("la garde finale qui refuse (skipped:'not-empty') ne s'approprie rien non plus", async () => {
    getBackupStorage.mockReturnValue({})
    getBackupPermissionOk.mockResolvedValue(true)
    hasBackup.mockResolvedValue(true)
    await db.yarns.add({ brand: 'Une laine' }) // base non restaurable

    const res = await runRestore()

    expect(res).toEqual({ ok: false, skipped: 'not-empty' })
    expect(writeManifest).not.toHaveBeenCalled()
  })

  // LE MODE D'ÉCHEC RÉELLEMENT ATTEIGNABLE (correctif de revue). `writeManifest` capture
  // en interne : son contrat est de RENVOYER `false`, jamais de lever. La première
  // version de `runRestore` jetait ce booléen — elle protégeait donc par try/catch un
  // chemin que le contrat déclare impossible, sans jamais REGARDER le seul échec qui
  // puisse survenir. Ce test couvre les trois moitiés de ce qu'on attend alors :
  //   1. la restauration reste un SUCCÈS (une fiche non écrite ne transforme jamais en
  //      échec une restauration qui, elle, a intégralement réussi) ;
  //   2. un second essai a bien lieu — et c'est lui qui compte, parce que ce chemin ne
  //      se rattrape PAS tout seul : sans fiche à son nom, la sauvegarde suivante est
  //      justement suspendue, il n'y a pas de « prochain cycle » pour réécrire la fiche ;
  //   3. Depuis la décision produit du 05/09/2026 : les DEUX essais en échec
  //      remontent `owned: false` — plus aucun silence, l'appelant ouvre la modale
  //      « reprise du dossier non confirmée » (RestoreErrorDialog).
  // Il rougit si l'on retire le second essai (preuve par mutation faite : `1 call` au
  // lieu de `2`). Sa contrepartie discriminante est le test d'appropriation nominal
  // ci-dessus, qui exige EXACTEMENT UN appel : ensemble, ils prouvent que le second
  // essai est bien conditionnel à l'échec du premier, et pas systématique.
  it("writeManifest renvoie false deux fois : succès restauré, second essai, ET owned:false", async () => {
    getBackupStorage.mockReturnValue({})
    getBackupPermissionOk.mockResolvedValue(true)
    hasBackup.mockResolvedValue(true)
    readBackup.mockResolvedValue({ projects: [] })
    writeSnapshotToDb.mockResolvedValue()
    writeManifest.mockResolvedValue(false) // écriture SAF transitoirement en échec

    const res = await runRestore()

    expect(res).toEqual({ ok: true, decided: true, owned: false })
    expect(writeManifest).toHaveBeenCalledTimes(2)
  })

  it('le second essai réussit : la restauration reste un succès, et on ne réessaie pas au-delà', async () => {
    getBackupStorage.mockReturnValue({})
    getBackupPermissionOk.mockResolvedValue(true)
    hasBackup.mockResolvedValue(true)
    readBackup.mockResolvedValue({ projects: [] })
    writeSnapshotToDb.mockResolvedValue()
    writeManifest.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    const res = await runRestore()

    // PAS de `owned` : la fiche s'est finalement écrite, il n'y a rien à dire —
    // même convention que `decided`/`errors`, le résultat nominal garde sa forme.
    expect(res).toEqual({ ok: true, decided: true })
    expect(writeManifest).toHaveBeenCalledTimes(2)
  })

  // Seconde ceinture (try/catch autour de l'appel, calquée sur celle de
  // `backup-service.js` et sur celle de `recordBackupDecision` ci-dessus). Elle ne couvre
  // PAS un mode d'échec d'aujourd'hui — `writeManifest` est contractuellement incapable
  // de lever, cf. le test juste au-dessus pour le vrai — mais la VIOLATION FUTURE de ce
  // contrat : l'appel est à l'intérieur du try principal, où une levée ferait renvoyer
  // `{ ok:false, error }` sur une base pourtant INTÉGRALEMENT restaurée, et l'écran
  // proposerait de recommencer une restauration déjà faite.
  it('writeManifest qui lève ne transforme PAS une restauration réussie en échec', async () => {
    getBackupStorage.mockReturnValue({})
    getBackupPermissionOk.mockResolvedValue(true)
    hasBackup.mockResolvedValue(true)
    readBackup.mockResolvedValue({ projects: [] })
    writeSnapshotToDb.mockResolvedValue()
    writeManifest.mockRejectedValue(new Error('permission SAF perdue'))

    const res = await runRestore()

    expect(res).toEqual({ ok: true, decided: true })
  })

  it('transmet le VRAI rappel `onProgress` reçu à `readBackup`, et émet la phase `write` avec ce même rappel', async () => {
    // Sentinelle (même raisonnement que backup-service.spec.js) : un
    // `expect.any(Object)` laisserait passer un `readBackup(storage, {})` où
    // la transmission aurait été oubliée — ici, seule LA fonction passée par
    // l'appelant satisfait l'assertion. On vérifie aussi que cette même
    // fonction est bien celle invoquée pour l'événement `phase: 'write'`
    // (2026-08-04, §4.2), pas une fabrication interne.
    const storage = {}
    getBackupStorage.mockReturnValue(storage)
    getBackupPermissionOk.mockResolvedValue(true)
    hasBackup.mockResolvedValue(true)
    const snapshot = { projects: [] }
    readBackup.mockResolvedValue(snapshot)
    writeSnapshotToDb.mockResolvedValue()

    const onProgress = vi.fn()
    await runRestore({ onProgress })

    expect(readBackup).toHaveBeenCalledWith(storage, { onProgress })
    expect(onProgress).toHaveBeenCalledWith({ phase: 'write', done: 0, total: 0 })
  })

  it("anti-boucle : writeSnapshotToDb+reloadStores tournent sous suppressAutoBackup", async () => {
    getBackupStorage.mockReturnValue({})
    getBackupPermissionOk.mockResolvedValue(true)
    hasBackup.mockResolvedValue(true)
    readBackup.mockResolvedValue({ projects: [] })
    writeSnapshotToDb.mockResolvedValue()

    await runRestore()

    expect(suppressAutoBackup).toHaveBeenCalledTimes(1)
  })

  // Correctif (revue, 04/08/2026, constat Important) : `readBackup`
  // doit tourner LUI AUSSI sous `suppressAutoBackup` — pas seulement
  // `writeSnapshotToDb`/`reloadStores`. Sur 34 Mo, `readBackup` est de loin la phase
  // la plus longue de `runRestore` ; le laisser hors de la fenêtre est le mécanisme
  // même du sinistre du 04/08 : une minuterie de sauvegarde
  // débouncée déjà armée avant l'appui sur « Restaurer » peut tirer PENDANT la
  // lecture du dossier (gel des minuteries par `window.confirm`, tir au premier
  // `await` suivant l'acceptation) et `backupAll` supprime alors les dossiers de
  // projets pendant qu'on est en train de les lire.
  //
  // Preuve par mutation : ce test échoue (rouge) si `readBackup` repasse À
  // L'EXTÉRIEUR de `suppressAutoBackup` (l'ancien code, où seuls
  // `writeSnapshotToDb`+`reloadStores` étaient enveloppés) — `suppressedAtRead`
  // vaudrait alors `false`, puisque `readBackup` se serait exécuté AVANT que
  // `suppressAutoBackup` ne démarre sa fenêtre.
  it("correctif Important (04/08/2026) : readBackup tourne aussi sous suppressAutoBackup, pas seulement writeSnapshotToDb/reloadStores", async () => {
    getBackupStorage.mockReturnValue({})
    getBackupPermissionOk.mockResolvedValue(true)
    hasBackup.mockResolvedValue(true)
    let suppressedAtRead = null
    readBackup.mockImplementation(async () => {
      suppressedAtRead = isAutoBackupSuppressedDuring()
      return { projects: [] }
    })
    writeSnapshotToDb.mockResolvedValue()

    const res = await runRestore()

    expect(res).toEqual({ ok: true, decided: true })
    expect(suppressedAtRead).toBe(true)
  })

  it('erreurs attrapées → { ok:false, error }', async () => {
    getBackupStorage.mockReturnValue({})
    getBackupPermissionOk.mockResolvedValue(true)
    hasBackup.mockResolvedValue(true)
    readBackup.mockRejectedValue(new Error('boum'))

    const res = await runRestore()
    expect(res).toEqual({ ok: false, error: 'boum' })
    expect(writeSnapshotToDb).not.toHaveBeenCalled()
  })

  // ─── `welcomeDue` ne survit pas à une restauration (revue, 10/08/2026) ─────
  //
  // `welcomeDue` est posé LOCALEMENT (désignation du dossier, cf. OnboardingFolderPrompt
  // ::onChooseNow) AVANT que `runRestore` ne soit appelée. `writeSnapshotToDb` (restore.js,
  // mockée dans le reste de ce fichier) FUSIONNE les réglages restaurés avec ceux déjà en
  // base au lieu de les remplacer — le cas qui compte est donc une sauvegarde qui NE PORTE
  // PAS la clé `welcomeDue` (toute sauvegarde écrite avant ce lot) : sans le correctif, le
  // `true` posé localement SURVIT à la fusion, et l'accueil affiche la bienvenue par-dessus
  // un travail bien réel, retrouvé. Le VRAI `writeSnapshotToDb` (pas le mock du reste de ce
  // fichier) est utilisé ici, via `vi.importActual` : c'est la seule façon d'exercer la
  // fusion elle-même plutôt que de la reproduire à la main dans le test.
  it("après une restauration, welcomeDue ne survit pas — même si la sauvegarde n'en porte pas la clé", async () => {
    const { writeSnapshotToDb: writeSnapshotToDbReel } = await vi.importActual('@/backup/restore')

    const storage = {}
    getBackupStorage.mockReturnValue(storage)
    getBackupPermissionOk.mockResolvedValue(true)
    hasBackup.mockResolvedValue(true)
    // Sauvegarde ANCIENNE (d'avant ce lot) : ses réglages ne portent aucune clé
    // `welcomeDue` — une sauvegarde de ce lot-ci ou postérieure ne la porterait pas non
    // plus (voir le commentaire de `settings.js`), le cas est donc général, pas un cas
    // limite.
    readBackup.mockResolvedValue({ projects: [], settings: [] })
    writeSnapshotToDb.mockImplementation(writeSnapshotToDbReel)

    // `welcomeDue` posé LOCALEMENT par la désignation du dossier, juste avant l'appel à
    // `runRestore` — flux réel : accueil → désignation du dossier → welcomeDue=true →
    // runRestore().
    await setSetting('welcomeDue', true)

    const res = await runRestore()

    expect(res).toEqual({ ok: true, decided: true })
    // Le cas qui compte : sans le correctif, la fusion de `writeSnapshotToDb` PRÉSERVE les
    // clés absentes du snapshot restauré, et le `true` posé localement survivrait.
    await expect(getSetting('welcomeDue')).resolves.toBe(false)
  })

  // ─── `tourProjectId`/`tourPatternId` ne survivent pas à une restauration (revue finale,
  // lot du 23/09/2026, constat important n°1) ────────────────────────────────────────
  //
  // Ces deux clés sont exclues de la sauvegarde (EXCLUDED_SETTINGS_KEYS, serialize.js) :
  // `writeSnapshotToDb` (restore.js, la VRAIE ici via `vi.importActual`, même technique que
  // le test `welcomeDue` juste au-dessus) les garde donc TELLES QUELLES pendant la fusion,
  // quel que soit le contenu du snapshot restauré — le cas qui compte est un id local qui
  // DEVIENT FAUX une fois `projects`/`patterns` (tables REMPLACÉES, pas fusionnées) par le
  // snapshot : un vrai projet ou patron importé peut désormais porter le même id, et la
  // visite guidée s'ouvrirait dessus. `runRestore` doit donc les effacer explicitement,
  // comme `welcomeDue` — sans quoi `ensureTourProject` (tour-sample.js) les prendrait pour
  // de bons candidats sans jamais les revérifier après une restauration.
  it("après une restauration, tourProjectId et tourPatternId ne survivent pas — même si la sauvegarde n'en porte pas la clé", async () => {
    const { writeSnapshotToDb: writeSnapshotToDbReel } = await vi.importActual('@/backup/restore')

    getBackupStorage.mockReturnValue({})
    getBackupPermissionOk.mockResolvedValue(true)
    hasBackup.mockResolvedValue(true)
    readBackup.mockResolvedValue({ projects: [], settings: [] })
    writeSnapshotToDb.mockImplementation(writeSnapshotToDbReel)

    // Posés LOCALEMENT par une visite guidée jouée sur cet appareil avant la restauration.
    await setSetting('tourProjectId', 2)
    await setSetting('tourPatternId', 5)

    const res = await runRestore()

    expect(res).toEqual({ ok: true, decided: true })
    await expect(getSetting('tourProjectId')).resolves.toBeNull()
    await expect(getSetting('tourPatternId')).resolves.toBeNull()
  })

  // Protège : les ids du semis LOCAL ne désignent plus des exemples une fois les tables remplacées.
  it("seededSampleIds local ne survit pas à une sauvegarde qui n'en porte pas, mais celui du snapshot est gardé", async () => {
    const { writeSnapshotToDb: writeSnapshotToDbReel } = await vi.importActual('@/backup/restore')
    getBackupStorage.mockReturnValue({})
    getBackupPermissionOk.mockResolvedValue(true)
    hasBackup.mockResolvedValue(true)
    writeSnapshotToDb.mockImplementation(writeSnapshotToDbReel)

    await recordSeededSamples({ patterns: [1, 3], projects: [1, 2] })
    readBackup.mockResolvedValue({ projects: [], settings: [] })
    expect(await runRestore()).toEqual({ ok: true, decided: true })
    await expect(getSetting('seededSampleIds')).resolves.toBeNull()

    await Promise.all(db.tables.map((t) => t.clear()))
    await recordSeededSamples({ patterns: [1, 3], projects: [1, 2] })
    const restored = { patterns: [7], projects: [8] }
    readBackup.mockResolvedValue({ projects: [], settings: [{ key: 'seededSampleIds', value: restored }] })
    expect(await runRestore()).toEqual({ ok: true, decided: true })
    await expect(getSetting('seededSampleIds')).resolves.toEqual(restored)
  })

  // ─── `importCaveatDue` SURVIT à une restauration — invariant INVERSE de celui de
  // `welcomeDue` juste au-dessus (revue, lot du 19/08/2026) ─────────────
  //
  // `welcomeDue` ment factuellement sur des données restaurées (« deux projets
  // d'exemple t'attendent » sur un travail bien réel, retrouvé) : c'est pour ça, et
  // SEULEMENT pour ça, que `runRestore` l'efface explicitement. `importCaveatDue`
  // annonce « un patron importé se relit » — une affirmation qui reste vraie pour
  // n'importe qui importera un patron un jour, restauration ou pas. Ajouter la
  // symétrie (l'effacer aussi ici) casserait le cas d'une sauvegarde toute fraîche,
  // qui ne porte PAS encore d'acquittement : l'avertissement jamais montré serait
  // effacé avant d'avoir été vu. Ce test est le garde-fou de cet invariant : sans
  // lui, quelqu'un pourrait ajouter la symétrie par analogie apparente avec
  // `welcomeDue`, et aucun test ne rougirait.
  it("après une restauration, importCaveatDue survit — la sauvegarde n'en porte pas la clé", async () => {
    const { writeSnapshotToDb: writeSnapshotToDbReel } = await vi.importActual('@/backup/restore')

    const storage = {}
    getBackupStorage.mockReturnValue(storage)
    getBackupPermissionOk.mockResolvedValue(true)
    hasBackup.mockResolvedValue(true)
    // Sauvegarde ANCIENNE (d'avant ce lot, cas d'une utilisatrice) : ses réglages ne portent
    // aucune clé `importCaveatDue`. PRÉCONDITION vérifiée explicitement ci-dessous,
    // pas seulement supposée par la forme du mock.
    const backupSnapshot = { projects: [], settings: [] }
    expect(backupSnapshot.settings.some((s) => s.key === 'importCaveatDue')).toBe(false)
    readBackup.mockResolvedValue(backupSnapshot)
    writeSnapshotToDb.mockImplementation(writeSnapshotToDbReel)

    // `importCaveatDue` posé LOCALEMENT par la désignation du dossier, juste avant
    // l'appel à `runRestore` — même flux réel que `welcomeDue` ci-dessus.
    await setSetting('importCaveatDue', true)
    // PRÉCONDITION : le drapeau vaut bien `true` AVANT la restauration — sans cette
    // assertion, « il vaut `true` après » serait vrai pour la mauvaise raison (il
    // pourrait n'avoir jamais été posé du tout).
    await expect(getSetting('importCaveatDue')).resolves.toBe(true)

    const res = await runRestore()

    expect(res).toEqual({ ok: true, decided: true })
    await expect(getSetting('importCaveatDue')).resolves.toBe(true)
  })

  // ─── `restoredDue` — le message « tes données sont de retour » (lot du 06/09/2026) ─
  //
  // CE QUE CE BLOC FERME. Depuis le lot « ordre des pop-ups » (10/08), la porte du
  // dossier efface `welcomeDue` quand la restauration réussit (bloc au-dessus) — et du
  // même coup, l'utilisatrice qui vient de retrouver son travail n'a PLUS AUCUN
  // message : la bienvenue parle d'exemples qui n'existent plus, elle a donc été
  // effacée à juste titre, mais rien ne la remplaçait. `runRestore` accepte désormais
  // `notifyRestored` (posé par restore-on-designate.js, cf. son fichier) et arme en
  // base le drapeau que HomeView lira pour dire « tes données sont de retour ».
  // MÊME CONTRAT que `welcomeDue` : écrit AVANT `reloadStores()`, dont
  // `settingsStore.load()` (mocké ici) est le lecteur — d'où la capture au moment
  // du rechargement, qui prouve le placement et pas seulement l'écriture.
  it('notifyRestored:true : la base porte restoredDue=true (posé AVANT reloadStores) et welcomeDue=false', async () => {
    const { writeSnapshotToDb: writeSnapshotToDbReel } = await vi.importActual('@/backup/restore')

    getBackupStorage.mockReturnValue({})
    getBackupPermissionOk.mockResolvedValue(true)
    hasBackup.mockResolvedValue(true)
    // Sauvegarde sans aucune clé de réglage (cf. le test `welcomeDue` ci-dessus) :
    // le `true` attendu après coup ne peut venir que du correctif lui-même, pas du
    // snapshot restauré.
    readBackup.mockResolvedValue({ projects: [], settings: [] })
    writeSnapshotToDb.mockImplementation(writeSnapshotToDbReel)
    // Capture du drapeau AU MOMENT où `reloadStores()` recharge les réglages : si la
    // clé était écrite APRÈS ce rechargement, `settingsStore.load()` la lirait à
    // `false` et la pop-up ne sortirait qu'au prochain démarrage — le bug serait
    // réel sans que la valeur finale en base le montre.
    let restoredDueAuRechargement = 'jamais lu'
    settingsLoad.mockImplementation(async () => {
      restoredDueAuRechargement = await getSetting('restoredDue')
    })

    // `welcomeDue` posé LOCALEMENT par la porte juste avant l'appel (flux réel :
    // OnboardingFolderPrompt.vue::onChooseNow → runRestore).
    await setSetting('welcomeDue', true)

    const res = await runRestore({ notifyRestored: true })

    expect(res).toEqual({ ok: true, decided: true })
    // Les DEUX états attendus en base, relus depuis la base (pas d'état en mémoire) :
    // le nouveau message armé, l'ancien effacé — sinon la pop-up porterait les textes
    // du semis (cf. HomeView, la disjonction `restoredDue` d'abord).
    await expect(getSetting('restoredDue')).resolves.toBe(true)
    await expect(getSetting('welcomeDue')).resolves.toBe(false)
    expect(restoredDueAuRechargement).toBe(true)
    // Remise à zéro de l'implémentation posée ci-dessus : le `beforeEach` global ne
    // fait qu'un `clearAllMocks`, qui préserverait la `mockImplementation` et la
    // ferait fuir dans les tests suivants du fichier.
    settingsLoad.mockReset()
  })

  it("sans notifyRestored, restoredDue est ÉCRIT à false (le bandeau des Réglages garde son snackbar)", async () => {
    getBackupStorage.mockReturnValue({})
    getBackupPermissionOk.mockResolvedValue(true)
    hasBackup.mockResolvedValue(true)
    readBackup.mockResolvedValue({ projects: [] })
    writeSnapshotToDb.mockResolvedValue()

    const res = await runRestore()

    expect(res).toEqual({ ok: true, decided: true })
    // Toujours écrit, neutre sans l'option (le contrat n'est plus set-only) : la
    // clé n'est pas dans EXCLUDED_SETTINGS_KEYS (serialize.js), un `false` posé
    // ici NEUTRALISE un éventuel `restoredDue: true` importé du snapshot — armé
    // sur ce chemin, le drapeau ferait doublon avec le snackbar de
    // BackupDecisionPrompt.vue.
    await expect(getSetting('restoredDue')).resolves.toBe(false)
  })

  // VERROU DE L'ACQUIS (le fond, pas la forme) : le message « tes données sont de
  // retour » n'a de sens que si le semis a VRAIMENT été écrasé. L'invariant vit dans
  // `writeSnapshotToDb` (clear+bulkPut) et y est prouvé sur des ids quelconques par
  // tests/unit/backup-restore.spec.js (« remplace intégralement les autres tables ») ;
  // celui-ci l'exerce BOUT EN BOUT par `runRestore`, sur les ids SEMÉS : si la
  // restauration se mettait un jour à fusionner au lieu de remplacer, la pop-up
  // mentirait (« tes données » = les exemples d'origine, jamais retrouvés) sans
  // qu'aucun autre test de ce fichier ne rougisse — tous mockent `writeSnapshotToDb`.
  it('après une restauration réussie, les ids des projets semés ne sont plus en base (le semis est écrasé)', async () => {
    const { writeSnapshotToDb: writeSnapshotToDbReel } = await vi.importActual('@/backup/restore')

    getBackupStorage.mockReturnValue({})
    getBackupPermissionOk.mockResolvedValue(true)
    hasBackup.mockResolvedValue(true)
    // Base « téléphone neuf qui vient de passer l'écran d'accueil » : le semis, rien
    // d'autre — le seul état où la porte propose puis restaure.
    const m1 = await db.patterns.add({ name: 'Bonnet Torsade' })
    const j1 = await db.projects.add({ name: 'Écharpe douillette' })
    const j2 = await db.projects.add({ name: 'Bonnet Torsade' })
    await recordSeededSamples({ patterns: [m1], projects: [j1, j2] })
    readBackup.mockResolvedValue({ projects: [{ id: 999, name: 'Le vrai travail' }], settings: [] })
    writeSnapshotToDb.mockImplementation(writeSnapshotToDbReel)

    const res = await runRestore()

    expect(res).toEqual({ ok: true, decided: true })
    // Comparaison EXHAUSTIVE de la table, pas une simple appartenance : un semis qui
    // surviverait À CÔTÉ des données restaurées doit être vu, pas seulement un id
    // manquant.
    expect((await db.projects.toArray()).map((p) => p.id)).toEqual([999])
    expect(await db.patterns.toArray()).toEqual([])
  })

  // ─── Drapeau « dossier propre depuis la restauration » (lot du 06/09/2026) ────────
  //
  // CE QUE CE DRAPEAU FERME. Mesure du 06/09 : ~255 s de requêtes SAF APRÈS la phase
  // de lecture d'une restauration — l'auto-backup « rebondi » (armé par l'écriture de
  // la décision hors de la fenêtre suppressAutoBackup) relit et réécrit un dossier
  // dont le contenu VIENT précisément d'être lu. Une restauration allée au bout
  // (`ok: true`) laisse donc dossier et base en image l'un de l'autre : elle pose le
  // drapeau session-only de restore-guard.js, que callRunBackup et syncPatronMd
  // consultent pour se taire (cf. auto-backup.spec.js et patron-md-sync.spec.js).
  it('succès : le drapeau « dossier propre depuis la restauration » est posé à la résolution', async () => {
    getBackupStorage.mockReturnValue({})
    getBackupPermissionOk.mockResolvedValue(true)
    hasBackup.mockResolvedValue(true)
    readBackup.mockResolvedValue({ projects: [] })
    writeSnapshotToDb.mockResolvedValue()

    const res = await runRestore()

    expect(res).toEqual({ ok: true, decided: true })
    expect(isFolderCleanSinceRestore()).toBe(true)
  })

  // Le marqueur décrit « ma base ressemble au dossier » : un skip (rien lu, rien
  // écrit) ou un échec ne l'autorisent pas — les passages automatiques restent
  // nécessaires, le dossier n'a pas été mis en image.
  it("skipped:'empty' : le drapeau n'est PAS posé (seule une restauration allée au bout le mérite)", async () => {
    getBackupStorage.mockReturnValue({})
    getBackupPermissionOk.mockResolvedValue(true)
    hasBackup.mockResolvedValue(false)

    const res = await runRestore()

    expect(res).toEqual({ ok: false, skipped: 'empty' })
    expect(isFolderCleanSinceRestore()).toBe(false)
  })
})

// Famille 1 (lot du 06/09/2026) : le module de garde lui-même, en direct — même
// style que import-guard.spec.js pour son jumeau. Pur état mémoire de session :
// poser, lire, effacer. (Le `beforeEach` global efface déjà le drapeau ; les deux
// branches sont néanmoins assertées explicitement ici, précondition comprise.)
describe('restore-guard — drapeau « dossier propre depuis la restauration » (direct)', () => {
  it('markFolderClean() pose le drapeau, clearFolderClean() l’efface', () => {
    expect(isFolderCleanSinceRestore()).toBe(false) // précondition : vierge en début de test
    markFolderClean()
    expect(isFolderCleanSinceRestore()).toBe(true)
    clearFolderClean()
    expect(isFolderCleanSinceRestore()).toBe(false)
  })
})

// Avenant 04/08/2026 : `!onboarded` et `empty` ont sauté du
// critère. `!onboarded` enfermait l'utilisatrice qui MET À JOUR l'app (dossier plein,
// aucune décision — la clé est neuve) : sauvegarde en pause pour toujours, sans
// bandeau pour le lui dire. `empty` masquait le bandeau à celle qui a JUSTEMENT le
// plus à perdre — celle qui a déjà du travail réel. Le critère est désormais
// purement : aucune décision + permission accordée + sauvegarde présente.
// Lot du 06/08/2026 : `decided` et `hasBackup` ont sauté de la signature au
// profit de `pauseReason` (backup-pause.js). Ce prédicat ne recalcule plus rien pour son
// compte — il n'y a plus qu'UN critère de pause dans l'app, et le bandeau le suit à la
// lettre. Recalculer ici, c'est ce qui aurait laissé les écritures s'arrêter pour la
// raison « un autre appareil a écrit ici » sans qu'aucun bandeau ne s'affiche.
// `hasBackup` n'est pas perdu : `pauseReason` vaut `null` quand le dossier est vide
// (couvert par tests/unit/backup-pause-reason.spec.js).
describe('shouldOfferRestore', () => {
  const full = { pauseReason: 'no-decision', granted: true }

  // Le point central de l'avenant : `empty`/le contenu de la base n'est plus un
  // paramètre du tout — le bandeau se propose MÊME quand la base contient du
  // travail réel (preuve intégrale au niveau App.vue, cf.
  // tests/unit/App.restore-offer.spec.js) ; c'est `runRestore` (garde finale
  // `isDbRestorable`) qui refusera une restauration destructrice, pas l'affichage
  // du bandeau.
  it('vrai quand la sauvegarde est en pause faute de décision + permission accordée', () => {
    expect(shouldOfferRestore(full)).toBe(true)
  })

  // LA raison ajoutée le 06/08 — celle qui, sans ce prédicat unique, aurait arrêté les
  // écritures en silence : le bandeau doit s'afficher pour elle EXACTEMENT comme pour
  // l'autre, sans quoi il n'existe aucune porte de sortie à l'écran.
  it("vrai aussi quand la pause vient d'un AUTRE appareil", () => {
    expect(shouldOfferRestore({ ...full, pauseReason: 'other-device' })).toBe(true)
  })

  it("faux quand la sauvegarde n'est pas en pause (aucune raison)", () => {
    expect(shouldOfferRestore({ ...full, pauseReason: null })).toBe(false)
  })

  it("faux si la permission n'est pas accordée", () => {
    expect(shouldOfferRestore({ ...full, granted: false })).toBe(false)
  })
})

// Garde-fou unique contre une restauration destructrice
// (`writeSnapshotToDb` est un clear+bulkPut) — partagée par l'offre au lancement
// (`shouldOfferRestore`, ci-dessus) ET par le déclencheur post-désignation de dossier
// (`OnboardingFolderPrompt`, cf. tests/unit/onboarding-folder-prompt.spec.js).
describe('shouldRestoreFromFolder', () => {
  it('vrai quand la base est vide ET une sauvegarde est présente', () => {
    expect(shouldRestoreFromFolder({ empty: true, hasBackup: true })).toBe(true)
  })

  it('faux quand la base n’est PAS vide (jamais de clear+bulkPut destructeur, même avec une sauvegarde présente)', () => {
    expect(shouldRestoreFromFolder({ empty: false, hasBackup: true })).toBe(false)
  })

  it("faux quand aucune sauvegarde n'est présente (même sur base vide)", () => {
    expect(shouldRestoreFromFolder({ empty: true, hasBackup: false })).toBe(false)
  })
})

// Correctif revue (Critical, data loss réel) : `isDbEmpty` doit compter TOUTES les
// données utilisateur que `writeSnapshotToDb` écrase (clear+bulkPut) — pas
// seulement `projects`. Une base sans projet mais avec des patrons de bibliothèque
// importés (PDF/IA) ou des laines en stock n'est PAS vide : une restauration les
// détruirait silencieusement. Même prédicat que `seedable`/`libraryPatterns`
// (src/stores/patterns.js) : un patron `builtin` (patron libre, toujours présent
// dès le 1er lancement) ne compte pas ; un patron d'instance de projet
// (`ownerProjectId` non nul) non plus (couvert par le test sur `projects`).
describe('isDbEmpty', () => {
  it('vrai quand toutes les tables sont vides', async () => {
    expect(await isDbEmpty()).toBe(true)
  })

  it('vrai quand seul un patron builtin (patron libre) est présent', async () => {
    await db.patterns.add({ name: 'Patron libre', builtin: true, ownerProjectId: null })
    expect(await isDbEmpty()).toBe(true)
  })

  it('faux dès qu’un projet existe', async () => {
    await db.projects.add({ name: 'Un projet' })
    expect(await isDbEmpty()).toBe(false)
  })

  it('faux dès qu’un vrai patron de bibliothèque existe (ni builtin, ni instance de projet)', async () => {
    await db.patterns.add({ name: 'Patron importé', builtin: false, ownerProjectId: null })
    expect(await isDbEmpty()).toBe(false)
  })

  it('vrai quand seul un patron d’instance de projet existe (couvert par `projects`, pas double-compté)', async () => {
    await db.patterns.add({ name: 'Instance', builtin: false, ownerProjectId: 42 })
    expect(await isDbEmpty()).toBe(true)
  })

  it('faux dès qu’une laine existe', async () => {
    await db.yarns.add({ brand: 'Une laine' })
    expect(await isDbEmpty()).toBe(false)
  })

  // (budget laine cumulé) : `purchases` a rejoint `REPLACED_TABLES`
  // (backup/restore.js) — une ligne d'achat ORPHELINE (yarnId: null, suppression
  // définitive d'une laine) n'est PAS transitivement couverte par le test
  // sur `yarns` ci-dessus : sans ce test, une base ne contenant plus que de
  // l'historique d'achats serait jugée « vide » et une restauration l'effacerait.
  it('faux dès qu’une ligne d’achat existe, même orpheline (yarnId null)', async () => {
    await db.purchases.add({ yarnId: null, yarnLabel: 'Laine supprimée', quantity: 2, kind: 'buy' })
    expect(await isDbEmpty()).toBe(false)
  })
})

// Correctif (04/08/2026) : le semis d'exemples (3 patrons + 2 projets, écran
// d'accueil) rend `isDbEmpty()` faux dès la fin du 1er lancement — la
// restauration n'était alors JAMAIS proposée, contredisant la promesse du
// guide. `isDbRestorable` reprend `isDbEmpty` (repli sûr) et y ajoute le cas
// « base ne contenant QUE les exemples semés ».
// Pas de `beforeEach` local ici : le `beforeEach` GLOBAL (racine du fichier)
// vide déjà TOUTES les tables (`db.tables.map(t => t.clear())`), sections/
// diagrams/sessions/trash comprises — un sous-ensemble local sous-nettoierait
// silencieusement si la liste globale changeait un jour (poids mort repéré en
// revue, retiré).
describe('isDbRestorable : une base qui ne contient que les exemples semés est restaurable', () => {
  it('base strictement vide → restaurable', async () => {
    expect(await isDbRestorable()).toBe(true)
  })

  it('base ne contenant QUE le semis → restaurable (le cas qui échouait)', async () => {
    const p1 = await db.patterns.add({ name: 'Bonnet Torsade' })
    const p2 = await db.patterns.add({ name: 'Écharpe Nuage' })
    const j1 = await db.projects.add({ name: 'Écharpe douillette' })
    const j2 = await db.projects.add({ name: 'Bonnet Torsade' })
    await recordSeededSamples({ patterns: [p1, p2], projects: [j1, j2] })
    expect(await isDbRestorable()).toBe(true)
  })

  // Protège la restauration d'une base qui ne porte que le projet recréé par la visite guidée.
  it('projet recréé par la visite guidée sur un patron semé, sans travail → restaurable', async () => {
    const { buildWipProject } = await vi.importActual('@/stores/projects')
    const p = await db.patterns.add({ name: 'Bonnet Torsade', sizes: ['S', 'M'] })
    await recordSeededSamples({ patterns: [p], projects: [] })
    const j = await db.projects.add(
      buildWipProject({ demo: { name: 'Bonnet Torsade', patternId: p, sizes: ['S', 'M'], activeSize: 'M' } }),
    )
    await setSetting('tourProjectId', j)
    expect(await isDbRestorable()).toBe(true)
    await db.projects.update(j, { readerState: { size: 1, done: { 0: true } } })
    expect(await isDbRestorable()).toBe(false)
  })

  // Protège un patron de l'utilisatrice relié au projet de la visite : jamais pris pour un exemple.
  it('patron réel relié au projet de la visite (tourPatternId) → pas restaurable', async () => {
    const { buildWipProject } = await vi.importActual('@/stores/projects')
    const seme = await db.patterns.add({ name: 'Bonnet Torsade' })
    await recordSeededSamples({ patterns: [seme], projects: [] })
    const reel = await db.patterns.add({ name: 'Anders Cardigan', sizes: ['S', 'M'] })
    const j = await db.projects.add(
      buildWipProject({ demo: { name: 'Bonnet Torsade', patternId: reel, sizes: ['S', 'M'], activeSize: 'M' } }),
    )
    await setSetting('tourProjectId', j)
    await setSetting('tourPatternId', reel)
    expect(await isDbRestorable()).toBe(false)
  })

  it('semis + UN patron réel → pas restaurable', async () => {
    const p1 = await db.patterns.add({ name: 'Bonnet Torsade' })
    await recordSeededSamples({ patterns: [p1], projects: [] })
    await db.patterns.add({ name: 'Anders Cardigan' })
    expect(await isDbRestorable()).toBe(false)
  })

  it('semis + UN projet réel → pas restaurable', async () => {
    const j1 = await db.projects.add({ name: 'Écharpe douillette' })
    await recordSeededSamples({ patterns: [], projects: [j1] })
    await db.projects.add({ name: 'Marisol Shawl' })
    expect(await isDbRestorable()).toBe(false)
  })

  it('semis + UNE laine → pas restaurable', async () => {
    const p1 = await db.patterns.add({ name: 'Bonnet Torsade' })
    await recordSeededSamples({ patterns: [p1], projects: [] })
    await db.yarns.add({ brand: 'Berroco' })
    expect(await isDbRestorable()).toBe(false)
  })

  it('semis + UN achat → pas restaurable', async () => {
    const p1 = await db.patterns.add({ name: 'Bonnet Torsade' })
    await recordSeededSamples({ patterns: [p1], projects: [] })
    await db.purchases.add({ total: 12 })
    expect(await isDbRestorable()).toBe(false)
  })

  it('semis + UN compteur indépendant → pas restaurable', async () => {
    const p1 = await db.patterns.add({ name: 'Bonnet Torsade' })
    await recordSeededSamples({ patterns: [p1], projects: [] })
    await db.counters.add({ projectId: 0, name: 'Rangs' })
    expect(await isDbRestorable()).toBe(false)
  })

  // Correctif (auto-revue, avant commit) : une utilisatrice qui a UNIQUEMENT
  // travaillé sur le projet démo semé (diagramme annoté, compteur de rangs,
  // séance journalisée) ne crée AUCUN patron/projet/laine/achat réel — sans ces
  // tests, ce travail réel serait effacé sans être détecté (le raisonnement
  // d'`isDbEmpty`, « couvert transitivement par `projects` », ne tient plus dès
  // qu'un projet — même semé — peut exister). `sections` : défense en profondeur
  // seulement, plus aucun chemin de l'app courante n'écrit cette table
  // (`replaceFromPattern`, seule à le faire, n'a plus d'appelant).
  it('semis + UNE section sur le projet démo → pas restaurable (défense en profondeur)', async () => {
    const j1 = await db.projects.add({ name: 'Écharpe douillette' })
    await recordSeededSamples({ patterns: [], projects: [j1] })
    await db.sections.add({ projectId: j1, title: 'Rang 1 à 10', state: 'done' })
    expect(await isDbRestorable()).toBe(false)
  })

  it('semis + UN diagramme annoté sur le projet démo → pas restaurable', async () => {
    const j1 = await db.projects.add({ name: 'Écharpe douillette' })
    await recordSeededSamples({ patterns: [], projects: [j1] })
    await db.diagrams.add({ projectId: j1 })
    expect(await isDbRestorable()).toBe(false)
  })

  it('semis + UNE séance journalisée sur le projet démo → pas restaurable', async () => {
    const j1 = await db.projects.add({ name: 'Écharpe douillette' })
    await recordSeededSamples({ patterns: [], projects: [j1] })
    await db.sessions.add({ projectId: j1, date: '2026-08-04' })
    expect(await isDbRestorable()).toBe(false)
  })

  it('semis + UN compteur DE RANGS sur le projet démo (pas indépendant) → pas restaurable', async () => {
    const j1 = await db.projects.add({ name: 'Écharpe douillette' })
    await recordSeededSamples({ patterns: [], projects: [j1] })
    await db.counters.add({ projectId: j1, name: 'Rangs' })
    expect(await isDbRestorable()).toBe(false)
  })

  // CRITIQUE (revue) : la progression la plus courante — cocher des
  // rangs dans le lecteur — n'écrit AUCUNE ligne dans `sessions` (le chrono n'a
  // jamais été lancé) ; elle vit dans `project.readerState` (cf. `ReaderView.vue`,
  // `ProjectDetailView.vue::onToggleSection`). Comparer les projets par seule
  // IDENTITÉ (id semé ou non) ne suffit donc pas. Ce test isole précisément ce
  // scénario : `sessions` reste VIDE, seul `readerState` porte la preuve du travail
  // — un test qui laisserait `sessions` non vide passerait pour la mauvaise raison.
  it('semis + readerState non vide sur le projet démo, AUCUNE séance chronométrée → pas restaurable', async () => {
    const j1 = await db.projects.add({ name: 'Écharpe douillette', readerState: undefined })
    await recordSeededSamples({ patterns: [], projects: [j1] })
    await db.projects.update(j1, { readerState: { size: 0, done: { 0: true, 1: true } } })
    expect(await db.sessions.count()).toBe(0) // preuve que ce N'EST PAS le chemin déjà couvert
    expect(await isDbRestorable()).toBe(false)
  })

  it('semis + lastWorkedAt renseigné (sans readerState) sur le projet démo → pas restaurable', async () => {
    const j1 = await db.projects.add({ name: 'Écharpe douillette' })
    await recordSeededSamples({ patterns: [], projects: [j1] })
    await db.projects.update(j1, { lastWorkedAt: '2026-08-04T10:00:00.000Z' })
    expect(await isDbRestorable()).toBe(false)
  })

  it('semis + UNE photo ajoutée sur le projet démo → pas restaurable', async () => {
    const j1 = await db.projects.add({ name: 'Écharpe douillette', photos: [] })
    await recordSeededSamples({ patterns: [], projects: [j1] })
    await db.projects.update(j1, { photos: ['data:image/png;base64,abc'] })
    expect(await isDbRestorable()).toBe(false)
  })

  // IMPORTANT (revue) : `writeSnapshotToDb` vide `trash` SANS la sauvegarder (cf.
  // restore.js) — un élément récupérable (laine/patron/projet supprimé) y
  // deviendrait irrécupérable. Inatteignable AVANT ce lot (2 projets semés
  // rendaient `isDbEmpty` faux pour toujours après l'accueil) ; atteignable
  // maintenant qu'une base « semis seul » peut être jugée restaurable.
  it('semis + UN élément dans la corbeille → pas restaurable', async () => {
    const p1 = await db.patterns.add({ name: 'Bonnet Torsade' })
    await recordSeededSamples({ patterns: [p1], projects: [] })
    await db.trash.add({ type: 'yarn', deletedAt: '2026-08-04' })
    expect(await isDbRestorable()).toBe(false)
  })

  // Protège : une corbeille non vide bloque aussi la restauration quand les tables sont vides.
  it('tables vides + UN élément dans la corbeille → pas restaurable', async () => {
    await db.trash.add({ type: 'project', deletedAt: '2026-09-24' })
    expect(await isDbRestorable()).toBe(false)
  })

  it('rien d’enregistré + base semée → PAS restaurable (repli sur isDbEmpty)', async () => {
    await db.patterns.add({ name: 'Bonnet Torsade' })
    expect(await isDbRestorable()).toBe(false)
  })

  // Retiré (correctif revue, 04/08/2026) : « sur une base vide,
  // se comporte comme isDbEmpty » comparait `await isDbRestorable()` à
  // `await isDbEmpty()` sur une base vide — les DEUX valent toujours `true` sur base
  // vide, quelle que soit l'implémentation de `isDbRestorable` (même une qui
  // renverrait bêtement `true` sans rien vérifier passerait ce test). Non
  // discriminant, donc sans valeur : ce que ce test visait à couvrir (« base vide →
  // restaurable ») est déjà prouvé, avec un résultat attendu explicite, par « base
  // strictement vide → restaurable » ci-dessus ; et le point où `isDbRestorable`
  // diverge VRAIMENT d'`isDbEmpty` (une base ne contenant QUE le semis :
  // `isDbEmpty` → false, `isDbRestorable` → true) est déjà couvert juste en dessous
  // par « base ne contenant QUE le semis → restaurable (le cas qui échouait) ».
})

// Garde finale (défense en profondeur, correctif revue) : `runRestore` re-vérifie
// `isDbRestorable()` juste avant l'écriture destructrice — ferme la fenêtre entre
// l'affichage de l'offre et l'action utilisateur, et protège tout futur point
// d'appel qui oublierait de gater en amont.
describe('runRestore — garde finale isDbRestorable', () => {
  beforeEach(() => {
    getBackupStorage.mockReturnValue({})
    getBackupPermissionOk.mockResolvedValue(true)
    hasBackup.mockResolvedValue(true)
  })

  it("skipped:'not-empty' quand la base contient un vrai patron de bibliothèque — writeSnapshotToDb n'est PAS appelée", async () => {
    await db.patterns.add({ name: 'Patron importé', builtin: false, ownerProjectId: null })

    const res = await runRestore()

    expect(res).toEqual({ ok: false, skipped: 'not-empty' })
    expect(readBackup).not.toHaveBeenCalled()
    expect(writeSnapshotToDb).not.toHaveBeenCalled()
  })

  it("skipped:'not-empty' quand la base contient une laine — writeSnapshotToDb n'est PAS appelée", async () => {
    await db.yarns.add({ brand: 'Une laine' })

    const res = await runRestore()

    expect(res).toEqual({ ok: false, skipped: 'not-empty' })
    expect(writeSnapshotToDb).not.toHaveBeenCalled()
  })

  it("skipped:'not-empty' quand la base contient un projet — writeSnapshotToDb n'est PAS appelée", async () => {
    await db.projects.add({ name: 'Un projet' })

    const res = await runRestore()

    expect(res).toEqual({ ok: false, skipped: 'not-empty' })
    expect(writeSnapshotToDb).not.toHaveBeenCalled()
  })

  it('base vide (même avec le patron builtin) + sauvegarde présente → la restauration procède', async () => {
    await db.patterns.add({ name: 'Patron libre', builtin: true, ownerProjectId: null })
    readBackup.mockResolvedValue({ projects: [] })
    writeSnapshotToDb.mockResolvedValue()

    const res = await runRestore()

    expect(res).toEqual({ ok: true, decided: true })
    expect(writeSnapshotToDb).toHaveBeenCalledTimes(1)
  })

  // Preuve par mutation (correctif du 04/08/2026) : ce test est celui qui distingue
  // la garde `isDbRestorable` de l'ancienne garde `isDbEmpty` — TOUS les tests
  // ci-dessus passent encore avec `isDbEmpty` (aucun d'eux ne sème). Sans ce test,
  // remettre par erreur `isDbEmpty` en garde finale de `runRestore` ne ferait rougir
  // AUCUN test de ce fichier : l'invite de restauration s'afficherait, et l'action
  // ne ferait rien — le pire état, silencieux.
  it("base ne contenant QUE les exemples semés + sauvegarde présente → la restauration procède (skipped:'not-empty' serait le bug régressé)", async () => {
    const p1 = await db.patterns.add({ name: 'Bonnet Torsade' })
    const j1 = await db.projects.add({ name: 'Écharpe douillette' })
    await recordSeededSamples({ patterns: [p1], projects: [j1] })
    readBackup.mockResolvedValue({ projects: [] })
    writeSnapshotToDb.mockResolvedValue()

    const res = await runRestore()

    expect(res).toEqual({ ok: true, decided: true })
    expect(writeSnapshotToDb).toHaveBeenCalledTimes(1)
  })
})
