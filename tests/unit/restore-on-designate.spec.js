// Unitaire — helper PARTAGÉ de restauration sur désignation de dossier
// (extrait dans src/backup/restore-on-designate.js
// pour être consommé à la fois par OnboardingFolderPrompt.vue et
// SafFolderSection.vue). Garde-fou destructive-safe (jamais sur base non
// vide) déjà couverte en isolation par shouldRestoreFromFolder
// (tests/unit/backup-restore-service.spec.js) — ici on teste le WIRING du
// helper lui-même : consultation du stockage/hasBackup, confirmation (depuis
// le 31/08/2026 : la modale maison `LocalRestoreOffer`, injectée par l'appelant
// via `confirmRestore` — l'ancien `window.confirm` natif est retiré),
// déclenchement (ou non) de runRestore, et tolérance aux erreurs de garde.
//
// ADAPTÉ (décision produit du 05/09/2026) : le retour n'est plus un
// booléen mais `{ attempted, result?, error? }` — le compte rendu de `runRestore`
// n'est plus JETÉ (c'est lui qui alimente la modale RestoreErrorDialog côté
// appelant) et une erreur de garde avalée est désormais PORTÉE, plus perdue.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const backupService = vi.hoisted(() => ({ getBackupStorage: vi.fn() }))
vi.mock('@/backup/backup-service', () => backupService)

const restoreApi = vi.hoisted(() => ({ hasBackup: vi.fn() }))
vi.mock('@/backup/restore', () => restoreApi)

const restoreService = vi.hoisted(() => ({
  runRestore: vi.fn(),
  shouldRestoreFromFolder: vi.fn(),
  isDbRestorable: vi.fn(),
}))
vi.mock('@/backup/restore-service', () => restoreService)

// Lot « restauration lourde » (06/09/2026) : le helper enveloppe désormais TOUT son
// corps dans `suppressAutoBackup` (auto-backup.js). Mocké ici en PASSTHROUGH
// transparent : il exécute la callback reçue telle quelle (le comportement attendu
// par tous les autres tests n'est pas altéré) et expose `inside`, que les tests
// consultent pour constater QUAND la fenêtre de suppression est active.
const autoBackup = vi.hoisted(() => {
  const api = { inside: false, suppressAutoBackup: null }
  api.suppressAutoBackup = vi.fn(async (fn) => {
    api.inside = true
    try {
      return await fn()
    } finally {
      api.inside = false
    }
  })
  return api
})
vi.mock('@/backup/auto-backup', () => autoBackup)

// Module PUR (deux booléens module-level), volontairement PAS mocké : la spec et
// le helper doivent partager la MÊME instance pour que la lecture du drapeau dans
// le corps de `confirmRestore` soit la preuve réelle du wiring.
const { isRestoreDecisionPending } = await import('@/backup/restore-guard')

const { maybeRestoreAfterDesignation } = await import('@/backup/restore-on-designate')

const t = (key) => key

// Scénario NOMINAL de la garde, réutilisé par plusieurs tests : stockage présent,
// base restaurable, sauvegarde trouvée.
const gardePasse = (storage = {}) => {
  backupService.getBackupStorage.mockResolvedValue(storage)
  restoreService.isDbRestorable.mockResolvedValue(true)
  restoreApi.hasBackup.mockResolvedValue(true)
}

beforeEach(() => {
  backupService.getBackupStorage.mockReset()
  restoreApi.hasBackup.mockReset()
  restoreService.runRestore.mockReset().mockResolvedValue({ ok: true })
  restoreService.isDbRestorable.mockReset()
  restoreService.shouldRestoreFromFolder.mockReset().mockImplementation(({ empty, hasBackup }) => !!empty && !!hasBackup)
  autoBackup.suppressAutoBackup.mockClear()
  autoBackup.inside = false
})

describe('maybeRestoreAfterDesignation', () => {
  it('pas de stockage natif (web/dev) : ne fait rien, ne lève pas', async () => {
    backupService.getBackupStorage.mockResolvedValue(null)
    const res = await maybeRestoreAfterDesignation(t)
    expect(res).toEqual({ attempted: false })
    expect(res.error).toBeUndefined()
    expect(restoreService.runRestore).not.toHaveBeenCalled()
  })

  it('base vide + sauvegarde présente : confirme (modale) puis restaure', async () => {
    const storage = {}
    gardePasse(storage)
    const confirmRestore = vi.fn().mockResolvedValue(true)

    const res = await maybeRestoreAfterDesignation(t, { confirmRestore })

    expect(restoreApi.hasBackup).toHaveBeenCalledWith(storage)
    expect(confirmRestore).toHaveBeenCalledTimes(1)
    expect(restoreService.runRestore).toHaveBeenCalledTimes(1)
    expect(res.attempted).toBe(true)
    expect(res.result).toEqual({ ok: true })
  })

  // LE point du contrat A1 : le compte rendu de `runRestore` traverse TEL QUEL —
  // y compris `owned:false` et `errors` (écarts `readBackup`) — car c'est
  // L'APPELANT qui traduit ces clés en publication à RestoreErrorDialog. Un
  // appauvrissement ici recréerait le silence que le lot ferme.
  it('le compte rendu de runRestore est renvoyé TEL QUEL (owned, errors, decided)', async () => {
    gardePasse()
    const confirmRestore = vi.fn().mockResolvedValue(true)
    const compteRendu = { ok: true, decided: false, owned: false, errors: [{ where: 'p', code: 'ENTITY_REJECTED' }] }
    restoreService.runRestore.mockResolvedValue(compteRendu)

    const res = await maybeRestoreAfterDesignation(t, { confirmRestore })

    expect(res.attempted).toBe(true)
    expect(res.result).toStrictEqual(compteRendu)
  })

  it('transmet le VRAI rappel `onProgress` reçu à `runRestore`, ET arme notifyRestored (pas un objet quelconque)', async () => {
    // Sentinelle (même raisonnement que les deux fichiers de service) : un
    // `expect.any(Object)` laisserait passer un `runRestore({})` où la
    // transmission aurait été oubliée — ici, seule LA fonction passée par
    // l'appelant satisfait l'assertion.
    // `notifyRestored: true` (lot du 06/09/2026) : la porte est le SEUL appelant qui
    // doit armer le message « tes données sont de retour » — ici, la restauration EST
    // le fil du parcours (fin d'onboarding), et sans ce drapeau l'accueil resterait
    // muet (la bienvenue du semis vient d'être effacée par `runRestore`). L'autre
    // appelant (BackupDecisionPrompt.vue, bandeau des Réglages) garde son snackbar.
    // Égalité STRICTE de l'objet : omettre la clé ici recréerait le silence, sans
    // qu'aucun autre test de ce fichier ne rougisse.
    gardePasse()
    const confirmRestore = vi.fn().mockResolvedValue(true)

    const onProgress = vi.fn()
    await maybeRestoreAfterDesignation(t, { onProgress, confirmRestore })

    expect(restoreService.runRestore).toHaveBeenCalledWith({ onProgress, notifyRestored: true })
  })

  it('base NON vide : ne restaure jamais (territoire de syncPatronMd)', async () => {
    backupService.getBackupStorage.mockResolvedValue({})
    restoreService.isDbRestorable.mockResolvedValue(false)
    restoreApi.hasBackup.mockResolvedValue(true)
    const confirmRestore = vi.fn().mockResolvedValue(true)

    const res = await maybeRestoreAfterDesignation(t, { confirmRestore })

    expect(confirmRestore).not.toHaveBeenCalled()
    expect(restoreService.runRestore).not.toHaveBeenCalled()
    expect(res).toEqual({ attempted: false })
  })

  it('refus de la modale (« Plus tard ») : ne restaure pas', async () => {
    backupService.getBackupStorage.mockResolvedValue({})
    restoreService.isDbRestorable.mockResolvedValue(true)
    restoreApi.hasBackup.mockResolvedValue(true)
    const confirmRestore = vi.fn().mockResolvedValue(false)

    const res = await maybeRestoreAfterDesignation(t, { confirmRestore })

    expect(restoreService.runRestore).not.toHaveBeenCalled()
    expect(res).toEqual({ attempted: false })
    expect(res.error).toBeUndefined()
  })

  // Lot « restauration lourde » (06/09/2026) : le retour du sélecteur SAF est un
  // cycle pause/resume, et le listener `resume` d'App.vue relance une synchro MD
  // PENDANT que la modale attend — sans drapeau, elle lit intégralement patron.md
  // et patron.json avant même de comparer les hashs (~88 s de requêtes SAF
  // mesurées le 06/09). Le drapeau « décision en attente » doit donc être posé
  // AVANT l'attente de `confirmRestore` et baissé à sa résolution — le corps de
  // la modale (ici, mocké) consulte le MÊME module restore-guard que la future
  // garde de `syncPatronMd` : la lecture pendant l'attente est la preuve réelle
  // du wiring, pas une simulation.
  it('drapeau « décision en attente » : posé pendant la modale, baissé après — même sur refus', async () => {
    gardePasse()
    const pendingPendantModale = []
    const confirmRestore = vi.fn(async () => {
      pendingPendantModale.push(isRestoreDecisionPending())
      return false // refus : « Perdre les données »
    })

    expect(isRestoreDecisionPending()).toBe(false)
    const res = await maybeRestoreAfterDesignation(t, { confirmRestore })

    expect(res).toEqual({ attempted: false }) // refus : rien de tenté
    expect(restoreService.runRestore).not.toHaveBeenCalled()
    expect(pendingPendantModale).toEqual([true]) // levé PENDANT l'attente du geste
    expect(isRestoreDecisionPending()).toBe(false) // baissé au retour, même sur refus
  })

  it('modale qui LÈVE : le drapeau est quand même baissé (finally) et l\'erreur est portée', async () => {
    // Un drapeau laissé levé éconduirait TOUTE synchro MD pour toujours
    // ({ skipped: 'decision-pending' } en boucle) : le finally n'est pas une
    // politesse, c'est la condition de survie de la synchro après un bug d'UI.
    gardePasse()
    const confirmRestore = vi.fn().mockRejectedValue(new Error('modale démontée'))

    const res = await maybeRestoreAfterDesignation(t, { confirmRestore })

    expect(res).toEqual({ attempted: false, error: 'modale démontée' })
    expect(isRestoreDecisionPending()).toBe(false)
  })

  // Bonus sécurité du même lot : les écritures de réglages de la désignation
  // (label, welcomeDue, clearBackupDecision) arment le debounce de l'auto-backup.
  // Laissé libre, ce tir peut partir PENDANT que la modale attend — et sur un
  // dossier legacy sans sauvegarde.json il est destructeur (collision des ids du
  // semis avec ceux du dossier, renommage puis suppression par réconciliation).
  // On vérifie ici le WIRING : `suppressAutoBackup` enveloppe le corps qui
  // contient `confirmRestore` (appelé une fois, avec une fonction), et la fenêtre
  // de suppression est déjà ACTIVE pendant l'attente du geste — gardes comprises,
  // puisqu'elles sont dans le corps enveloppé.
  it("l'auto-backup est supprimé pendant toute la durée du helper (modale incluse, gardes comprises)", async () => {
    gardePasse()
    let suppressionActivePendantModale = null
    const confirmRestore = vi.fn(async () => {
      suppressionActivePendantModale = autoBackup.inside
      return false
    })

    const res = await maybeRestoreAfterDesignation(t, { confirmRestore })

    expect(res).toEqual({ attempted: false })
    expect(autoBackup.suppressAutoBackup).toHaveBeenCalledTimes(1)
    expect(typeof autoBackup.suppressAutoBackup.mock.calls[0][0]).toBe('function')
    expect(suppressionActivePendantModale).toBe(true) // confirmRestore s'exécute DANS la callback enveloppée
  })

  it('aucune UI de confirmation fournie : ne restaure pas (repli prudent, jamais destructeur)', async () => {
    gardePasse()

    const res = await maybeRestoreAfterDesignation(t)

    expect(restoreService.runRestore).not.toHaveBeenCalled()
    expect(res).toEqual({ attempted: false })
  })

  // Deux garanties DISTINCTES : l'erreur est toujours avalée
  // (l'appelant doit pouvoir conclure son flux — porte qui se ferme, Réglages
  // qui se rafraîchissent), ET elle est désormais PORTÉE dans le compte rendu
  // (`error`) — avant ce correctif, un `return false` la perdait en route : sur le
  // chemin du téléphone neuf, une E/S sur la garde passait inaperçue.
  it('erreur pendant la garde (ex. E/S SAF) : avalée (ne lève pas) mais PORTÉE en `error`', async () => {
    backupService.getBackupStorage.mockRejectedValue(new Error('boum'))
    const res = await maybeRestoreAfterDesignation(t)
    expect(res).toEqual({ attempted: false, error: 'boum' })
    expect(restoreService.runRestore).not.toHaveBeenCalled()
  })

  it("erreur de garde SANS message (rejet non-Error) : le compte rendu reste collable", async () => {
    // `e?.message || String(e)` : un rejet exotique (chaîne, objet natif) ne
    // doit pas produire `undefined` dans le rapport qu'affichera la modale.
    backupService.getBackupStorage.mockRejectedValue('panne sèche')
    const res = await maybeRestoreAfterDesignation(t)
    expect(res).toEqual({ attempted: false, error: 'panne sèche' })
  })

  it('isDbRestorable qui lève : même traitement que les autres erreurs de garde', async () => {
    backupService.getBackupStorage.mockResolvedValue({})
    restoreService.isDbRestorable.mockRejectedValue(new Error('base illisible'))
    const res = await maybeRestoreAfterDesignation(t)
    expect(res).toEqual({ attempted: false, error: 'base illisible' })
    expect(restoreService.runRestore).not.toHaveBeenCalled()
  })
})
