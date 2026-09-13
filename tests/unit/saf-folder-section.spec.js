import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import fr from '@/i18n/fr.json'

// vi.hoisted : le factory de vi.mock est hoisté au-dessus des déclarations
// top-level (TDZ Vitest v4) — cf. tests/unit/saf-folder.spec.js.
const api = vi.hoisted(() => ({
  hasFolder: vi.fn(),
  folderName: vi.fn(),
  folderKey: vi.fn(),
}))
vi.mock('@/backup/saf-folder', () => api)

// Garde native (revue finale, finding 2) : le composant n'appelle le plugin que
// sur plateforme native (cf. src/components/settings/SafFolderSection.vue) —
// on force `isNativePlatform() → true` pour exercer les scénarios désigné/non
// désigné comme sur device, cf. tests/unit/onboarding-folder-prompt.spec.js.
const { isNativePlatform } = vi.hoisted(() => ({ isNativePlatform: vi.fn(() => true) }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform } }))

// `getSetting` n'alimente plus la ligne d'état (« Copie à jour, faite le… »
// retirée le 06/09/2026, retour d'usage — la clé `lastBackupAt` n'est plus
// lue) mais reste dans le mock : `folderDisplayPath()` (saf-folder-label.js,
// volontairement NON mocké) lit `safFolderLabel`, et `db` sert aux décomptes de
// la ligne `side-device` — `loadState()` interroge directement
// `db.projects.count()`/`db.patterns.filter(...).count()`/`db.yarns.count()`
// pour afficher les VRAIS décomptes de l'appareil.
const dbApi = vi.hoisted(() => ({
  getSetting: vi.fn(),
  db: {
    projects: { count: vi.fn() },
    patterns: { filter: vi.fn() },
    yarns: { count: vi.fn() },
  },
}))
vi.mock('@/db/db', () => dbApi)

// `runBackup` : bouton « Synchroniser maintenant » (secours, force un cycle
// immédiat). `getBackupStorage` est appelé DIRECTEMENT par `loadState()` (diagnostic
// 04/08/2026, cf. src/components/settings/SafFolderSection.vue) ET TRANSITIVEMENT
// par `maybeRestoreAfterDesignation` (restore-on-designate.js) —
// mocker ce module évite aussi de charger le vrai backup-service.js (qui appelle
// le plugin natif SAF via Capacitor).
const backupService = vi.hoisted(() => ({ runBackup: vi.fn(), getBackupStorage: vi.fn() }))
vi.mock('@/backup/backup-service', () => backupService)

// Chaîne de garde de restauration sur désignation (partagée via
// restore-on-designate.js) : mockée à son propre niveau de dépendances (pas le
// helper lui-même) pour exercer le VRAI comportement de garde (empty && hasBackup)
// à travers ce point d'appel, cf. tests/unit/onboarding-folder-prompt.spec.js
// pour le même style sur l'autre point d'appel.
const restoreApi = vi.hoisted(() => ({ hasBackup: vi.fn() }))
vi.mock('@/backup/restore', () => restoreApi)
const restoreService = vi.hoisted(() => ({
  runRestore: vi.fn(),
  shouldRestoreFromFolder: vi.fn(),
  isDbRestorable: vi.fn(),
}))
vi.mock('@/backup/restore-service', () => restoreService)

// Décision (avenant 04/08/2026) : `onChooseFolder` (efface) et `startFresh`
// (enregistre) appellent désormais ce module. Mocké à son propre niveau — pas
// question de faire tourner le vrai backup-decision.js ici, il exigerait un
// `setSetting`/`getSetting` réels que `dbApi` (mock ci-dessus) n'expose pas, et
// ce fichier teste le câblage du COMPOSANT, pas le module de décision
// lui-même (déjà couvert par tests/unit/backup-decision.spec.js).
const backupDecision = vi.hoisted(() => ({
  recordBackupDecision: vi.fn(),
  clearBackupDecision: vi.fn(),
  hasBackupDecision: vi.fn(),
}))
vi.mock('@/backup/backup-decision', () => backupDecision)

// Prédicat UNIQUE de pause (06/08/2026). Cet écran ne recalcule plus le
// critère : il lit `backupPauseReason(storage)` et n'en dessine que la conséquence — la
// ligne « en pause » et le bouton « Repartir de zéro », qui doivent apparaître et
// disparaître ENSEMBLE, et exactement quand la sauvegarde cesse d'écrire. Mocké à ce
// niveau comme `backup-decision` juste au-dessus : ce fichier teste le CÂBLAGE du
// composant, le prédicat lui-même est couvert par tests/unit/backup-pause-reason.spec.js.
const backupPauseReason = vi.hoisted(() => vi.fn(async () => null))
vi.mock('@/backup/backup-pause', () => ({ backupPauseReason: (...a) => backupPauseReason(...a) }))

// Fiche d'identité de la sauvegarde (06/08/2026). Le composant n'importe
// PAS ces deux modules : il passe par `describeOrigin` (backup-origin.js), qu'on laisse
// tourner pour de vrai — c'est ce module partagé, et lui seul, qui doit conclure la même
// chose que le bandeau de décision. On mocke donc à SES dépendances, un cran plus bas,
// comme pour `backup-decision` ci-dessus. Bonus : `device-identity` importe le plugin
// natif SAF, qu'on ne veut pas charger ici.
const manifestApi = vi.hoisted(() => ({ readManifest: vi.fn() }))
vi.mock('@/backup/backup-manifest', () => manifestApi)
const identityApi = vi.hoisted(() => ({ deviceId: vi.fn(), deviceName: vi.fn() }))
vi.mock('@/backup/device-identity', () => identityApi)

// Snackbar (correctif revue) : `syncNow` doit donner un retour
// visible sur succès ET échec — cf. src/stores/snackbar.js pour la vraie
// implémentation ; ici on vérifie juste que `show` est appelé.
const snackbarApi = vi.hoisted(() => ({ show: vi.fn() }))
vi.mock('@/stores/snackbar', () => ({ useSnackbarStore: () => snackbarApi }))

import SafFolderSection from '@/components/settings/SafFolderSection.vue'
import { useFolderChangeStore } from '@/stores/folder-change'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })
const mountIt = () => mount(SafFolderSection, { global: { plugins: [i18n] } })

// Le composant branche le pont `folder-change` (bouton « Changer de
// dossier » + rechargement à la fermeture de la porte). Un Pinia ACTIF suffit : la
// majorité des montages de ce fichier passent par `{ plugins: [i18n] }` sans Pinia,
// et `useFolderChangeStore()` résout alors le Pinia actif — recréé à chaque test pour
// que l'état du pont (demande, compteur de fermetures) soit neuf.
beforeEach(() => {
  setActivePinia(createPinia())
})

// Ce que vue-i18n produirait VRAIMENT si la ligne « Le dossier — … » était rendue à
// partir d'une fiche aux décomptes incomplets. MESURÉ, pas supposé : un paramètre absent
// devient la chaîne VIDE, jamais une accolade visible —
// `t('saf.sideCounts', { projets: 6 })` donne « 6 projets,  patrons,  laines ». Chercher
// `{projets}` à l'écran est donc une assertion qui ne peut pas échouer ; c'est ce
// blanc-là qu'il faut interdire, et on le construit avec le MÊME moteur que le composant
// pour qu'il ne puisse pas dériver.
//
// ⚠️ À COMPARER CONTRE `w.element.textContent`, JAMAIS `w.html()` : `html()` passe par un
// embellisseur qui RÉINSÈRE des retours à la ligne dans les nœuds de texte longs. Mesuré
// ici même — sur quatre cas amputés, la contre-épreuve n'en faisait rougir qu'UN seul
// avec `html()`, et les quatre avec `textContent`. Trois assertions étaient mortes sans
// que rien ne le dise.
const brokenCounts = (contenu) => i18n.global.t('saf.sideCounts', contenu)

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset())
  isNativePlatform.mockReset().mockReturnValue(true)
  dbApi.getSetting.mockReset().mockResolvedValue(null)
  dbApi.db.projects.count.mockReset().mockResolvedValue(0)
  dbApi.db.yarns.count.mockReset().mockResolvedValue(0)
  dbApi.db.patterns.filter.mockReset().mockReturnValue({ count: vi.fn().mockResolvedValue(0) })
  backupService.runBackup.mockReset().mockResolvedValue({ ok: true })
  backupService.getBackupStorage.mockReset().mockResolvedValue(null) // pas de restauration par défaut
  restoreApi.hasBackup.mockReset().mockResolvedValue(false)
  restoreService.runRestore.mockReset().mockResolvedValue({ ok: true })
  restoreService.isDbRestorable.mockReset().mockResolvedValue(false)
  restoreService.shouldRestoreFromFolder.mockReset().mockImplementation(({ empty, hasBackup }) => !!empty && !!hasBackup)
  backupDecision.recordBackupDecision.mockReset().mockResolvedValue(true)
  backupDecision.clearBackupDecision.mockReset().mockResolvedValue(undefined)
  // Repli par défaut : aucune décision prise — c'est le cas le plus fréquent dans
  // ces tests (dossier tout juste désigné, ou base encore vierge).
  backupDecision.hasBackupDecision.mockReset().mockResolvedValue(false)
  // Même défaut, exprimé du côté du prédicat unique (lot du 06/08) : « aucune décision »
  // EST une raison de pause. Le composant ne lit plus que celle-ci — sans ce défaut
  // accordé au précédent, tous les tests qui pressent « Repartir de zéro » ne
  // trouveraient plus le bouton à l'écran.
  backupPauseReason.mockReset().mockResolvedValue('no-decision')
  // Défaut de la fiche d'identité : « absente » — l'état de toutes les sauvegardes
  // écrites AVANT ce lot, et donc le cas de très loin le plus fréquent. Sans défaut
  // explicite, `readManifest` renverrait `undefined`, `describeOrigin` lèverait, et son
  // propre `try/catch` avalerait l'erreur en `unknown` : les tests passeraient par
  // accident, exactement la forme de test creux que ce lot cherche à éviter.
  manifestApi.readManifest.mockReset().mockResolvedValue({ state: 'absent' })
  identityApi.deviceId.mockReset().mockResolvedValue('moi')
  identityApi.deviceName.mockReset().mockResolvedValue(null)
  // `mockReset()` (pas seulement `mockReturnValue`) : `vi.spyOn` réutilise le
  // même espion d'un test à l'autre (jamais restauré) — sans le vider ici,
  // l'historique d'appels de `window.confirm` fuit entre tests (constaté :
  // un appel de `maybeRestoreAfterDesignation` dans un test antérieur restait
  // visible dans le test suivant qui vérifie « jamais appelé »).
  vi.spyOn(window, 'confirm').mockReset().mockReturnValue(true)
  snackbarApi.show.mockReset()
})

describe('SafFolderSection', () => {
  // Message PERSISTANT et ACTIONNABLE (pas juste informatif)
  // quand aucun dossier n'est désigné — remplace l'ancien "saf.none" muet.
  it('sans dossier : avertissement persistant "pas sauvegardés"', async () => {
    api.hasFolder.mockResolvedValue(false)
    api.folderName.mockResolvedValue(null)
    const w = mountIt()
    await flushPromises()
    expect(w.text()).toMatch(/aucun dossier/i)
    expect(w.text()).toMatch(/pas sauvegardés/i)
  })

  it('hors plateforme native (web/dev) : ne touche pas le plugin au montage', async () => {
    isNativePlatform.mockReturnValue(false)
    const w = mountIt()
    await flushPromises()
    expect(api.hasFolder).not.toHaveBeenCalled()
    expect(api.folderName).not.toHaveBeenCalled()
    // Repli par défaut (`designated` reste `false`) sans erreur : l'avertissement
    // persistant reste la bonne ligne à attendre — la question de désignation, elle,
    // n'a plus lieu ici depuis le 09/08/2026 (la porte s'en charge).
    expect(w.text()).toContain(fr.saf.noFolderWarning)
  })

  // --- État de synchro ---

  // 06/09/2026, retour d'usage : la ligne d'état (« Copie à jour, faite le… » /
  // « Aucune copie pour l'instant. ») est RETIRÉE de l'écran — l'horodatage machine
  // ne dit rien à une tricoteuse, et le haut des Réglages dit déjà « sauvegardé
  // automatiquement ». Les deux tests ci-dessous garantissent qu'elle ne revient
  // dans AUCUN des deux états qu'elle couvrait (jamais sauvegardé / déjà
  // sauvegardé) ; seule la ligne de pause (bloc [4]) parle encore de synchro.
  it('avec dossier + jamais sauvegardé : AUCUNE ligne d\'état', async () => {
    api.hasFolder.mockResolvedValue(true)
    api.folderName.mockResolvedValue('MesPatrons')
    backupPauseReason.mockResolvedValue(null)
    const w = mountIt()
    await flushPromises()
    expect(w.text()).not.toMatch(/aucune copie/i)
    expect(w.text()).not.toMatch(/copie à jour/i)
  })

  it('avec dossier + déjà sauvegardé : AUCUNE ligne d\'état (plus de « copie à jour »)', async () => {
    api.hasFolder.mockResolvedValue(true)
    api.folderName.mockResolvedValue('MesPatrons')
    backupPauseReason.mockResolvedValue(null)
    const w = mountIt()
    await flushPromises()
    expect(w.text()).not.toMatch(/copie à jour/i)
    expect(w.text()).not.toMatch(/aucune copie/i)
  })

  // --- Le diagnostic ne sort que s'il sert (07/08/2026) ---
  //
  // Déclencheur : « à quoi ça sert de sauvegarder sur un appareil sans avoir
  // changé d'appareil ? » — le diagnostic (origine, comparaison des deux
  // côtés, conseil, lignes diag-*) s'affichait EN PERMANENCE, même quand tout
  // va bien. Ce bloc est le garde-fou : il doit rougir si UNE SEULE des
  // lignes listées reparaît dans le cas nominal.
  describe('cas nominal : rien à décider', () => {
    it('l’écran ne montre AUCUN diagnostic', async () => {
      // dossier désigné, sauvegarde présente, fiche de CET appareil, pause = null
      api.hasFolder.mockResolvedValue(true)
      api.folderName.mockResolvedValue('Rowtine')
      backupService.getBackupStorage.mockResolvedValue({})
      restoreApi.hasBackup.mockResolvedValue(true)
      restoreService.isDbRestorable.mockResolvedValue(true)
      backupPauseReason.mockResolvedValue(null) // rien à décider
      manifestApi.readManifest.mockResolvedValue({
        state: 'ok',
        manifest: {
          appareil: 'moi',
          ecritLe: '2026-08-06T05:15:18.402Z',
          contenu: { projets: 6, patrons: 9, laines: 31 },
        },
      })

      const w = mountIt()
      await flushPromises()
      const t = w.element.textContent // ⚠️ JAMAIS w.html() (retours à la ligne réinsérés)
      expect(t).toContain('vit dans cette app') // la raison d'être (saf.purpose)
      expect(t).not.toContain('Copie à jour') // la ligne d'état est retirée (06/09/2026)
      for (const sel of [
        'origin',
        'side-folder',
        'side-device',
        'advice',
        'backup-paused',
        'other-device-blocked',
        'diag-backup',
        'diag-db',
      ]) {
        expect(w.find(`[data-test="${sel}"]`).exists(), sel).toBe(false)
      }
    })

    // Contre-épreuve du test ci-dessus : dès qu'il y a une décision à
    // prendre (`pauseReason !== null`), le bloc revient — même état sinon.
    it('dès que pauseReason vaut \'no-decision\', le bloc de décision revient', async () => {
      api.hasFolder.mockResolvedValue(true)
      api.folderName.mockResolvedValue('Rowtine')
      backupService.getBackupStorage.mockResolvedValue({})
      restoreApi.hasBackup.mockResolvedValue(true)
      restoreService.isDbRestorable.mockResolvedValue(true)
      backupPauseReason.mockResolvedValue('no-decision')
      manifestApi.readManifest.mockResolvedValue({
        state: 'ok',
        manifest: {
          appareil: 'moi',
          ecritLe: '2026-08-06T05:15:18.402Z',
          contenu: { projets: 6, patrons: 9, laines: 31 },
        },
      })

      const w = mountIt()
      await flushPromises()
      for (const sel of ['origin', 'side-folder', 'side-device', 'advice', 'backup-paused', 'diag-backup', 'diag-db']) {
        expect(w.find(`[data-test="${sel}"]`).exists(), sel).toBe(true)
      }
      expect(w.find('[data-test="other-device-blocked"]').exists()).toBe(false)
    })

    // En pause, la ligne de pause doit être SEULE à parler de synchro : depuis le
    // 06/09/2026 (retour d'usage) la ligne « Copie à jour… » n'existe plus du
    // tout, mais ce test garde valeur de garde-fou — si quelqu'un la réintroduit
    // sans la garde anti-pause, l'ancienne contradiction (« tout va bien » PUIS
    // « en pause ») reviendrait ici, celle qui rassure venant en premier. Le
    // libellé du 31/08/2026 tient toujours : « sauvegarde » n'a pas sa place dans
    // le flux de décision — la ligne de pause parle des DONNÉES du dossier.
    it('en pause : la ligne de pause reste, et aucune ligne « Copie à jour »', async () => {
      api.hasFolder.mockResolvedValue(true)
      api.folderName.mockResolvedValue('Rowtine')
      backupService.getBackupStorage.mockResolvedValue({})
      restoreApi.hasBackup.mockResolvedValue(true)
      restoreService.isDbRestorable.mockResolvedValue(true)
      backupPauseReason.mockResolvedValue('no-decision') // ET en pause
      manifestApi.readManifest.mockResolvedValue({
        state: 'ok',
        manifest: {
          appareil: 'moi',
          ecritLe: '2026-08-06T05:15:18.402Z',
          contenu: { projets: 6, patrons: 9, laines: 31 },
        },
      })

      const w = mountIt()
      await flushPromises()
      const t = w.element.textContent // ⚠️ JAMAIS w.html() (retours à la ligne réinsérés)
      expect(t).not.toContain('Copie à jour') // la ligne rassurante a disparu
      // Libellé du 31/08/2026 : « sauvegarde » n'a plus sa place dans le flux de
      // décision — la ligne de pause parle des DONNÉES du dossier.
      expect(t).toContain('En pause — ce dossier contient des données') // la ligne de pause a pris sa place
      expect(w.find('[data-test="backup-paused"]').exists()).toBe(true)
    })

    it('dès que pauseReason vaut \'other-device\', le bloc de décision revient (autre raison)', async () => {
      api.hasFolder.mockResolvedValue(true)
      api.folderName.mockResolvedValue('Rowtine')
      backupService.getBackupStorage.mockResolvedValue({})
      restoreApi.hasBackup.mockResolvedValue(true)
      restoreService.isDbRestorable.mockResolvedValue(true)
      backupPauseReason.mockResolvedValue('other-device')
      manifestApi.readManifest.mockResolvedValue({
        state: 'ok',
        manifest: {
          appareil: 'moi',
          ecritLe: '2026-08-06T05:15:18.402Z',
          contenu: { projets: 6, patrons: 9, laines: 31 },
        },
      })

      const w = mountIt()
      await flushPromises()
      expect(w.find('[data-test="other-device-blocked"]').exists()).toBe(true)
      expect(w.find('[data-test="backup-paused"]').exists()).toBe(false)
      // La ligne « Copie à jour » n'existe plus (06/09/2026) — cette assertion
      // l'interdit aussi dans le cas `other-device`, où sa date aurait de toute
      // façon été celle d'un autre appareil. La contre-épreuve du describe
      // précédent ne couvrait que `no-decision` ; ce cas est la seconde branche.
      expect(w.element.textContent).not.toContain('Copie à jour')
      for (const sel of ['origin', 'side-folder', 'side-device', 'advice', 'diag-backup', 'diag-db']) {
        expect(w.find(`[data-test="${sel}"]`).exists(), sel).toBe(true)
      }
    })

    // Correctif de revue (constat 3, tranché par l'humain) : le garde-fou ci-dessus est
    // une LISTE NOIRE de `data-test` — une future ligne « utile » portant un nom
    // INÉDIT (ou aucun `data-test` du tout) la traverserait sans la faire rougir. Le §7
    // de la spec (lignes 197-199) demande explicitement « un test qui compte les lignes
    // affichées quand tout va bien ». Ici, DEUX bornes indépendantes : le nombre total
    // de lignes (`<p>`/`<button>`) de la section, taguées ou non, et l'ensemble EXACT
    // des `data-test` qui y figurent — une liste blanche, pas une liste noire.
    //
    // Adapté (09/08/2026) : trois des quatre boutons sont partis, la ligne du dossier
    // porte désormais `data-test="folder-path"` — les bornes suivent.
    it('cas nominal : SEULE une liste blanche de lignes est rendue', async () => {
      api.hasFolder.mockResolvedValue(true)
      api.folderName.mockResolvedValue('Rowtine')
      backupService.getBackupStorage.mockResolvedValue({})
      restoreApi.hasBackup.mockResolvedValue(true)
      restoreService.isDbRestorable.mockResolvedValue(true)
      backupPauseReason.mockResolvedValue(null)
      manifestApi.readManifest.mockResolvedValue({
        state: 'ok',
        manifest: {
          appareil: 'moi',
          ecritLe: '2026-08-06T05:15:18.402Z',
          contenu: { projets: 6, patrons: 9, laines: 31 },
        },
      })

      const w = mountIt()
      await flushPromises()

      // Borne 1 : le NOMBRE de lignes de la section (paragraphes + boutons), tagués ou
      // non — le dossier, purpose, explain, et le bouton « Changer de dossier »
      // (plateforme native ⇒ rendu ici ; la ligne d'état « Copie à
      // jour » est retirée depuis le 06/09/2026). Toute ligne ajoutée, quel que
      // soit son `data-test` (ou l'absence d'un), fait varier ce nombre.
      expect(w.findAll('p, button').length).toBe(4)

      // Borne 2 : l'ensemble EXACT des `data-test` présents — une ligne renommée, ou
      // ajoutée avec un nom inédit, fait rougir celle-ci indépendamment de la borne 1.
      const inOrder = [...w.element.querySelectorAll('[data-test]')].map((el) => el.dataset.test)
      const tagged = [...inOrder].sort()
      expect(tagged).toEqual(['explain', 'folder-path', 'purpose', 'change-folder'].sort())

      // Borne 3 : l'ORDRE, pas seulement l'ensemble — le dossier en PREMIER (item [1] de
      // la structure visée), la note technique en DERNIER. Sans cette borne, les lignes
      // taguées pourraient migrer n'importe où dans la section sans faire rougir quoi
      // que ce soit.
      expect(inOrder[0]).toBe('folder-path')
      expect(inOrder[inOrder.length - 1]).toBe('explain')
    })
  })

  // --- Les lignes d'aide sous chaque bouton (07/08/2026) ---
  // Adapté (09/08/2026) : trois des quatre boutons sont partis (et leurs lignes
  // d'aide avec eux) — seul « Repartir de zéro » reste couvert ici.
  describe('ligne d’aide sous le bouton', () => {
    beforeEach(() => {
      api.hasFolder.mockResolvedValue(true)
      api.folderName.mockResolvedValue('Rowtine')
    })

    it('« Remplacer » (Repartir de zéro) : pas de bouton, pas de ligne d’aide, quand rien n’est en pause', async () => {
      backupPauseReason.mockResolvedValue(null)
      const w = mountIt()
      await flushPromises()
      expect(w.find('[data-test="start-fresh"]').exists()).toBe(false)
      expect(w.find('[data-test="hint-start-fresh"]').exists()).toBe(false)
    })

    it('« Remplacer » (Repartir de zéro) : ligne d’aide affichée avec le bouton, en pause', async () => {
      backupPauseReason.mockResolvedValue('no-decision')
      const w = mountIt()
      await flushPromises()
      expect(w.find('[data-test="start-fresh"]').exists()).toBe(true)
      expect(w.find('[data-test="hint-start-fresh"]').element.textContent).toBe(fr.saf.hintStartFresh)
    })

    // La consigne exige « immédiatement après » son bouton, pas seulement présente
    // quelque part sur l'écran. C'est la POSITION relative qui est exigée ici,
    // contre-épreuve incluse (déplacer la ligne d'aide la fait rougir).
    it('la ligne d’aide suit IMMÉDIATEMENT son bouton dans le DOM', async () => {
      backupPauseReason.mockResolvedValue('no-decision') // fait apparaître start-fresh
      const w = mountIt()
      await flushPromises()
      const order = [...w.element.querySelectorAll('[data-test]')].map((el) => el.dataset.test)
      expect(order.indexOf('hint-start-fresh')).toBe(order.indexOf('start-fresh') + 1)
    })
  })

  // --- Diagnostic « pourquoi » ---
  //
  // Contexte : sur l'appareil d'une utilisatrice réelle, la restauration a
  // échoué trois fois de suite sans qu'on puisse dire pourquoi — l'app ne
  // proposait simplement rien. Ces trois lignes remplacent le silence par une
  // explication lisible. Les 4 croisements (sauvegarde oui/non × base
  // restaurable oui/non) doivent tous produire le bon texte, indépendamment
  // l'un de l'autre.
  describe('diagnostic de restauration', () => {
    beforeEach(() => {
      api.hasFolder.mockResolvedValue(true)
      api.folderName.mockResolvedValue('MesPatrons')
    })

    it('sauvegarde trouvée + base restaurable : les deux lignes rassurent', async () => {
      backupService.getBackupStorage.mockResolvedValue({})
      restoreApi.hasBackup.mockResolvedValue(true)
      restoreService.isDbRestorable.mockResolvedValue(true)
      const w = mountIt()
      await flushPromises()
      expect(w.find('[data-test="diag-backup"]').text()).toMatch(/sauvegarde a été trouvée/i)
      expect(w.find('[data-test="diag-db"]').text()).toMatch(/prêt à recevoir/i)
      expect(w.find('[data-test="diag-db"]').classes()).not.toContain('warning')
    })

    // Correctif de revue (constat 1) : `diag-db` ne porte que la branche restaurable —
    // quand la base n'est pas restaurable, il n'existe plus du tout.
    it('sauvegarde trouvée + base NON restaurable : diag-db disparaît', async () => {
      backupService.getBackupStorage.mockResolvedValue({})
      restoreApi.hasBackup.mockResolvedValue(true)
      restoreService.isDbRestorable.mockResolvedValue(false)
      const w = mountIt()
      await flushPromises()
      expect(w.find('[data-test="diag-backup"]').text()).toMatch(/sauvegarde a été trouvée/i)
      expect(w.find('[data-test="diag-db"]').exists()).toBe(false)
    })

    it('pas de sauvegarde + base restaurable : signale l\'absence de sauvegarde', async () => {
      backupService.getBackupStorage.mockResolvedValue({})
      restoreApi.hasBackup.mockResolvedValue(false)
      restoreService.isDbRestorable.mockResolvedValue(true)
      const w = mountIt()
      await flushPromises()
      expect(w.find('[data-test="diag-backup"]').text()).toMatch(/aucune sauvegarde/i)
      expect(w.find('[data-test="diag-db"]').text()).toMatch(/prêt à recevoir/i)
    })

    // Correctif de revue (constat 1), même raison que ci-dessus : sans sauvegarde, le
    // bouton « Restaurer » ne s'affiche même pas (`backupFound` faux) — il n'y a donc
    // plus aucune ligne pour porter l'ancien message `diagDbNotEmpty`, nulle part.
    it('pas de sauvegarde + base NON restaurable : diag-backup alerte seul, diag-db a disparu', async () => {
      // `getBackupStorage` renvoie null (aucun stockage natif résolu) : le
      // composant doit le tolérer sans planter (cf. `storage ? ... : false`).
      backupService.getBackupStorage.mockResolvedValue(null)
      restoreApi.hasBackup.mockResolvedValue(false)
      restoreService.isDbRestorable.mockResolvedValue(false)
      const w = mountIt()
      await flushPromises()
      expect(w.find('[data-test="diag-backup"]').text()).toMatch(/aucune sauvegarde/i)
      expect(w.find('[data-test="diag-db"]').exists()).toBe(false)
    })

    // MIGRÉ (07/08) de `diag-contents`, retirée au profit de la paire « Le dossier /
    // Cet appareil ». Ce test est la SEULE couverture attestant que les trois décomptes
    // du côté appareil sont de vrais nombres tirés de la base — et que la correspondance
    // `p→projets`, `m→patrons`, `l→laines` est la bonne, ce que trois valeurs DISTINCTES
    // sont seules à prouver. Il reste ici, dans le bloc « diagnostic », parce qu'il
    // exerce un contexte que le bloc « d'où vient la sauvegarde » n'a pas : aucun
    // stockage résolu (`getBackupStorage → null`). Le côté appareil ne dépend pas du
    // dossier et doit s'afficher quand même.
    it('affiche les vrais décomptes de l\'appareil', async () => {
      backupService.getBackupStorage.mockResolvedValue(null)
      dbApi.db.projects.count.mockResolvedValue(3)
      dbApi.db.patterns.filter.mockReturnValue({ count: vi.fn().mockResolvedValue(5) })
      dbApi.db.yarns.count.mockResolvedValue(7)
      const w = mountIt()
      await flushPromises()
      const text = w.find('[data-test="side-device"]').text()
      expect(text).toContain(fr.saf.sideDevice)
      expect(text).toContain('3 projets')
      expect(text).toContain('5 patrons')
      expect(text).toContain('7 laines')
    })

    // Correctif (auto-revue) : `hasBackup` interroge le plugin natif SAF sans
    // filet (cf. commentaire dans SafFolderSection.vue) — un rejet ne doit ni
    // planter le montage, ni laisser affichés le nom du dossier/la date sans les
    // lignes de diagnostic ; le repli reste prudent (fail-closed).
    it('le plugin natif rejette (erreur SAF) : replis prudents, pas de plantage', async () => {
      backupService.getBackupStorage.mockResolvedValue({})
      restoreApi.hasBackup.mockRejectedValue(new Error('erreur SAF simulée'))
      const w = mountIt()
      await flushPromises()
      expect(w.find('[data-test="diag-backup"]').text()).toMatch(/aucune sauvegarde/i)
      // Repli fail-closed : `dbRestorable` reste `false` — `diag-db` (constat 1, ne
      // porte plus que la branche restaurable) n'existe donc plus.
      expect(w.find('[data-test="diag-db"]').exists()).toBe(false)
      // Le reste de l'état (déjà chargé avant le rejet) reste affiché normalement.
      expect(w.text()).toContain('Dossier : MesPatrons')
    })

    // Étape 2 (avenant 04/08/2026, revue finale) : `hasBackup` qui lève ne doit PAS
    // masquer le cul-de-sac — la ligne « en pause » et le bouton « Repartir de zéro »
    // doivent rester visibles (on ignore l'état réel, mais afficher la ligne est sans
    // danger, alors que la cacher pourrait enfermer l'utilisatrice sans recours).
    it("le plugin natif rejette : la ligne « en pause » ET le bouton « Repartir de zéro » restent visibles (pas de cul-de-sac invisible)", async () => {
      backupService.getBackupStorage.mockResolvedValue({})
      restoreApi.hasBackup.mockRejectedValue(new Error('erreur SAF simulée'))
      const w = mount(SafFolderSection, { global: { plugins: [i18n] } })
      await flushPromises()
      expect(w.find('[data-test="backup-paused"]').exists()).toBe(true)
      expect(w.find('[data-test="start-fresh"]').exists()).toBe(true)
    })

    it('vérifie le prédicat passé à `db.patterns.filter` (pas de comptage silencieusement faux)', async () => {
      backupService.getBackupStorage.mockResolvedValue(null)
      mountIt()
      await flushPromises()
      const predicate = dbApi.db.patterns.filter.mock.calls.at(-1)[0]
      // Un patron libre (builtin) ne compte pas comme un patron de bibliothèque.
      expect(predicate({ builtin: true, ownerProjectId: null })).toBe(false)
      // Une instance de patron forkée dans un projet ne compte pas non plus.
      expect(predicate({ builtin: false, ownerProjectId: 3 })).toBe(false)
      // Un vrai patron de bibliothèque compte.
      expect(predicate({ builtin: false, ownerProjectId: null })).toBe(true)
    })

    it('sans dossier désigné : aucune des trois lignes de diagnostic ne s\'affiche', async () => {
      api.hasFolder.mockResolvedValue(false)
      api.folderName.mockResolvedValue(null)
      const w = mountIt()
      await flushPromises()
      expect(w.find('[data-test="diag-backup"]').exists()).toBe(false)
      expect(w.find('[data-test="diag-db"]').exists()).toBe(false)
      // Troisième ligne : `side-device` depuis le 07/08, `diag-contents` avant elle.
      expect(w.find('[data-test="side-device"]').exists()).toBe(false)
    })
  })

  // Garde anti-écrasement vue du côté des Réglages (spec 2026-08-04, §3.5).
  describe('sauvegarde en pause', () => {
    it("affiche la ligne « en pause » quand le dossier contient une sauvegarde et qu'aucune décision n'a été prise", async () => {
      api.hasFolder.mockResolvedValue(true)
      api.folderName.mockResolvedValue('Rowtine')
      dbApi.getSetting.mockResolvedValue(null)
      const storage = { marker: 'stockage factice' }
      backupService.getBackupStorage.mockResolvedValue(storage)
      restoreApi.hasBackup.mockResolvedValue(true)
      restoreService.isDbRestorable.mockResolvedValue(true)
      backupDecision.hasBackupDecision.mockResolvedValue(false)
      backupPauseReason.mockResolvedValue('no-decision')

      const wrapper = mount(SafFolderSection, { global: { plugins: [i18n] } })
      await flushPromises()

      expect(wrapper.find('[data-test="backup-paused"]').exists()).toBe(true)
      expect(wrapper.find('[data-test="start-fresh"]').exists()).toBe(true)
      // Lot du 06/08 : preuve que l'écran CONSULTE le site unique de vérité, et sur le
      // stockage réellement résolu — sans cette assertion, un composant qui re-dériverait
      // la pause dans son coin (l'état d'avant ce lot) resterait vert ici.
      expect(backupPauseReason).toHaveBeenCalledWith(storage)
    })

    // Avenant 04/08/2026 : la garde ne s'éteint plus toute seule dès que
    // l'utilisatrice a du travail réel — seule une DÉCISION explicite la lève.
    // Avant ce correctif, `backupPaused` restait dérivée d'`isDbRestorable` : le
    // bouton « Repartir de zéro » (seule porte de sortie quand la garde est
    // active, §3.4) aurait disparu de l'écran alors que `runBackup` continuait de
    // refuser d'écrire — un cul-de-sac invisible, sans recours.
    it("le travail réel seul ne cache PLUS la ligne ni le bouton (aucune décision prise)", async () => {
      api.hasFolder.mockResolvedValue(true)
      api.folderName.mockResolvedValue('Rowtine')
      dbApi.getSetting.mockResolvedValue(null)
      backupService.getBackupStorage.mockResolvedValue({})
      restoreApi.hasBackup.mockResolvedValue(true)
      restoreService.isDbRestorable.mockResolvedValue(false) // travail réel
      backupDecision.hasBackupDecision.mockResolvedValue(false) // aucune décision
      backupPauseReason.mockResolvedValue('no-decision')

      const wrapper = mount(SafFolderSection, { global: { plugins: [i18n] } })
      await flushPromises()

      expect(wrapper.find('[data-test="backup-paused"]').exists()).toBe(true)
      expect(wrapper.find('[data-test="start-fresh"]').exists()).toBe(true)
    })

    it("n'affiche NI la ligne NI le bouton dès qu'une décision a été prise pour ce dossier", async () => {
      api.hasFolder.mockResolvedValue(true)
      api.folderName.mockResolvedValue('Rowtine')
      dbApi.getSetting.mockResolvedValue(null)
      backupService.getBackupStorage.mockResolvedValue({})
      restoreApi.hasBackup.mockResolvedValue(true)
      restoreService.isDbRestorable.mockResolvedValue(true)
      backupDecision.hasBackupDecision.mockResolvedValue(true)
      backupPauseReason.mockResolvedValue(null) // décision prise ET fiche cohérente

      const wrapper = mount(SafFolderSection, { global: { plugins: [i18n] } })
      await flushPromises()

      expect(wrapper.find('[data-test="backup-paused"]').exists()).toBe(false)
      expect(wrapper.find('[data-test="start-fresh"]').exists()).toBe(false)
    })

    // LE TEST DE CETTE TÂCHE (lot du 06/08/2026) — le cul-de-sac qu'elle ferme. Une
    // décision A BIEN été prise pour ce dossier : sous le critère d'avant
    // (`backupFound && !hasBackupDecision`, recopié ici à la main), cet écran conclurait
    // « pas en pause » et n'afficherait NI la ligne, NI le bouton de sortie — pendant que
    // `runBackup`, lui, refuserait d'écrire parce qu'un AUTRE appareil a écrit dans le
    // dossier. Sauvegarde morte, en silence, sans issue : c'est exactement la forme que
    // ce code a déjà produite deux fois. Les deux assertions doivent donc rougir dès que
    // l'écran recommence à dériver la pause pour son compte.
    //
    // Depuis le 06/08 — ADAPTATION : la ligne de pause visée ici est désormais
    // `other-device-blocked`, pas `backup-paused`. Auparavant, `other-device-blocked`
    // n'existait pas encore et `backup-paused` servait aux DEUX raisons ; depuis, chaque
    // raison a sa phrase (« restaure d'abord » n'a aucun sens quand le blocage vient d'un
    // autre appareil). L'assertion sur `start-fresh` est inchangée À DESSEIN : c'est elle
    // qui prouve que la porte de sortie reste dessinée — la relâcher rouvrirait le
    // cul-de-sac que ce correctif existe pour fermer.
    it("décision prise MAIS fiche d'un autre appareil : la ligne de pause ET le bouton de sortie sont là", async () => {
      api.hasFolder.mockResolvedValue(true)
      api.folderName.mockResolvedValue('Rowtine')
      dbApi.getSetting.mockResolvedValue(null)
      backupService.getBackupStorage.mockResolvedValue({})
      restoreApi.hasBackup.mockResolvedValue(true)
      restoreService.isDbRestorable.mockResolvedValue(true)
      // La décision EST prise : c'est ce qui rend le test capable de rougir. Avec
      // `false` ici, l'ancien critère conclurait « en pause » lui aussi, par
      // coïncidence, et la contre-épreuve resterait verte sans rien prouver.
      backupDecision.hasBackupDecision.mockResolvedValue(true)
      backupPauseReason.mockResolvedValue('other-device')

      const w = mountIt()
      await flushPromises()

      expect(w.find('[data-test="other-device-blocked"]').exists()).toBe(true)
      expect(w.find('[data-test="start-fresh"]').exists()).toBe(true)
      // Une seule phrase de pause à la fois : celle de `no-decision` (« restaure
      // d'abord ») dirait ici le contraire de la vraie raison.
      expect(w.find('[data-test="backup-paused"]').exists()).toBe(false)
    })

    it("« Repartir de zéro » demande confirmation puis appelle runBackup avec overwriteBackup", async () => {
      api.hasFolder.mockResolvedValue(true)
      api.folderName.mockResolvedValue('Rowtine')
      dbApi.getSetting.mockResolvedValue(null)
      backupService.getBackupStorage.mockResolvedValue({})
      restoreApi.hasBackup.mockResolvedValue(true)
      restoreService.isDbRestorable.mockResolvedValue(true)
      backupService.runBackup.mockResolvedValue({ ok: true })
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

      const wrapper = mount(SafFolderSection, { global: { plugins: [i18n] } })
      await flushPromises()
      await wrapper.find('[data-test="start-fresh"]').trigger('click')
      await flushPromises()

      expect(confirmSpy).toHaveBeenCalledWith(fr.saf.startFreshConfirm)
      // Appropriation du dossier (06/08/2026) : « Repartir de zéro »
      // n'a RIEN à écrire de son côté — il délègue à `runBackup`, qui écrit lui-même la
      // fiche d'identité au nom de cet appareil, inconditionnellement (backup-service.js :
      // `writeManifest(storage)` est appelée après `backupAll`, hors de toute condition
      // sur `overwriteBackup`). VÉRIFIÉ dans le code plutôt que supposé — c'est ce genre
      // de « c'est déjà couvert » qui a laissé passer la garde finale de `runRestore` le
      // 04/08. L'assertion ci-dessous est donc ce qui prouve que le chemin passe bien
      // par là : si `startFresh` cessait d'appeler `runBackup`, le dossier resterait à
      // jamais au nom de l'AUTRE appareil et la sauvegarde ne repartirait pas.
      expect(backupService.runBackup).toHaveBeenCalledWith(
        expect.objectContaining({ overwriteBackup: true }),
      )
      // Avenant 04/08/2026, étape 3 : « Repartir de zéro » est l'un des deux gestes
      // explicites qui acquittent le dossier — posé APRÈS que l'écriture a réussi.
      expect(backupDecision.recordBackupDecision).toHaveBeenCalledTimes(1)
      confirmSpy.mockRestore()
    })

    // Étape 4a : le booléen de `recordBackupDecision()` DOIT être lu — un échec ne
    // doit pas afficher « Patrons sauvegardés » alors que la garde reste active.
    it("« Repartir de zéro » : l'écriture réussit mais l'acquittement échoue → le dit, pas « Patrons sauvegardés »", async () => {
      api.hasFolder.mockResolvedValue(true)
      api.folderName.mockResolvedValue('Rowtine')
      dbApi.getSetting.mockResolvedValue(null)
      backupService.getBackupStorage.mockResolvedValue({})
      restoreApi.hasBackup.mockResolvedValue(true)
      restoreService.isDbRestorable.mockResolvedValue(true)
      backupService.runBackup.mockResolvedValue({ ok: true })
      backupDecision.recordBackupDecision.mockResolvedValue(false)
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

      const wrapper = mount(SafFolderSection, { global: { plugins: [i18n] } })
      await flushPromises()
      await wrapper.find('[data-test="start-fresh"]').trigger('click')
      await flushPromises()

      expect(snackbarApi.show).toHaveBeenCalledWith(fr.saf.decisionNotSaved)
      expect(snackbarApi.show).not.toHaveBeenCalledWith(fr.saf.syncDone)
      confirmSpy.mockRestore()
    })

    it("« Repartir de zéro » refusé n'écrit RIEN", async () => {
      api.hasFolder.mockResolvedValue(true)
      api.folderName.mockResolvedValue('Rowtine')
      dbApi.getSetting.mockResolvedValue(null)
      backupService.getBackupStorage.mockResolvedValue({})
      restoreApi.hasBackup.mockResolvedValue(true)
      restoreService.isDbRestorable.mockResolvedValue(true)
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

      const wrapper = mount(SafFolderSection, { global: { plugins: [i18n] } })
      await flushPromises()
      await wrapper.find('[data-test="start-fresh"]').trigger('click')
      await flushPromises()

      expect(backupService.runBackup).not.toHaveBeenCalled()
      // Aucune écriture : la décision ne doit pas non plus être posée.
      expect(backupDecision.recordBackupDecision).not.toHaveBeenCalled()
      confirmSpy.mockRestore()
    })

    // Avenant 04/08/2026 : une écriture qui échoue ne doit jamais acquitter le
    // dossier — sinon la garde s'éteindrait sur un dossier qui n'a en réalité
    // rien reçu.
    it("« Repartir de zéro » : runBackup échoue → la décision n'est PAS posée", async () => {
      api.hasFolder.mockResolvedValue(true)
      api.folderName.mockResolvedValue('Rowtine')
      dbApi.getSetting.mockResolvedValue(null)
      backupService.getBackupStorage.mockResolvedValue({})
      restoreApi.hasBackup.mockResolvedValue(true)
      restoreService.isDbRestorable.mockResolvedValue(true)
      backupService.runBackup.mockResolvedValue({ ok: false, error: 'disque plein' })
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

      const wrapper = mount(SafFolderSection, { global: { plugins: [i18n] } })
      await flushPromises()
      await wrapper.find('[data-test="start-fresh"]').trigger('click')
      await flushPromises()

      expect(backupDecision.recordBackupDecision).not.toHaveBeenCalled()
      confirmSpy.mockRestore()
    })
  })

  // --- Fiche d'identité de la sauvegarde (06/08/2026) ---
  //
  // Le 06/08 au matin, l'app a affiché « une sauvegarde t'attend » et suspendu ses
  // écritures sur le téléphone d'une utilisatrice. RIEN à l'écran ne disait ce qu'était
  // cette sauvegarde, d'où elle venait, ni laquelle des deux faces était la plus récente.
  // Ces trois tests couvrent les trois origines possibles.
  //
  // ⚠️ La règle que porte ce bloc : ON NE CONSEILLE QUE LORSQU'ON SAIT. Origine inconnue
  // ⇒ les faits, et RIEN d'autre.
  describe('d’où vient la sauvegarde', () => {
    beforeEach(() => {
      // Le dossier est désigné, avec une sauvegarde dedans : c'est la seule situation où
      // la question se pose. Sans ces quatre lignes, `designated` resterait `undefined`
      // et `getBackupStorage` renverrait `null` (défauts du beforeEach global) — la
      // ligne d'origine ne serait jamais rendue et les tests passeraient à côté de leur
      // sujet.
      api.hasFolder.mockResolvedValue(true)
      api.folderName.mockResolvedValue('Rowtine')
      backupService.getBackupStorage.mockResolvedValue({})
      restoreApi.hasBackup.mockResolvedValue(true)
      // Décomptes de l'APPAREIL délibérément DIFFÉRENTS de ceux des fiches mockées plus
      // bas (6/9/31) : c'est la seule façon de prouver que chaque côté porte SES propres
      // nombres. Avec des valeurs coïncidentes, intervertir les deux lignes ne ferait
      // rien rougir.
      dbApi.db.projects.count.mockResolvedValue(3)
      dbApi.db.patterns.filter.mockReturnValue({ count: vi.fn().mockResolvedValue(5) })
      dbApi.db.yarns.count.mockResolvedValue(7)
    })

    it('fiche de CET appareil : origine, décomptes des deux côtés, et le conseil', async () => {
      manifestApi.readManifest.mockResolvedValue({
        state: 'ok',
        manifest: {
          appareil: 'moi',
          ecritLe: '2026-08-06T05:15:18.402Z',
          contenu: { projets: 6, patrons: 9, laines: 31 },
        },
      })
      const w = mountIt()
      await flushPromises()
      expect(w.find('[data-test="origin"]').text()).toContain('cet appareil')
      expect(w.find('[data-test="advice"]').text()).toContain('ta propre sauvegarde')

      // ⚠️ LES DEUX CÔTÉS SONT ÉPINGLÉS, ÉTIQUETTE COMPRISE. C'est le point entier de
      // l'écran : « comparer les deux côtés ». Tant que seul le côté dossier était
      // vérifié, on pouvait supprimer la ligne de l'appareil, ou INTERVERTIR les deux
      // étiquettes — l'écran aurait alors annoncé « Cet appareil » au-dessus des
      // décomptes du DOSSIER, soit le contraire de la vérité — sans rien faire rougir.
      const folder = w.find('[data-test="side-folder"]').text()
      expect(folder).toContain(fr.saf.sideFolder)
      expect(folder).toContain('6 projets')
      expect(folder).toContain('9 patrons')
      expect(folder).toContain('31 laines')

      const device = w.find('[data-test="side-device"]').text()
      expect(device).toContain(fr.saf.sideDevice)
      expect(device).toContain('3 projets')
      expect(device).toContain('5 patrons')
      expect(device).toContain('7 laines')
    })

    it('fiche ABSENTE : aucun conseil, et AUCUN décompte côté dossier', async () => {
      manifestApi.readManifest.mockResolvedValue({ state: 'absent' })
      const w = mountIt()
      await flushPromises()
      expect(w.find('[data-test="origin"]').text()).toContain('version antérieure')
      // On ne conseille pas à l'aveugle : conseiller sans savoir pourrait envoyer
      // quelqu'un écraser la sauvegarde qui était la bonne.
      expect(w.find('[data-test="advice"]').exists()).toBe(false)
      expect(w.find('[data-test="side-folder"]').exists()).toBe(false)
    })

    // Même exigence sur l'autre moitié d'`unknown` : une fiche présente mais illisible ne
    // doit pas davantage produire de conseil. Sans ce test, un `origin === 'absent'`
    // écrit à la place d'`unknown` passerait inaperçu.
    it('fiche ILLISIBLE : pas de conseil non plus, et aucun décompte côté dossier', async () => {
      manifestApi.readManifest.mockResolvedValue({ state: 'invalid' })
      const w = mountIt()
      await flushPromises()
      expect(w.find('[data-test="origin"]').text()).toContain('version antérieure')
      expect(w.find('[data-test="advice"]').exists()).toBe(false)
      expect(w.find('[data-test="side-folder"]').exists()).toBe(false)
    })

    // MIGRATION : ancien téléphone vers le neuf, base locale encore vierge — restaurer est
    // le bon geste, et il aboutira. ⚠️ `isDbRestorable` est posée EXPLICITEMENT ici depuis
    // la décision du 07/08 : le défaut du `beforeEach` global est `false`, et le conseil ne
    // s'affiche plus dans ce cas (test suivant). Sans cette ligne, ce test décrirait le
    // dossier partagé tout en prétendant décrire la migration.
    it('fiche d’un AUTRE appareil, base restaurable : il est nommé, et le conseil dit « Restaurer »', async () => {
      restoreService.isDbRestorable.mockResolvedValue(true)
      manifestApi.readManifest.mockResolvedValue({
        state: 'ok',
        manifest: {
          appareil: 'autre',
          modeleAppareil: 'LYA-L29',
          ecritLe: '2026-08-01T10:00:00.000Z',
          contenu: { projets: 2, patrons: 3, laines: 4 },
        },
      })
      const w = mountIt()
      await flushPromises()
      expect(w.find('[data-test="origin"]').text()).toContain('LYA-L29')
      expect(w.find('[data-test="advice"]').text()).toContain('ancien appareil')
    })

    // DOSSIER PARTAGÉ : deux appareils en usage, du travail réel sur celui-ci. `runRestore`
    // REFUSERA (garde `not-empty`) — conseiller « restaure tes données » contredisait
    // l'alerte affichée juste au-dessus ET menait à une porte fermée. Mais se taire n'était
    // pas la bonne réponse non plus (correctif de revue, 07/08) : ici on SAIT quoi
    // conseiller — ce dossier sert déjà à un autre appareil, il en faut un autre.
    it('fiche d’un AUTRE appareil, base NON restaurable : le conseil nomme le remède', async () => {
      restoreService.isDbRestorable.mockResolvedValue(false)
      // La RAISON de la pause est mockée dans ce fichier (le prédicat a son propre test) :
      // sans cette ligne, le défaut `'no-decision'` afficherait l'autre phrase d'alerte.
      backupPauseReason.mockResolvedValue('other-device')
      manifestApi.readManifest.mockResolvedValue({
        state: 'ok',
        manifest: {
          appareil: 'autre',
          modeleAppareil: 'LYA-L29',
          ecritLe: '2026-08-01T10:00:00.000Z',
          contenu: { projets: 2, patrons: 3, laines: 4 },
        },
      })
      const w = mountIt()
      await flushPromises()

      expect(w.find('[data-test="advice"]').element.textContent.trim()).toBe(
        fr.saf.adviceOtherDeviceBlocked,
      )
      expect(w.find('[data-test="other-device-blocked"]').element.textContent.trim()).toBe(
        fr.saf.otherDeviceBlocked,
      )
      expect(w.find('[data-test="origin"]').element.textContent).toContain('LYA-L29')
    })

    // ⚠️ TEST JUMEAU de « sonde en échec » dans tests/unit/backup-decision-prompt.spec.js.
    // C'est LE cas où les deux écrans se contredisaient (correctif de revue, 07/08) : le
    // bandeau retombait sur `true` (repli conçu pour un bouton) et conseillait de restaurer,
    // cet écran-ci retombait sur `false`. Les deux doivent désormais conclure la même chose
    // — aucun conseil — et c'est la garantie centrale du module partagé.
    //
    // La sonde est ISOLÉE dans son propre filet depuis ce correctif : son rejet ne doit plus
    // emporter tout le bloc d'identité du dossier. Les assertions POSITIVES ci-dessous le
    // prouvent — sans elles, l'assertion d'absence serait verte pour la mauvaise raison
    // (un écran vide la satisferait aussi).
    it('sonde en échec : AUCUN conseil, mais le reste du bloc d’identité tient', async () => {
      restoreService.isDbRestorable.mockRejectedValue(new Error('base illisible'))
      backupPauseReason.mockResolvedValue('other-device')
      manifestApi.readManifest.mockResolvedValue({
        state: 'ok',
        manifest: {
          appareil: 'autre',
          modeleAppareil: 'LYA-L29',
          ecritLe: '2026-08-01T10:00:00.000Z',
          contenu: { projets: 2, patrons: 3, laines: 4 },
        },
      })
      const w = mountIt()
      await flushPromises()

      expect(w.find('[data-test="advice"]').exists()).toBe(false)
      expect(w.find('[data-test="origin"]').element.textContent).toContain('LYA-L29')
      expect(w.find('[data-test="side-folder"]').element.textContent).toContain('2 projets')
      // Repli fail-closed conservé pour ce qu'il gouverne : `diag-db` ne porte plus la
      // branche non restaurable — la dissociation des deux usages est mesurée ici, pas
      // seulement l'absence du conseil.
      expect(w.find('[data-test="diag-db"]').exists()).toBe(false)
    })

    // `modeleAppareil` est FACULTATIF par construction (device-identity.js : `null` sur
    // web/dev, sur un build antérieur à ce lot, ou sur erreur). Sans repli, la phrase
    // afficherait « un autre appareil (null) » sur l'écran dont le seul rôle est de
    // rassurer.
    it('fiche d’un autre appareil SANS modèle : la phrase reste lisible, sans « null »', async () => {
      // Base restaurable, posée explicitement : ce test parle du LIBELLÉ d'origine, mais il
      // vérifie aussi le conseil en dernière ligne — lequel ne s'affiche plus quand
      // restaurer ne peut pas aboutir (décision du 07/08). Sans cette ligne, le défaut
      // `false` du beforeEach global l'aurait fait rougir pour une raison sans rapport.
      restoreService.isDbRestorable.mockResolvedValue(true)
      manifestApi.readManifest.mockResolvedValue({
        state: 'ok',
        manifest: {
          appareil: 'autre',
          modeleAppareil: null,
          ecritLe: '2026-08-01T10:00:00.000Z',
          contenu: { projets: 2, patrons: 3, laines: 4 },
        },
      })
      const w = mountIt()
      await flushPromises()
      const text = w.find('[data-test="origin"]').text()
      // Assertion POSITIVE : la phrase doit être EXACTEMENT celle du repli, construite
      // avec le même moteur i18n que le composant. `not.toContain('null')` ne suffisait
      // pas — mesuré : vue-i18n interpole `null` en chaîne VIDE, si bien que la phrase
      // non repliée donne « … un autre appareil (), le … », qui ne contient pas le mot
      // « null » et passait le test. `not.toContain('(')` mordait, lui, mais par la
      // seule PONCTUATION : une retouche rédactionnelle en « un autre appareil — {model} »
      // l'aurait fait cesser de mordre en silence. Comparer à la clé de repli est le seul
      // énoncé qui survit à une réécriture des libellés.
      const date = new Date('2026-08-01T10:00:00.000Z').toLocaleString()
      expect(text).toBe(i18n.global.t('saf.originOtherUnnamed', { date }))
      expect(text).not.toContain('null')
      expect(w.find('[data-test="advice"]').text()).toContain('ancien appareil')
    })

    // Une fiche peut être valide au sens de `readManifest` (qui ne valide QUE le champ
    // `appareil`) sans porter de décomptes. Afficher la ligne quand même laisserait
    // « {projets} projets, {patrons} patrons » en clair à l'écran.
    it('fiche SANS décomptes : la ligne du dossier est tue, mais l’origine et le conseil restent', async () => {
      manifestApi.readManifest.mockResolvedValue({
        state: 'ok',
        manifest: { appareil: 'moi', ecritLe: '2026-08-06T05:15:18.402Z' },
      })
      const w = mountIt()
      await flushPromises()
      expect(w.find('[data-test="side-folder"]').exists()).toBe(false)
      // ⚠️ SURTOUT PAS `not.toContain('{projets}')` — MESURÉ sur le vue-i18n du dépôt :
      // un paramètre manquant devient la chaîne VIDE, jamais une accolade visible.
      //   t('saf.sideCounts', {})           → «  projets,  patrons,  laines »
      //   t('saf.sideCounts', { projets:6 }) → « 6 projets,  patrons,  laines »
      // Une assertion sur les accolades ne peut donc littéralement pas échouer (vérifié :
      // garde retirée, elle reste verte). C'est le TROU qu'il faut interdire, et on le
      // désigne par la chaîne que vue-i18n produirait réellement.
      expect(w.element.textContent).not.toContain(brokenCounts({}))
      expect(w.find('[data-test="origin"]').text()).toContain('cet appareil')
      expect(w.find('[data-test="advice"]').text()).toContain('ta propre sauvegarde')
    })

    // `{}` est un objet parfaitement véridique : une garde qui ne teste que la PRÉSENCE
    // de `contenu` le laisserait passer et afficherait un décompte troué, exactement le
    // défaut que le cas précédent croit couvrir. Les trois nombres sont donc exigés.
    //
    // ⚠️ TROIS jeux d'essai, chacun amputé d'UNE clé DIFFÉRENTE. Avec le seul
    // `{ projets: 6 }`, une garde qui aurait cessé d'exiger `laines` (ou `projets`)
    // serait restée verte — les deux autres clés manquant de toute façon. Il faut un cas
    // où la clé retirée de la garde est la SEULE qui manque à la fiche.
    const amputees = [
      ['sans `projets`', { patrons: 9, laines: 31 }],
      ['sans `patrons`', { projets: 6, laines: 31 }],
      ['sans `laines`', { projets: 6, patrons: 9 }],
    ]
    for (const [nom, contenu] of amputees) {
      it(`fiche aux décomptes INCOMPLETS (${nom}) : la ligne du dossier est tue elle aussi`, async () => {
        manifestApi.readManifest.mockResolvedValue({
          state: 'ok',
          manifest: { appareil: 'moi', ecritLe: '2026-08-06T05:15:18.402Z', contenu },
        })
        const w = mountIt()
        await flushPromises()
        expect(w.find('[data-test="side-folder"]').exists()).toBe(false)
        // La chaîne trouée que vue-i18n produirait vraiment — cf. le commentaire du test
        // précédent : jamais d'accolade visible, seulement un blanc là où un nombre
        // devrait être.
        expect(w.element.textContent).not.toContain(brokenCounts(contenu))
        expect(w.find('[data-test="origin"]').text()).toContain('cet appareil')
      })
    }

    // ⚠️ L'ASYMÉTRIE QUE CE TEST FERME. Les trois lignes qui parlent du dossier ont
    // d'abord porté des gardes DIFFÉRENTES : `origin` exigeait `backupFound`, `advice` et
    // `side-folder` non. Le cas est atteignable en vrai — `hasBackup` ne sonde que
    // `Projets/`, `Patrons/`, `laines.json` et `reglages.json`, JAMAIS `sauvegarde.json`.
    // Un dossier dont la fiche survit à la disparition de ces quatre-là aurait affiché
    // les décomptes et le conseil « restaure tes données » SANS la phrase d'origine,
    // juste sous la ligne « Aucune sauvegarde dans ce dossier pour l'instant. » : deux
    // affirmations contraires l'une sous l'autre. Les trois gardes sont désormais la
    // même, et ce test est ce qui l'exige — aucun autre ne pose `hasBackup → false`
    // avec une fiche lisible.
    it('dossier désigné mais AUCUNE sauvegarde détectée : la fiche seule ne fait rien dire du dossier', async () => {
      restoreApi.hasBackup.mockResolvedValue(false)
      manifestApi.readManifest.mockResolvedValue({
        state: 'ok',
        manifest: {
          appareil: 'autre',
          modeleAppareil: 'LYA-L29',
          ecritLe: '2026-08-01T10:00:00.000Z',
          contenu: { projets: 2, patrons: 3, laines: 4 },
        },
      })
      const w = mountIt()
      await flushPromises()
      // La ligne de diagnostic dit « aucune sauvegarde » : rien ne doit la contredire.
      expect(w.find('[data-test="diag-backup"]').text()).toMatch(/aucune sauvegarde/i)
      expect(w.find('[data-test="origin"]').exists()).toBe(false)
      expect(w.find('[data-test="advice"]').exists()).toBe(false)
      expect(w.find('[data-test="side-folder"]').exists()).toBe(false)
      // Le côté APPAREIL, lui, reste : il ne parle pas du dossier.
      expect(w.find('[data-test="side-device"]').text()).toContain('3 projets')
    })

    // La fiche est lue sur le stockage RÉELLEMENT résolu — même exigence que pour
    // `backupPauseReason` (voir plus haut). Un composant qui lirait le dossier autrement, ou
    // pas du tout, resterait vert sans cette assertion.
    it('la fiche est lue sur le stockage réellement résolu', async () => {
      const storage = { marker: 'stockage factice' }
      backupService.getBackupStorage.mockResolvedValue(storage)
      mountIt()
      await flushPromises()
      expect(manifestApi.readManifest).toHaveBeenCalledWith(storage)
    })

    // ⚠️ La fiche mockée ci-dessous est COMPLÈTE et reconnue comme celle de cet appareil,
    // EXPRÈS. Avec le repli du beforeEach global (`state: 'absent'`), les lignes
    // « conseil » et « côté dossier » se seraient tues parce qu'il n'y a rien à dire —
    // pas parce qu'aucun dossier n'est désigné. Le test aurait porté le bon nom en ne
    // prouvant rien : leurs deux `v-if` ne regardaient d'abord que la fiche. Ici, seule
    // la garde `designated` peut les faire disparaître.
    it('sans dossier désigné : ni origine, ni conseil, ni décomptes du dossier', async () => {
      api.hasFolder.mockResolvedValue(false)
      api.folderName.mockResolvedValue(null)
      manifestApi.readManifest.mockResolvedValue({
        state: 'ok',
        manifest: {
          appareil: 'moi',
          ecritLe: '2026-08-06T05:15:18.402Z',
          contenu: { projets: 6, patrons: 9, laines: 31 },
        },
      })
      const w = mountIt()
      await flushPromises()
      expect(w.find('[data-test="origin"]').exists()).toBe(false)
      expect(w.find('[data-test="advice"]').exists()).toBe(false)
      expect(w.find('[data-test="side-folder"]').exists()).toBe(false)
      expect(w.find('[data-test="side-device"]').exists()).toBe(false)
    })
  })

  // Garde d'exclusion mutuelle (adapté 09/08/2026). Après le
  // retrait des trois boutons, « Repartir de zéro » reste seul, mais il écrit dans
  // le dossier — la ré-entrance qu'il faut encore fermer est la SIENNE, pas une
  // course avec un bouton disparu. C'est le mécanisme du sinistre du 04/08/2026
  // (trois écrasements du dossier de 34 Mo d'une utilisatrice) qu'elle empêche de revenir.
  //
  // Un `:disabled` d'affichage seul ne suffit PAS à prouver la garde : dans ce
  // dépôt, `trigger('click')` sur un bouton `:disabled` n'invoque même pas le
  // gestionnaire (vérifié empiriquement) — un test qui cliquerait APRÈS un
  // `flushPromises()` (le DOM déjà re-rendu en `disabled`) ne prouverait donc rien
  // sur la garde EN TÊTE DE FONCTION, seulement sur l'attribut HTML. Ce test
  // déclenche donc le second clic dans le MÊME tick que le premier, AVANT tout
  // re-rendu : `trigger('click')` exécute la portion SYNCHRONE du gestionnaire
  // (jusqu'à son premier `await`) immédiatement, via `dispatchEvent` — c'est ce qui
  // pose `startingFresh.value` à `true` de façon synchrone, avant que le bouton
  // n'ait eu le temps de se désactiver à l'écran.
  describe('garde d’exclusion mutuelle (« Repartir de zéro »)', () => {
    it('« Repartir de zéro » cliqué DEUX FOIS dans le même tick n\'appelle runBackup et window.confirm qu\'UNE seule fois', async () => {
      api.hasFolder.mockResolvedValue(true)
      api.folderName.mockResolvedValue('Rowtine')
      dbApi.getSetting.mockResolvedValue(null)
      backupService.getBackupStorage.mockResolvedValue({})
      restoreApi.hasBackup.mockResolvedValue(true)
      restoreService.isDbRestorable.mockResolvedValue(true)
      backupDecision.hasBackupDecision.mockResolvedValue(false)
      backupService.runBackup.mockImplementation(() => new Promise(() => {})) // ne se résout jamais

      const w = mount(SafFolderSection, { global: { plugins: [i18n] } })
      await flushPromises()

      w.find('[data-test="start-fresh"]').trigger('click')
      w.find('[data-test="start-fresh"]').trigger('click')
      await flushPromises()

      expect(window.confirm).toHaveBeenCalledTimes(1)
      expect(backupService.runBackup).toHaveBeenCalledTimes(1)
    })

    // Bretelles ET ceinture (repris de l'ex-"les trois boutons portent l'attribut
    // `disabled`", réduit à celui qui reste) : sans cette assertion, `:disabled="folderBusy"`
    // sur le gabarit ne serait plus observable par AUCUN test — le test ci-dessus ne
    // vérifie que la garde EN TÊTE DE FONCTION (`startingFresh`), jamais l'attribut HTML.
    it('« Repartir de zéro » porte l’attribut `disabled` pendant que l’écriture est en cours', async () => {
      api.hasFolder.mockResolvedValue(true)
      api.folderName.mockResolvedValue('Rowtine')
      dbApi.getSetting.mockResolvedValue(null)
      backupService.getBackupStorage.mockResolvedValue({})
      restoreApi.hasBackup.mockResolvedValue(true)
      restoreService.isDbRestorable.mockResolvedValue(true)
      backupDecision.hasBackupDecision.mockResolvedValue(false)
      backupService.runBackup.mockImplementation(() => new Promise(() => {})) // ne se résout jamais

      const w = mount(SafFolderSection, { global: { plugins: [i18n] } })
      await flushPromises()

      await w.find('[data-test="start-fresh"]').trigger('click')
      await flushPromises()

      expect(w.find('[data-test="start-fresh"]').attributes('disabled')).toBeDefined()
    })
  })

  // Câblage de la progression (spec 2026-08-04, §4.4) : ce qui compte est que la
  // barre soit VISIBLE PENDANT l'opération, pas seulement qu'un rappel soit passé.
  // Adapté (09/08/2026) : « Synchroniser maintenant » a disparu — « Repartir de
  // zéro » est désormais le seul déclencheur de `runBackup` dans cet écran.
  describe('progression visible', () => {
    it('la ligne de progression est affichée pendant l’écriture, et retirée après', async () => {
      api.hasFolder.mockResolvedValue(true)
      api.folderName.mockResolvedValue('Rowtine')
      dbApi.getSetting.mockResolvedValue(null)
      backupService.getBackupStorage.mockResolvedValue({})
      restoreApi.hasBackup.mockResolvedValue(true)
      restoreService.isDbRestorable.mockResolvedValue(true)
      backupPauseReason.mockResolvedValue('no-decision') // fait apparaître start-fresh

      let seenDuringOperation = false
      let wrapper
      backupService.runBackup.mockImplementation(async ({ onProgress }) => {
        onProgress({ phase: 'backup', done: 1, total: 4, written: 12 })
        await wrapper.vm.$nextTick()
        seenDuringOperation = wrapper.find('[data-test="sync-progress"]').exists()
        return { ok: true }
      })

      wrapper = mount(SafFolderSection, { global: { plugins: [i18n] } })
      await flushPromises()
      await wrapper.find('[data-test="start-fresh"]').trigger('click')
      await flushPromises()

      expect(seenDuringOperation).toBe(true)
      expect(wrapper.find('[data-test="sync-progress"]').exists()).toBe(false)
    })
  })

  // ── Lot « premier lancement simplifié » (09/08/2026) ────────────────────────────
  // Trois des quatre boutons sont partis : la sauvegarde est déjà automatique, la
  // désignation n'a plus lieu ici (la porte s'en charge), et la récupération vit dans le
  // bandeau de décision. Seule « Repartir de zéro » reste — c'est la SEULE porte de sortie
  // de l'état de pause, un cul-de-sac déjà construit et corrigé deux fois.
  describe('les boutons retirés (09/08/2026)', () => {
    it('aucun bouton en régime normal, dossier désigné', async () => {
      api.hasFolder.mockResolvedValue(true)
      api.folderName.mockResolvedValue('Rowtine')
      backupPauseReason.mockResolvedValue(null) // pas de pause
      const w = mountIt()
      await flushPromises()
      // Ces trois assertions ne peuvent PLUS rougir aujourd'hui : les sélecteurs
      // `sync-now`/`restore-now`/`choose-folder` n'existent nulle part dans le
      // template (09/08/2026). Elles restent comme garde anti-réintroduction — la
      // preuve réelle que la section ne rend QUE ce qui est attendu est portée par
      // « cas nominal : SEULE une liste blanche de lignes est rendue » (ensemble
      // exact des `data-test`), pas par ces trois-là.
      expect(w.find('[data-test="sync-now"]').exists()).toBe(false)
      expect(w.find('[data-test="restore-now"]').exists()).toBe(false)
      expect(w.find('[data-test="choose-folder"]').exists()).toBe(false)
      expect(w.find('[data-test="start-fresh"]').exists()).toBe(false)
    })

    it('EN PAUSE : « Repartir de zéro » est toujours là', async () => {
      api.hasFolder.mockResolvedValue(true)
      api.folderName.mockResolvedValue('Rowtine')
      backupPauseReason.mockResolvedValue('no-decision')
      const w = mountIt()
      await flushPromises()
      expect(w.find('[data-test="start-fresh"]').exists()).toBe(true)
    })

    it('même sans dossier, aucun bouton — mais l\'avertissement reste', async () => {
      api.hasFolder.mockResolvedValue(false)
      api.folderName.mockResolvedValue(null)
      const w = mountIt()
      await flushPromises()
      expect(w.find('[data-test="choose-folder"]').exists()).toBe(false)
      expect(w.text()).toContain(fr.saf.noFolderWarning)
    })
  })

  // Le chemin réel du dossier (spec §4.4). La question supprimée au premier lancement
  // était le SEUL endroit où l'app disait où sont les données. `folderName()` n'est
  // plus la constante « Rowtine » sur tous les appareils : depuis l'adoption
  // (folder-base.js, `decideBase`), elle peut porter le nom du dossier choisi. Les
  // tests ci-dessous restent valides — la valeur est mockée.
  describe('le chemin du dossier', () => {
    it('affiche le chemin complet quand il est connu', async () => {
      api.hasFolder.mockResolvedValue(true)
      api.folderName.mockResolvedValue('Rowtine')
      dbApi.getSetting.mockImplementation(async (k) =>
        k === 'safFolderLabel' ? 'Documents/Rowtine' : undefined)
      const w = mountIt()
      await flushPromises()
      expect(w.find('[data-test="folder-path"]').text()).toContain('Documents/Rowtine')
    })

    // Installation antérieure au lot : la clé n'existe pas. Aucune migration, aucune
    // re-désignation imposée aux trois appareils déjà configurés.
    it('se replie sur le nom seul quand le chemin est inconnu', async () => {
      api.hasFolder.mockResolvedValue(true)
      api.folderName.mockResolvedValue('Rowtine')
      dbApi.getSetting.mockImplementation(async () => undefined)
      const w = mountIt()
      await flushPromises()
      const line = w.find('[data-test="folder-path"]').text()
      expect(line).toContain('Rowtine')
      expect(line).not.toContain('Documents/')
    })
  })

  // ── Décision produit du 05/09/2026 : « Changer de dossier » ──────────
  // Le bouton (`saf.change`, clé jusque-là orpheline) est rendu sur plateforme native
  // TOUJOURS — sans dossier il FAIT désigner, avec dossier il change — et son clic ne
  // fait que LEVER la demande sur le pont `folder-change` : c'est App.vue, seul
  // propriétaire de la ref de la porte, qui l'ouvre en mode change. Pas de
  // confirmation ici : la porte ET le sélecteur système en sont déjà une.
  describe('bouton « Changer de dossier »', () => {
    it('rendu sur plateforme native, avec dossier désigné', async () => {
      api.hasFolder.mockResolvedValue(true)
      api.folderName.mockResolvedValue('Rowtine')
      const w = mountIt()
      await flushPromises()
      const btn = w.find('[data-test="change-folder"]')
      expect(btn.exists()).toBe(true)
      expect(btn.text()).toBe(fr.saf.change)
    })

    it('rendu aussi SANS dossier désigné (il fait alors désigner)', async () => {
      api.hasFolder.mockResolvedValue(false)
      api.folderName.mockResolvedValue(null)
      const w = mountIt()
      await flushPromises()
      expect(w.find('[data-test="change-folder"]').exists()).toBe(true)
    })

    it('ABSENT hors plateforme native (web/dev : pas de plugin, pas d\'écran mort)', async () => {
      isNativePlatform.mockReturnValue(false)
      api.hasFolder.mockResolvedValue(true)
      api.folderName.mockResolvedValue('Rowtine')
      const w = mountIt()
      await flushPromises()
      expect(w.find('[data-test="change-folder"]').exists()).toBe(false)
    })

    it('le clic lève la demande sur le pont (requestChange), sans rien écrire lui-même', async () => {
      api.hasFolder.mockResolvedValue(true)
      api.folderName.mockResolvedValue('Rowtine')
      const w = mountIt()
      await flushPromises()
      const store = useFolderChangeStore()
      expect(store.requested).toBe(false)

      await w.find('[data-test="change-folder"]').trigger('click')
      await flushPromises()

      expect(store.requested).toBe(true)
      // La consommation est le fait d'App.vue (watch → openForChange), pas de la
      // section : cette dernière se contente de lever la demande.
      // La section ne déclenche aucune opération de dossier elle-même.
      expect(backupService.runBackup).not.toHaveBeenCalled()
      expect(backupDecision.recordBackupDecision).not.toHaveBeenCalled()
    })

    // Le rechargement à la fermeture de la porte : sans lui, la raison de pause
    // et le chemin affichés resteraient PÉRMÉS après un changement de dossier
    // (la section ne se recharge aujourd'hui qu'au montage).
    it('la fermeture de la porte (compteur du pont) recharge l\'état de la section', async () => {
      api.hasFolder.mockResolvedValue(false)
      api.folderName.mockResolvedValue(null)
      mountIt()
      await flushPromises()
      const appelsAuMontage = api.hasFolder.mock.calls.length
      expect(appelsAuMontage).toBeGreaterThan(0)

      const store = useFolderChangeStore()
      store.notifyGateClosed()
      await flushPromises()

      expect(api.hasFolder.mock.calls.length).toBeGreaterThan(appelsAuMontage)
    })

    it('deux fermetures rapprochées rechargent DEUX FOIS (le compteur bouge toujours)', async () => {
      api.hasFolder.mockResolvedValue(true)
      api.folderName.mockResolvedValue('Rowtine')
      mountIt()
      await flushPromises()
      const appelsAuMontage = api.hasFolder.mock.calls.length

      const store = useFolderChangeStore()
      store.notifyGateClosed()
      await flushPromises()
      store.notifyGateClosed()
      await flushPromises()

      expect(api.hasFolder.mock.calls.length).toBe(appelsAuMontage + 2)
    })
  })
})
