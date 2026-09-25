// @vitest-environment jsdom
// Intégration — LE test du lot : sur une base ne contenant que les exemples semés,
// une sauvegarde ne doit PAS toucher à l'arborescence du dossier (2026-08-04, §5.1 ;
// avenant 04/08/2026). Vrai orchestrateur, vraie base (fake-indexeddb), stockage en
// mémoire : c'est l'arborescence elle-même qu'on vérifie, pas un appel mocké.
//
// CONTRE-ÉPREUVE OBLIGATOIRE (§5.1) : retirer la ligne de garde de `runBackup`
// (backup-service.js) et relancer ce fichier — les deux premiers tests DOIVENT
// passer au rouge. Sans cette vérification, ce sont des assertions incapables
// d'échouer.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryBackupStorage } from '@/backup/memory-storage'
import { backupAll } from '@/backup/orchestrator'
import { recordSeededSamples } from '@/utils/seeded-samples'

const isNativePlatform = vi.hoisted(() => vi.fn(() => true))
// `registerPlugin` (correctif, 06/08/2026) : depuis peu, `backup-service`
// importe `backup-manifest`, qui importe `device-identity`, qui importe `saf-plugin` —
// lequel appelle `registerPlugin('RowtineSaf')` À L'ÉVALUATION du module. Sans cet
// export, ce fichier entier cessait de se charger (« 0 test », pas un échec d'assertion,
// donc invisible à qui ne lit que le décompte des tests rouges). Le stub renvoie un objet
// nu : `deviceName()` y échoue et retombe sur `null`, ce qui est son contrat déclaré.
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform },
  registerPlugin: () => ({}),
}))

const hasFolder = vi.hoisted(() => vi.fn(async () => true))
// `folderKey` (correctif 04/08/2026) : consommé par backup-decision.js,
// importé transitivement par isBackupPaused. Remplace `folderName` — le nom de la
// racine effective (folder-base.js, `decideBase`) ne discrimine rien : deux dossiers
// distincts peuvent porter le même nom — par un identifiant stable et discriminant.
// La VALEUR importe peu ici (ce n'est qu'un mock), seule compte sa STABILITÉ : c'est
// CE dossier-ci que les décisions posées dans ces tests doivent viser pour être
// reconnues.
const folderKey = vi.hoisted(() => vi.fn(async () => 'content://com.android.externalstorage.documents/tree/primary%3ARowtine'))
vi.mock('@/backup/saf-folder', () => ({
  hasFolder: (...a) => hasFolder(...a),
  folderKey: (...a) => folderKey(...a),
}))

// Le stockage « SAF » est en réalité notre MemoryBackupStorage : renvoyer un objet
// depuis un constructeur remplace l'instance construite (comportement standard JS).
const shared = vi.hoisted(() => ({ storage: null }))
vi.mock('@/backup/saf-storage', () => ({
  SafBackupStorage: class {
    constructor() {
      return shared.storage
    }
  },
}))

const { runBackup } = await import('@/backup/backup-service')
const { db, setSetting, getSetting } = await import('@/db/db')
const { recordBackupDecision, hasBackupDecision } = await import('@/backup/backup-decision')
// Fiche d'identité du dossier (lot du 06/08/2026) : le VRAI module, pas un simulacre —
// c'est tout l'intérêt de ce fichier. `writeManifest` est la primitive exacte que
// `runRestore` appelle pour s'approprier un dossier : s'en servir ici fait de
// la contre-épreuve une preuve par COMPOSITION du chemin réel, pas une reconstitution.
const { writeManifest, MANIFEST_PATH } = await import('@/backup/backup-manifest')

// Photographie de l'arborescence : chemins triés + taille de chaque fichier.
// Comparer cette photographie avant/après est ce qui rend le test incapable de
// « passer » sur un dossier à moitié détruit.
function treeSnapshot(storage) {
  return [...storage.entries.entries()]
    .map(([path, e]) => `${path}|${e.isDir ? 'dir' : (e.data || '').length}`)
    .sort()
}

// Écrit dans le dossier une VRAIE sauvegarde (1 ouvrage + 1 patron de bibliothèque),
// telle qu'elle existerait après des mois d'utilisation sur l'ancien téléphone.
async function writeRealBackup(storage) {
  await backupAll(storage, {
    projects: [
      { id: 101, name: 'Anders Cardigan', sections: [], counters: [], sessions: [], diagrams: [] },
    ],
    libraryPatterns: [{ id: 201, name: 'Écharpe Roni' }],
    yarns: [{ id: 301, name: 'Merino gris' }],
    purchases: [],
    independentCounters: [],
    settings: {},
    trashIds: { projects: [], patterns: [] },
    keepIds: { projects: [101], patterns: [201] },
  })
}

// Base « installation neuve » : 2 projets + 3 patrons semés, enregistrés comme tels.
async function seedFreshInstall() {
  const p1 = await db.projects.add({ name: 'Exemple châle', photos: [] })
  const p2 = await db.projects.add({ name: 'Exemple bonnet', photos: [] })
  const m1 = await db.patterns.add({ name: 'Exemple 1' })
  const m2 = await db.patterns.add({ name: 'Exemple 2' })
  const m3 = await db.patterns.add({ name: 'Exemple 3' })
  await recordSeededSamples({ patterns: [m1, m2, m3], projects: [p1, p2] })
}

beforeEach(async () => {
  vi.clearAllMocks()
  isNativePlatform.mockReturnValue(true)
  hasFolder.mockResolvedValue(true)
  folderKey.mockResolvedValue('content://com.android.externalstorage.documents/tree/primary%3ARowtine')
  shared.storage = new MemoryBackupStorage()
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('la sauvegarde automatique refuse de détruire une sauvegarde existante', () => {
  it("renvoie skipped:'restorable' sur une base ne contenant que les exemples semés", async () => {
    await writeRealBackup(shared.storage)
    await seedFreshInstall()

    const res = await runBackup()

    expect(res).toEqual({ ok: false, skipped: 'restorable' })
  })

  it("laisse l'arborescence du dossier RIGOUREUSEMENT intacte", async () => {
    await writeRealBackup(shared.storage)
    const before = treeSnapshot(shared.storage)
    await seedFreshInstall()

    await runBackup()

    expect(treeSnapshot(shared.storage)).toEqual(before)
    // Formulé aussi en clair : l'ouvrage de l'utilisatrice est toujours là.
    expect([...shared.storage.entries.keys()].some((p) => p.includes('[101]'))).toBe(true)
  })

  it("NE sauvegarde PLUS dès que l'utilisatrice a du travail réel : la garde ne s'éteint plus toute seule (avenant 04/08/2026)", async () => {
    await writeRealBackup(shared.storage)
    const before = treeSnapshot(shared.storage)
    await seedFreshInstall()
    // Une laine en stock : le semis n'en crée aucune, donc c'est du travail réel. Sous
    // la conception d'origine, ce geste seul rouvrait la sauvegarde ; l'avenant l'a
    // retiré — seule une DÉCISION explicite (« Restaurer » ou « Repartir de zéro »)
    // la rouvre désormais.
    await db.yarns.add({ name: 'Alpaga bleu' })

    const res = await runBackup()

    expect(res).toEqual({ ok: false, skipped: 'restorable' })
    expect(treeSnapshot(shared.storage)).toEqual(before)
  })

  it('sauvegarde normalement quand le dossier est encore vide (1re sauvegarde, installation neuve)', async () => {
    await seedFreshInstall()

    const res = await runBackup()

    expect(res).toEqual({ ok: true })
  })

  // LE TEST QUI MANQUAIT (CRITIQUE, prouvé en exécutant du code
  // par la re-revue). Avant ce correctif : la 1re sauvegarde sur un dossier
  // vide passait (rien à protéger), mais n'enregistrait AUCUNE décision — dès la
  // mutation suivante, `hasBackup()` devenait vrai et `isBackupPaused` refusait POUR
  // TOUJOURS, en silence (« pause définitive »). Fermer l'app n'y changeait rien
  // (`flushAutoBackup` passe par la même garde). C'est la séquence à DEUX appels,
  // pas le premier seul, qui doit être verte.
  it('LE TEST QUI MANQUAIT : dossier vide → la 1re sauvegarde réussit, ET LA 2e AUSSI (sinon : pause définitive en silence)', async () => {
    await seedFreshInstall()
    const [seededProjectId] = await db.projects.toCollection().primaryKeys()

    const first = await runBackup()
    expect(first).toEqual({ ok: true })

    const second = await runBackup()

    expect(second).toEqual({ ok: true })
    // L'arborescence porte bien les données de la base semée (pas juste des
    // dossiers vides) : au moins un dossier de projet, portant l'id du projet semé.
    expect([...shared.storage.entries.keys()].some((p) => p.includes(`[${seededProjectId}]`))).toBe(true)
  })

  it('une décision a bien été enregistrée après la 1re sauvegarde réussie sur un dossier vide', async () => {
    await seedFreshInstall()

    await runBackup()

    expect(await hasBackupDecision()).toBe(true)
  })

  it("aucune décision n'est enregistrée quand la sauvegarde est refusée par la garde (dossier déjà plein, aucune décision)", async () => {
    await writeRealBackup(shared.storage)
    await seedFreshInstall()

    const res = await runBackup()

    expect(res).toEqual({ ok: false, skipped: 'restorable' })
    expect(await hasBackupDecision()).toBe(false)
  })

  // Forme choisie pour « ne réenregistre pas de décision inutilement » (étape 1) :
  // sur un dossier déjà PLEIN, `hasBackup(storage)` est vrai AVANT
  // l'écriture — `runBackup` ne relit donc même pas `recordBackupDecision` (cf.
  // `folderWasEmpty` dans backup-service.js). Le réglage `backupDecision` reste donc
  // BYTE POUR BYTE identique (même horodatage `at`) après une nouvelle sauvegarde
  // réussie — preuve honnête qu'il n'a pas été réécrit, sans avoir à espionner un
  // appel interne au module.
  it('sur un dossier déjà plein avec décision existante, une sauvegarde réussie ne réenregistre pas la décision', async () => {
    await writeRealBackup(shared.storage)
    await seedFreshInstall()
    expect(await recordBackupDecision()).toBe(true)
    const before = await getSetting('backupDecision')

    const res = await runBackup()

    expect(res).toEqual({ ok: true })
    expect(await getSetting('backupDecision')).toEqual(before)
  })

  // LE TEST CENTRAL DE CETTE TÂCHE (avenant 04/08/2026, §A.6). `readerState` de sept
  // clés — la coquille EXACTE de `freshState()` (reconcile-reader-state.js) —
  // est ce qu'écrivent DEUX chemins sans qu'aucun rang n'ait été tricoté :
  // `ReaderView::selectSize` (toucher une taille sur le patron d'exemple) et
  // `syncPatronMd`/`reconcileReaderState` (tourne seul à chaque lancement, sans
  // invite). Sous la conception d'origine (`isDbRestorable`), ce geste anodin
  // éteignait la garde — c'est le mécanisme même du sinistre du 04/08. Avec la
  // décision, il ne doit PLUS jamais la réveiller.
  it("le geste anodin qui éteignait la garde (readerState de sept clés sur un projet semé) ne la réveille plus", async () => {
    await writeRealBackup(shared.storage)
    const before = treeSnapshot(shared.storage)
    await seedFreshInstall()
    const [seededProjectId] = await db.projects.toCollection().primaryKeys()
    await db.projects.update(seededProjectId, {
      readerState: {
        size: 1,
        done: {},
        counters: {},
        chartRows: {},
        chartReps: {},
        chartFrames: {},
        chartCurtains: {},
      },
    })

    const res = await runBackup()

    expect(res).toEqual({ ok: false, skipped: 'restorable' })
    expect(treeSnapshot(shared.storage)).toEqual(before)
  })

  it('après recordBackupDecision(), runBackup() aboutit', async () => {
    await writeRealBackup(shared.storage)
    await seedFreshInstall()
    expect(await recordBackupDecision()).toBe(true)

    const res = await runBackup()

    expect(res).toEqual({ ok: true })
  })

  it('une décision prise sur un autre dossier ne débloque pas', async () => {
    await writeRealBackup(shared.storage)
    const before = treeSnapshot(shared.storage)
    await seedFreshInstall()
    // Décision posée directement pour un dossier DIFFÉRENT de celui que `folderKey`
    // (mocké) renvoie pour ce test — jamais via `recordBackupDecision`, qui l'aurait
    // justement refusée pour le mauvais dossier.
    await setSetting('backupDecision', {
      folder: 'content://com.android.externalstorage.documents/tree/1234-5678%3ARowtine',
      at: new Date().toISOString(),
    })

    const res = await runBackup()

    expect(res).toEqual({ ok: false, skipped: 'restorable' })
    expect(treeSnapshot(shared.storage)).toEqual(before)
  })
})

// ─── LA GARDE QUI MANQUAIT AU LOT DU 06/08 (ajoutée sur constat de revue)
// ────────────────────────────────────────────────────────────────────────
//
// Tout ce lot existe pour empêcher un appareil d'écraser le travail d'un autre. Et
// pourtant, jusqu'ici, AUCUN test ne prouvait que la sauvegarde refuse RÉELLEMENT
// d'écrire quand une fiche étrangère est présente : le prédicat `backupPauseReason`
// est testé en isolation avec des simulacres (backup-pause-reason.spec.js), l'écran
// est testé à part (saf-folder-section.spec.js), et le chemin destructeur lui-même —
// celui qui a effacé 33 Mo le 04/08 — ne l'était nulle part de bout en bout.
//
// Ces deux tests exercent le VRAI prédicat, la VRAIE fiche et un stockage réel, comme
// tout ce fichier. Ils forment une PAIRE discriminante, et c'est la paire qui compte :
// le seul écart entre les deux est le nom porté par la fiche.
describe("un AUTRE appareil a écrit dans ce dossier (fiche d'identité, 06/08/2026)", () => {
  // Le dossier est rempli, la décision est PRISE (le test « après recordBackupDecision(),
  // runBackup() aboutit » ci-dessus prouve qu'en l'état la sauvegarde écrirait et que la
  // réconciliation effacerait l'ouvrage [101], absent de la base locale). Seule la fiche
  // change ici. Sans elle, ce test passerait pour la mauvaise raison — 'no-decision'.
  it("refuse d'écrire, et l'arborescence ne bouge pas d'un octet", async () => {
    await writeRealBackup(shared.storage)
    await seedFreshInstall()
    expect(await recordBackupDecision()).toBe(true)

    // L'ancien téléphone a sauvegardé dans ce même dossier : la fiche porte SON
    // identifiant, pas celui de cet appareil-ci.
    await shared.storage.writeFile(
      MANIFEST_PATH,
      JSON.stringify(
        {
          version: 1,
          ecritLe: '2026-08-06T07:14:22.000Z',
          appareil: 'ancien-telephone-huawei',
          modeleAppareil: 'LYA-L29',
          contenu: { projets: 12, patrons: 9, laines: 4 },
        },
        null,
        2,
      ),
      { encoding: 'utf8' },
    )
    const before = treeSnapshot(shared.storage)

    const res = await runBackup()

    expect(res).toEqual({ ok: false, skipped: 'restorable' })
    // ET SURTOUT : rien n'a été détruit. Le code de retour ne dit que « la fonction a
    // refusé » ; c'est la comparaison d'arborescence qui prouve l'absence de dégât — et
    // c'est la destruction, pas le refus, qui est le sinistre. Preuve par mutation faite :
    // en neutralisant la branche 'other-device' de `backupPauseReason`, les
    // DEUX assertions rougissent, la seconde parce que la réconciliation efface pour de
    // bon les dossiers de l'ouvrage absent de la base locale.
    expect(treeSnapshot(shared.storage)).toEqual(before)
    // Dit aussi en clair : l'ouvrage de l'autre appareil est toujours là.
    expect([...shared.storage.entries.keys()].some((p) => p.includes('[101]'))).toBe(true)
  })

  // LE PENDANT INDISPENSABLE — et la boucle est bouclée. Sans ce test, une
  // garde qui suspendrait sur TOUTE fiche (y compris la sienne) passerait le test
  // ci-dessus les yeux fermés, et la sauvegarde serait arrêtée pour tout le monde.
  // Ici on rejoue le geste exact que `runRestore` effectue après une restauration
  // réussie — `writeManifest(storage)`, la même fonction — sur un dossier qui portait
  // la fiche d'un AUTRE : la sauvegarde repart. C'est, par composition, la preuve que
  // restaurer sort bien de la pause au lieu de l'installer définitivement.
  it("s'approprier le dossier (writeManifest, ce que fait runRestore) le fait repartir", async () => {
    await writeRealBackup(shared.storage)
    await seedFreshInstall()
    expect(await recordBackupDecision()).toBe(true)
    await shared.storage.writeFile(
      MANIFEST_PATH,
      JSON.stringify({ version: 1, ecritLe: '2026-08-06T07:14:22.000Z', appareil: 'ancien-telephone-huawei' }),
      { encoding: 'utf8' },
    )

    // Le geste d'appropriation, à l'identique de `runRestore`.
    expect(await writeManifest(shared.storage)).toBe(true)

    const res = await runBackup()

    expect(res).toEqual({ ok: true })
  })
})

describe('la sortie de secours', () => {
  it('overwriteBackup:true franchit la garde et écrit', async () => {
    await writeRealBackup(shared.storage)
    await seedFreshInstall()

    const res = await runBackup({ overwriteBackup: true })

    expect(res).toEqual({ ok: true })
    // La réconciliation a fait son travail : l'ouvrage absent de la base a disparu.
    expect([...shared.storage.entries.keys()].some((p) => p.includes('[101]'))).toBe(false)
  })

  it("force:true (bouton « Synchroniser maintenant ») ne franchit PAS la garde", async () => {
    await writeRealBackup(shared.storage)
    const before = treeSnapshot(shared.storage)
    await seedFreshInstall()

    const res = await runBackup({ force: true })

    expect(res).toEqual({ ok: false, skipped: 'restorable' })
    expect(treeSnapshot(shared.storage)).toEqual(before)
  })
})
