// Unitaire — service de sauvegarde runtime (bascule SAF seule incluse) :
// sélection du stockage SAF, permission, orchestration
// (collecte + backupAll), et horodatage. Toutes les dépendances externes sont
// mockées — on teste la logique JS, pas le natif (validé sur device par ailleurs).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSetting } from '@/db/db'

// Garde anti-écrasement (2026-08-04) : neutralisée par défaut dans ce fichier,
// qui teste l'orchestration nominale de `runBackup`. Son comportement propre est
// couvert par tests/unit/backup-pause.spec.js et tests/unit/backup-pause-guard.spec.js.
const isBackupPaused = vi.hoisted(() => vi.fn(async () => false))
vi.mock('@/backup/backup-pause', () => ({ isBackupPaused: (...a) => isBackupPaused(...a) }))

// Dossier-vide-vaut-décision : `hasBackup` mocké par défaut sur
// `true` (dossier déjà plein) — le cas le plus fréquent dans ce fichier, qui ne
// s'intéresse pas en priorité à cette dérogation (couverte en détail par
// tests/unit/backup-pause-guard.spec.js, qui exerce le VRAI orchestrateur). Sans ce
// défaut à `true`, chaque test de ce fichier déclencherait silencieusement
// `recordBackupDecision` (dossier « vide » par défaut d'un mock non configuré).
const hasBackup = vi.hoisted(() => vi.fn(async () => true))
vi.mock('@/backup/restore', () => ({ hasBackup: (...a) => hasBackup(...a) }))

const recordBackupDecision = vi.hoisted(() => vi.fn(async () => true))
vi.mock('@/backup/backup-decision', () => ({ recordBackupDecision: (...a) => recordBackupDecision(...a) }))

const isNativePlatform = vi.fn()
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: (...a) => isNativePlatform(...a) },
}))

const hasFolder = vi.fn()
vi.mock('@/backup/saf-folder', () => ({
  hasFolder: (...a) => hasFolder(...a),
}))

const safStorageCtor = vi.fn()
vi.mock('@/backup/saf-storage', () => ({
  SafBackupStorage: class {
    constructor(...a) {
      safStorageCtor(...a)
    }
  },
}))

const collectBackupData = vi.fn()
vi.mock('@/backup/collect', () => ({
  collectBackupData: (...a) => collectBackupData(...a),
}))

const backupAll = vi.fn()
vi.mock('@/backup/orchestrator', () => ({
  backupAll: (...a) => backupAll(...a),
}))

// Synchro des .md : mockée pour pouvoir faire REJETER `runBackupSerialized` AVANT son
// `try` interne. `runBackup` est sinon incapable de rejeter (il rattrape tout et résout
// `{ ok:false, error }`), si bien qu'aucun test ne pouvait exercer le gestionnaire de
// rejet du maillon de chaîne — c'est exactement le faux vert corrigé ici.
const isSyncRunning = vi.hoisted(() => vi.fn(() => false))
const whenSyncIdle = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/backup/patron-md-sync', () => ({
  isSyncRunning: (...a) => isSyncRunning(...a),
  whenSyncIdle: (...a) => whenSyncIdle(...a),
}))

const writeManifest = vi.hoisted(() => vi.fn(async () => true))
vi.mock('@/backup/backup-manifest', () => ({ writeManifest: (...a) => writeManifest(...a) }))

// Import après les mocks (hoistés par vitest de toute façon, mais plus lisible ainsi).
const { getBackupStorage, runBackup } = await import('@/backup/backup-service')

beforeEach(async () => {
  vi.clearAllMocks()
  isBackupPaused.mockResolvedValue(false)
  hasBackup.mockResolvedValue(true) // dossier déjà plein par défaut, cf. commentaire ci-dessus
  recordBackupDecision.mockResolvedValue(true)
  isSyncRunning.mockReturnValue(false)
  whenSyncIdle.mockResolvedValue(undefined)
  const { db } = await import('@/db/db')
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('getBackupStorage', () => {
  // Sélection SAF/null (plus de repli MANAGE) : couverte en détail par
  // `tests/unit/backup-storage-selection.spec.js`. Ici, tests de fumée sur le
  // câblage réel du module (mêmes mocks que le reste de ce fichier).
  it('renvoie null sur plateforme native sans dossier SAF désigné', async () => {
    isNativePlatform.mockReturnValue(true)
    hasFolder.mockResolvedValue(false)
    const storage = await getBackupStorage()
    expect(storage).toBeNull()
  })

  it('renvoie une SafBackupStorage sur plateforme native avec un dossier SAF désigné', async () => {
    isNativePlatform.mockReturnValue(true)
    hasFolder.mockResolvedValue(true)
    const storage = await getBackupStorage()
    expect(storage).not.toBeNull()
    expect(safStorageCtor).toHaveBeenCalled()
  })

  it('renvoie null hors plateforme native (web/dev)', async () => {
    isNativePlatform.mockReturnValue(false)
    expect(await getBackupStorage()).toBeNull()
  })
})

describe('runBackup', () => {
  it("skipped:'web' quand pas de stockage natif", async () => {
    isNativePlatform.mockReturnValue(false)
    const res = await runBackup()
    expect(res).toEqual({ ok: false, skipped: 'web' })
    expect(hasFolder).not.toHaveBeenCalled()
    expect(writeManifest).not.toHaveBeenCalled()
  })

  it("skipped:'web' quand natif sans dossier SAF désigné (plus de repli MANAGE)", async () => {
    isNativePlatform.mockReturnValue(true)
    hasFolder.mockResolvedValue(false)
    const res = await runBackup()
    expect(res).toEqual({ ok: false, skipped: 'web' })
    expect(collectBackupData).not.toHaveBeenCalled()
    expect(backupAll).not.toHaveBeenCalled()
    expect(writeManifest).not.toHaveBeenCalled()
  })

  it("skipped:'permission' si le dossier SAF devient inaccessible entre les deux vérifications", async () => {
    // Cas limite : `getBackupPermissionOk` (donc `hasFolder`) est réinterrogé
    // séparément de `getBackupStorage` — une perte d'accès entre les deux
    // appels doit encore être rattrapée sans crash.
    isNativePlatform.mockReturnValue(true)
    hasFolder.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const res = await runBackup()
    expect(res).toEqual({ ok: false, skipped: 'permission' })
    expect(collectBackupData).not.toHaveBeenCalled()
    expect(backupAll).not.toHaveBeenCalled()
    expect(writeManifest).not.toHaveBeenCalled()
  })

  it('chemin nominal : collecte + backupAll + horodatage lastBackupAt', async () => {
    isNativePlatform.mockReturnValue(true)
    hasFolder.mockResolvedValue(true)
    const snapshot = { projects: [] }
    collectBackupData.mockResolvedValue(snapshot)
    backupAll.mockResolvedValue({ written: 3, removed: 0 })

    expect(await getSetting('lastBackupAt')).toBeUndefined()
    const res = await runBackup()

    expect(res).toEqual({ ok: true })
    expect(collectBackupData).toHaveBeenCalledTimes(1)
    expect(backupAll).toHaveBeenCalledWith(expect.any(Object), snapshot, expect.any(Object))
    const stamp = await getSetting('lastBackupAt')
    expect(stamp).toBeTypeOf('string')
    expect(new Date(stamp).toString()).not.toBe('Invalid Date')
    // Dossier déjà plein (`hasBackup` → true, défaut de ce fichier) : rien à
    // acquitter, la décision ne doit pas être (ré)enregistrée à chaque sauvegarde.
    expect(recordBackupDecision).not.toHaveBeenCalled()
  })

  // Fiche d'identité (lot du 06/08/2026) : écrite à chaque sauvegarde réussie.
  describe('fiche d’identité', () => {
    beforeEach(() => {
      isNativePlatform.mockReturnValue(true)
      hasFolder.mockResolvedValue(true)
      collectBackupData.mockResolvedValue({ projects: [] })
      backupAll.mockResolvedValue({ written: 1, removed: 0 })
    })

    it('une sauvegarde réussie écrit la fiche d’identité, avec le même stockage', async () => {
      const res = await runBackup({ force: true })
      expect(res.ok).toBe(true)
      expect(writeManifest).toHaveBeenCalledTimes(1)
      // Le stockage passé à la fiche est celui qui a servi à backupAll — pas un autre.
      expect(writeManifest.mock.calls[0][0]).toBe(backupAll.mock.calls[0][0])
    })

    it('la fiche est écrite APRÈS backupAll, donc hors d’atteinte de reconcile', async () => {
      await runBackup({ force: true })
      expect(backupAll.mock.invocationCallOrder[0]).toBeLessThan(writeManifest.mock.invocationCallOrder[0])
    })

    it('une fiche non écrite ne fait PAS échouer une sauvegarde réussie', async () => {
      writeManifest.mockRejectedValueOnce(new Error('E/S'))
      await expect(runBackup({ force: true })).resolves.toMatchObject({ ok: true })
    })
  })

  it('transmet le VRAI rappel `onProgress` reçu à `backupAll` (pas un objet quelconque)', async () => {
    // Sentinelle : si `runBackup` oubliait de transmettre et appelait
    // `backupAll(storage, snapshot, {})`, un `expect.any(Object)` laisserait
    // passer ça sans broncher — ici, seule LA fonction passée par l'appelant
    // satisfait l'assertion.
    isNativePlatform.mockReturnValue(true)
    hasFolder.mockResolvedValue(true)
    const snapshot = { projects: [] }
    collectBackupData.mockResolvedValue(snapshot)
    backupAll.mockResolvedValue({ written: 0, removed: 0 })

    const onProgress = vi.fn()
    await runBackup({ onProgress })

    expect(backupAll).toHaveBeenCalledWith(expect.any(Object), snapshot, { onProgress })
  })

  it('erreurs attrapées → { ok:false, error }', async () => {
    isNativePlatform.mockReturnValue(true)
    hasFolder.mockResolvedValue(true)
    collectBackupData.mockRejectedValue(new Error('boum'))

    const res = await runBackup()
    expect(res).toEqual({ ok: false, error: 'boum' })
    expect(writeManifest).not.toHaveBeenCalled()
  })

  it("skipped:'restorable' quand la garde anti-écrasement est active", async () => {
    isNativePlatform.mockReturnValue(true)
    hasFolder.mockResolvedValue(true)
    isBackupPaused.mockResolvedValue(true)

    const res = await runBackup()

    expect(res).toEqual({ ok: false, skipped: 'restorable' })
    expect(collectBackupData).not.toHaveBeenCalled()
    expect(backupAll).not.toHaveBeenCalled()
    expect(writeManifest).not.toHaveBeenCalled()
  })

  it("overwriteBackup:true franchit la garde sans même l'interroger", async () => {
    isNativePlatform.mockReturnValue(true)
    hasFolder.mockResolvedValue(true)
    isBackupPaused.mockResolvedValue(true)
    collectBackupData.mockResolvedValue({ projects: [] })
    backupAll.mockResolvedValue({ written: 1, removed: 0 })

    const res = await runBackup({ overwriteBackup: true })

    expect(res).toEqual({ ok: true })
    expect(backupAll).toHaveBeenCalled()
    // 5a (différé) : sans cette ligne, l'intitulé du test promet
    // ce qu'il ne vérifie pas — la garde n'est pas seulement franchie, elle n'est
    // même pas consultée.
    expect(isBackupPaused).not.toHaveBeenCalled()
    // Étape 1, avertissement connu : `overwriteBackup` pose déjà sa PROPRE
    // décision côté appelant (SafFolderSection.startFresh / BackupDecisionPrompt) —
    // `runBackup` ne doit ni relire `hasBackup` (nouveau mode d'échec inutile sur la
    // porte de secours) ni enregistrer de décision à sa place.
    expect(hasBackup).not.toHaveBeenCalled()
    expect(recordBackupDecision).not.toHaveBeenCalled()
  })

  // Étape 1 (CRITIQUE, re-revue du 04/08) : sur un dossier vide, la 1re
  // sauvegarde a le droit d'écrire SANS décision préalable — et doit alors
  // enregistrer elle-même cette décision, sous peine de se bloquer pour toujours dès
  // la mutation suivante (« pause définitive en silence »). Couvert ici au niveau
  // unitaire (mocks) ; l'intégration bout-en-bout (vrai orchestrateur, vraie
  // arborescence) est dans tests/unit/backup-pause-guard.spec.js.
  describe('dossier-vide-vaut-décision (étape 1)', () => {
    it('dossier vide (hasBackup:false) : après une écriture réussie, enregistre la décision', async () => {
      isNativePlatform.mockReturnValue(true)
      hasFolder.mockResolvedValue(true)
      hasBackup.mockResolvedValue(false)
      collectBackupData.mockResolvedValue({ projects: [] })
      backupAll.mockResolvedValue({ written: 2, removed: 0 })

      const res = await runBackup()

      expect(res).toEqual({ ok: true })
      expect(recordBackupDecision).toHaveBeenCalledTimes(1)
    })

    it('dossier déjà plein (hasBackup:true) : une sauvegarde réussie ne (ré)enregistre pas la décision', async () => {
      isNativePlatform.mockReturnValue(true)
      hasFolder.mockResolvedValue(true)
      hasBackup.mockResolvedValue(true)
      collectBackupData.mockResolvedValue({ projects: [] })
      backupAll.mockResolvedValue({ written: 2, removed: 0 })

      const res = await runBackup()

      expect(res).toEqual({ ok: true })
      expect(recordBackupDecision).not.toHaveBeenCalled()
    })

    // ⚠️#2 : `recordBackupDecision` peut lever OU renvoyer `false` — dans
    // les deux cas, une sauvegarde qui a RÉUSSI ne doit jamais devenir un échec.
    it("recordBackupDecision() lève : la sauvegarde reste { ok: true } quand même", async () => {
      isNativePlatform.mockReturnValue(true)
      hasFolder.mockResolvedValue(true)
      hasBackup.mockResolvedValue(false)
      collectBackupData.mockResolvedValue({ projects: [] })
      backupAll.mockResolvedValue({ written: 2, removed: 0 })
      recordBackupDecision.mockRejectedValue(new Error('base illisible'))

      const res = await runBackup()

      expect(res).toEqual({ ok: true })
    })

    it('recordBackupDecision() renvoie false : la sauvegarde reste { ok: true } quand même', async () => {
      isNativePlatform.mockReturnValue(true)
      hasFolder.mockResolvedValue(true)
      hasBackup.mockResolvedValue(false)
      collectBackupData.mockResolvedValue({ projects: [] })
      backupAll.mockResolvedValue({ written: 2, removed: 0 })
      recordBackupDecision.mockResolvedValue(false)

      const res = await runBackup()

      expect(res).toEqual({ ok: true })
    })
  })
})

// SÉRIALISATION DES SAUVEGARDES (correctif revue de l'écriture par tranches).
//
// Rien n'empêchait deux `runBackup` de tourner en même temps : `backupRunning` ne
// servait qu'à éconduire une synchro MD, et `isAutoBackupSuppressed` ne couvre que le
// chemin débouncé — pas les deux appelants DIRECTS de « Repartir de zéro »
// (SafFolderSection, BackupDecisionPrompt), dont le verrou local ne pare qu'un double
// clic sur SON propre bouton.
//
// C'était bénin AVANT le tranchage (deux écritures concurrentes du même fichier, le
// dernier gagnait, fichier COMPLET). Depuis, les deux passes partagent `<nom>.part` et
// peuvent publier un fichier MÉLANGÉ sous le nom final — un `laines.json` mi-A mi-B que
// `readRootJson` ne sait pas parser, donc une restauration qui échoue EN ENTIER.
describe('deux sauvegardes concurrentes ne peuvent pas publier un fichier mélangé', () => {
  it('le fichier publié porte UNE charge complète, et les deux passes ne se recouvrent jamais', async () => {
    isNativePlatform.mockReturnValue(true)
    hasFolder.mockResolvedValue(true)
    isBackupPaused.mockResolvedValue(false)

    // BARRIÈRE, et non simple entrelacement de microtâches : sans elle, le test passe
    // par accident. `overwriteBackup: true` saute deux `await` (garde de pause et
    // `hasBackup`), donc les deux passes ne restent pas en pas cadencé et peuvent ne
    // pas se chevaucher du tout. La barrière force le recouvrement quand rien ne
    // l'empêche — c'est ce qui rend l'échec REPRODUCTIBLE.
    let ouvrir
    const barriere = new Promise((r) => {
      ouvrir = r
    })

    // Reproduit le protocole du natif : `<nom>.part`, tranche par tranche, puis
    // publication par renommage. C'est exactement là que deux passes s'entremêlent.
    const fichiers = new Map()
    let dedans = 0
    let recouvrementMax = 0
    collectBackupData
      .mockResolvedValueOnce({ projects: [], charge: 'AAAA' })
      .mockResolvedValueOnce({ projects: [], charge: 'BBBB' })
    backupAll.mockImplementation(async (_storage, snapshot) => {
      dedans += 1
      recouvrementMax = Math.max(recouvrementMax, dedans)
      try {
        const chemin = 'laines.json'
        const tmp = `${chemin}.part`
        fichiers.set(tmp, snapshot.charge[0]) // offset 0 : efface le résidu, écrit la 1re tranche
        await barriere
        for (const tranche of snapshot.charge.slice(1)) fichiers.set(tmp, fichiers.get(tmp) + tranche)
        fichiers.set(chemin, fichiers.get(tmp)) // publication par renommage
        fichiers.delete(tmp)
        return { written: 1, removed: 0 }
      } finally {
        dedans -= 1
      }
    })

    // Les deux appels partent dans le MÊME tour de boucle : c'est le cas réel
    // « auto-sauvegarde en cours + appui sur Repartir de zéro ».
    const tout = Promise.all([runBackup(), runBackup({ overwriteBackup: true })])
    // On attend la CONDITION, pas un nombre fixe de tours : mesuré, un nombre fixe ne
    // suffit pas — les deux passes ne traversent pas le même nombre d'`await` avant
    // `backupAll` (`overwriteBackup: true` saute la garde de pause et `hasBackup`), et
    // le test passait alors que RIEN ne sérialisait. Sans sérialisation, la boucle sort
    // dès que les deux sont entrées, et elles y sont donc ensemble ; avec, elle va au
    // bout de ses tours (rapides) et la 2e n'entre qu'après la sortie de la 1re.
    for (let i = 0; i < 50 && backupAll.mock.calls.length < 2; i += 1) {
      await new Promise((r) => setTimeout(r, 0))
    }
    ouvrir()
    const [a, b] = await tout

    expect(a).toEqual({ ok: true })
    // Le geste explicite ne doit pas devenir un no-op silencieux : il est mis en file,
    // pas éconduit.
    expect(b, '« Repartir de zéro » ne doit pas être éconduit').toEqual({ ok: true })
    expect(backupAll).toHaveBeenCalledTimes(2)
    expect(
      recouvrementMax,
      'deux backupAll se recouvrent : elles partagent alors le même <nom>.part',
    ).toBe(1)
    expect(
      ['AAAA', 'BBBB'],
      'un fichier mi-A mi-B fait échouer la restauration ENTIÈRE',
    ).toContain(fichiers.get('laines.json'))
    expect(fichiers.has('laines.json.part'), 'aucun résidu ne doit rester').toBe(false)
  })

  it('une sauvegarde qui REJETTE n’empoisonne pas la suivante', async () => {
    // ⚠️ Version précédente de ce test : FAUX VERT. Elle faisait échouer `backupAll`,
    // mais `runBackupSerialized` rattrape tout en interne et RÉSOUT `{ ok:false }` —
    // la promesse ne rejetait donc jamais, aucun gestionnaire de rejet n'était
    // traversé, et le test restait vert même en les supprimant tous les deux.
    //
    // Ce qui rejette pour de bon, c'est ce qui précède le `try` : la résolution du
    // module de synchro et l'attente de `whenSyncIdle`. On le pilote ici.
    isNativePlatform.mockReturnValue(true)
    hasFolder.mockResolvedValue(true)
    isBackupPaused.mockResolvedValue(false)
    hasBackup.mockResolvedValue(true)
    collectBackupData.mockResolvedValue({ projects: [] })
    backupAll.mockResolvedValue({ written: 1, removed: 0 })
    isSyncRunning.mockImplementationOnce(() => {
      throw new Error('module de synchro indisponible')
    })

    const premiere = runBackup()
    const seconde = runBackup()

    await expect(premiere).rejects.toThrow(/module de synchro indisponible/)
    // Le maillon avale l'échec : sans lui, la chaîne resterait rejetée et CETTE
    // sauvegarde-ci serait refusée sans même être tentée — une anomalie passagère
    // condamnerait toutes les sauvegardes de la session.
    await expect(seconde).resolves.toEqual({ ok: true })
    expect(backupAll, 'la seconde sauvegarde doit avoir réellement tourné').toHaveBeenCalledTimes(1)
  })
})
