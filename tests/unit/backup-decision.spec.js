// @vitest-environment jsdom
// Unitaire — la décision de sauvegarder sur CE dossier (avenant du 04/08/2026).
// Le réveil de la
// sauvegarde automatique devient une décision explicite, plus une conséquence
// calculée de l'état de la base : `folderKey` et `getSetting`/`setSetting` sont
// mockés pour isoler le module de toute base réelle.
//
// `folderKey` (correctif) — remplace `folderName` : le nom de la racine
// effective (folder-base.js, `decideBase`) ne discrimine rien — deux dossiers
// distincts peuvent porter le même nom. L'URI de l'arbre SAF, elle, discrimine
// réellement — cf. commentaire de tête de backup-decision.js.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const folderKey = vi.hoisted(() => vi.fn())
vi.mock('@/backup/saf-folder', () => ({ folderKey: (...a) => folderKey(...a) }))

const db = vi.hoisted(() => ({ getSetting: vi.fn(), setSetting: vi.fn() }))
vi.mock('@/db/db', () => ({ getSetting: (...a) => db.getSetting(...a), setSetting: (...a) => db.setSetting(...a) }))

const { recordBackupDecision, hasBackupDecision, clearBackupDecision } = await import('@/backup/backup-decision')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('recordBackupDecision', () => {
  it('écrit { folder, at } avec l’identifiant du dossier courant et renvoie true', async () => {
    folderKey.mockResolvedValue('Rowtine')
    const before = Date.now()

    const result = await recordBackupDecision()

    expect(result).toBe(true)
    expect(db.setSetting).toHaveBeenCalledTimes(1)
    const [key, value] = db.setSetting.mock.calls[0]
    expect(key).toBe('backupDecision')
    expect(value.folder).toBe('Rowtine')
    expect(new Date(value.at).getTime()).toBeGreaterThanOrEqual(before)
  })

  it("n'écrit rien et renvoie false quand folderKey() renvoie null", async () => {
    folderKey.mockResolvedValue(null)

    const result = await recordBackupDecision()

    expect(result).toBe(false)
    expect(db.setSetting).not.toHaveBeenCalled()
  })

  // Étape 7b : une chaîne vide est falsy — même garde que `null`, elle ne doit ni
  // enregistrer ni satisfaire la comparaison plus bas.
  it("n'écrit rien et renvoie false quand folderKey() renvoie une chaîne vide", async () => {
    folderKey.mockResolvedValue('')

    const result = await recordBackupDecision()

    expect(result).toBe(false)
    expect(db.setSetting).not.toHaveBeenCalled()
  })

  it("n'écrit rien et renvoie false quand folderKey() lève", async () => {
    folderKey.mockRejectedValue(new Error('permission SAF perdue'))

    const result = await recordBackupDecision()

    expect(result).toBe(false)
    expect(db.setSetting).not.toHaveBeenCalled()
  })
})

describe('hasBackupDecision', () => {
  it('est vraie quand la décision porte le dossier courant', async () => {
    folderKey.mockResolvedValue('Rowtine')
    db.getSetting.mockResolvedValue({ folder: 'Rowtine', at: '2026-08-04T10:00:00.000Z' })

    expect(await hasBackupDecision()).toBe(true)
  })

  it('est fausse quand la décision porte un autre dossier (dossier A ne vaut pas pour dossier B)', async () => {
    folderKey.mockResolvedValue('Rowtine sur le Huawei')
    db.getSetting.mockResolvedValue({ folder: 'Rowtine sur la tablette', at: '2026-08-04T10:00:00.000Z' })

    expect(await hasBackupDecision()).toBe(false)
  })

  // Étape 3c : forme réellement produite en production — deux URI SAF distinctes
  // (dossiers différents), pas des libellés inventés comme 'Un autre dossier'.
  it('deux URI SAF différentes (forme réelle de production) : la décision ne vaut pas pour l’autre dossier', async () => {
    folderKey.mockResolvedValue(
      'content://com.android.externalstorage.documents/tree/primary%3ADocuments%2FRowtine',
    )
    db.getSetting.mockResolvedValue({
      folder: 'content://com.android.externalstorage.documents/tree/1234-5678%3ARowtine',
      at: '2026-08-04T10:00:00.000Z',
    })

    expect(await hasBackupDecision()).toBe(false)
  })

  it("est fausse quand folderKey() renvoie null, même si une décision existe — null === null ne doit jamais passer", async () => {
    folderKey.mockResolvedValue(null)
    db.getSetting.mockResolvedValue({ folder: null, at: '2026-08-04T10:00:00.000Z' })

    expect(await hasBackupDecision()).toBe(false)
    // Repli le plus prudent : on ne consulte même pas le réglage sans identifiant de dossier.
    expect(db.getSetting).not.toHaveBeenCalled()
  })

  // Étape 7b : même garde côté lecture — une chaîne vide ne doit jamais satisfaire
  // la comparaison (et ne consulte pas le réglage, même raisonnement que `null`).
  it("est fausse quand folderKey() renvoie une chaîne vide", async () => {
    folderKey.mockResolvedValue('')

    expect(await hasBackupDecision()).toBe(false)
    expect(db.getSetting).not.toHaveBeenCalled()
  })

  it('est fausse sur un réglage absent (undefined)', async () => {
    folderKey.mockResolvedValue('Rowtine')
    db.getSetting.mockResolvedValue(undefined)

    expect(await hasBackupDecision()).toBe(false)
  })

  it('est fausse sur un réglage null', async () => {
    folderKey.mockResolvedValue('Rowtine')
    db.getSetting.mockResolvedValue(null)

    expect(await hasBackupDecision()).toBe(false)
  })

  it('est fausse sur un réglage qui est une chaîne (forme inattendue)', async () => {
    folderKey.mockResolvedValue('Rowtine')
    db.getSetting.mockResolvedValue('Rowtine')

    expect(await hasBackupDecision()).toBe(false)
  })

  it('est fausse sur un objet sans clé folder', async () => {
    folderKey.mockResolvedValue('Rowtine')
    db.getSetting.mockResolvedValue({ at: '2026-08-04T10:00:00.000Z' })

    expect(await hasBackupDecision()).toBe(false)
  })

  it('se referme (false) si folderKey() lève', async () => {
    folderKey.mockRejectedValue(new Error('permission SAF perdue'))

    expect(await hasBackupDecision()).toBe(false)
  })

  it('se referme (false) si getSetting() lève', async () => {
    folderKey.mockResolvedValue('Rowtine')
    db.getSetting.mockRejectedValue(new Error('base illisible'))

    expect(await hasBackupDecision()).toBe(false)
  })
})

describe('clearBackupDecision', () => {
  it('puis hasBackupDecision → faux', async () => {
    folderKey.mockResolvedValue('Rowtine')

    await clearBackupDecision()

    expect(db.setSetting).toHaveBeenCalledWith('backupDecision', null)
    // Reflète l'effacement : le prochain getSetting renverrait null, donc pas de décision.
    db.getSetting.mockResolvedValue(null)
    expect(await hasBackupDecision()).toBe(false)
  })
})
