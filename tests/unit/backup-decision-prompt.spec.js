// Unitaire — BackupDecisionPrompt.vue (avenant 04/08/2026, §A.4).
// Le bandeau bloquant qui porte les DEUX gestes qui acquittent un dossier : le
// premier des quatre chemins de destruction du 04/08 était précisément un bandeau à
// UNE seule action, qu'ignorer suffisait à détruire (§2.3, chemin 1). Ici, on
// teste le composant EN ISOLATION (visibilité pilotée par le parent, cf.
// tests/unit/App.restore-offer.spec.js pour le wiring App.vue) : ses deux boutons,
// ses messages (repris de SafFolderSection, pas réinventés), et — le point non
// négociable — l'absence de toute façon de le fermer sans choisir.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import { useSnackbarStore } from '@/stores/snackbar'

const restoreService = vi.hoisted(() => ({ runRestore: vi.fn(), isDbRestorable: vi.fn() }))
vi.mock('@/backup/restore-service', () => restoreService)

// ⚠️ `getBackupStorage` a rejoint ce mock depuis peu : le bandeau va chercher lui-même
// le stockage pour lire la fiche d'identité de la sauvegarde. Sans cette entrée, le mock
// de module renvoie `undefined` et `onMounted` casse sur un TypeError — pour les VINGT
// tests de ce fichier, pas seulement pour les nouveaux.
const backupService = vi.hoisted(() => ({ runBackup: vi.fn(), getBackupStorage: vi.fn() }))
vi.mock('@/backup/backup-service', () => backupService)

// Fiche d'identité : seule `describeOrigin` est interceptée. Les deux fonctions
// qui FABRIQUENT les phrases (`adviceSentence`, `originSentence`) restent les VRAIES —
// c'est tout l'intérêt de les avoir partagées : ce fichier doit prouver que le bandeau
// affiche les phrases réellement écrites dans les Réglages, pas des doublures.
const backupOrigin = vi.hoisted(() => ({ describeOrigin: vi.fn() }))
vi.mock('@/backup/backup-origin', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, describeOrigin: backupOrigin.describeOrigin }
})

const backupDecision = vi.hoisted(() => ({ recordBackupDecision: vi.fn() }))
vi.mock('@/backup/backup-decision', () => backupDecision)

// (décision produit du 05/09/2026) : les branches modale de ce bandeau
// résolvent le chemin du dossier (`folderDisplayPath`) au moment de la
// publication. Mocké ICI pour que le test ne tape ni la base (`getSetting`) ni
// le plugin natif — ce qu'on vérifie est que le chemin PUBLIÉ est bien celui
// que le module partagé résout, pas la composition elle-même.
const safFolderLabel = vi.hoisted(() => ({ folderDisplayPath: vi.fn() }))
vi.mock('@/backup/saf-folder-label', () => safFolderLabel)

import BackupDecisionPrompt from '@/components/BackupDecisionPrompt.vue'
import { useRestoreErrorStore } from '@/stores/restore-error'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })

// `props = {}` par défaut : le bandeau reçoit désormais la RAISON de la pause.
// Les appels `mountIt()` déjà en place — une vingtaine — doivent continuer de valoir
// exactement ce qu'ils valaient, c'est-à-dire le cas nominal `'no-decision'` (le défaut
// déclaré par le composant).
const mountIt = (props = {}) =>
  mount(BackupDecisionPrompt, {
    props,
    global: { plugins: [createPinia(), i18n] },
    attachTo: document.body, // requis pour le piège de focus (Tab/Shift+Tab, focus initial)
  })

beforeEach(() => {
  setActivePinia(createPinia())
  restoreService.runRestore.mockReset().mockResolvedValue({ ok: true, decided: true })
  // Cas nominal par défaut (étape 1) : restauration possible, pas de sortie
  // « Plus tard ». Chaque test qui a besoin du cas bloqué le remplace explicitement.
  restoreService.isDbRestorable.mockReset().mockResolvedValue(true)
  backupService.runBackup.mockReset().mockResolvedValue({ ok: true })
  backupService.getBackupStorage.mockReset().mockResolvedValue({})
  // Défaut DÉTERMINISTE (même précaution qu'en tête de tests/unit/backup-origin.spec.js) :
  // sans lui, un test qui oublie de poser l'origine hériterait de celle du test précédent
  // et passerait par coïncidence. `unknown` est aussi le repli le plus neutre — aucun
  // conseil affiché, donc aucune assertion des tests plus anciens perturbée.
  backupOrigin.describeOrigin.mockReset().mockResolvedValue({ origin: 'unknown', manifest: null })
  backupDecision.recordBackupDecision.mockReset().mockResolvedValue(true)
  safFolderLabel.folderDisplayPath.mockReset().mockResolvedValue('Documents/Rowtine')
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('BackupDecisionPrompt', () => {
  it('affiche le texte saf.backupPaused (avenant, étape 1 — pas un autre message)', async () => {
    const w = mountIt()
    await flushPromises()
    expect(w.text()).toContain(fr.saf.backupPaused)
  })

  // Le <h2> (aria-labelledby="bdp-title") n'était couvert par
  // aucun test — on vérifie que le titre existe RÉELLEMENT (pas seulement dans le
  // texte du composant, en vrac) ET que l'attribut du dialogue le désigne bien PAR
  // SON ID, pas par coïncidence de contenu.
  it('le <h2> du bandeau existe et aria-labelledby le désigne réellement', async () => {
    const w = mountIt()
    await flushPromises()
    const dialog = w.find('[role="dialog"]')
    const labelledBy = dialog.attributes('aria-labelledby')
    expect(labelledBy).toBe('bdp-title')
    const title = w.find(`#${labelledBy}`)
    expect(title.exists()).toBe(true)
    expect(title.element.tagName).toBe('H2')
    expect(title.text()).toBe(fr.saf.decisionTitle)
  })

  // Le point NON NÉGOCIABLE de l'avenant, dans le cas NOMINAL (restauration
  // possible) : aucune façon de fermer sans choisir. Ce n'est
  // PLUS vrai dans tous les cas — cf. describe ci-dessous pour le cas bloqué.
  describe('cas nominal (restauration possible) : aucune façon de se fermer sans choisir', () => {
    it('ne porte aucun bouton « Plus tard »/croix/fermeture', async () => {
      restoreService.isDbRestorable.mockResolvedValue(true)
      const w = mountIt()
      await flushPromises()
      expect(w.find('[data-test="later"]').exists()).toBe(false)
      expect(w.find('[data-test="close"]').exists()).toBe(false)
    })

    // Contre-épreuve (étape 6) : ce test ne doit PAS pouvoir rester vert si la
    // branche `if (e.key === 'Escape') { e.preventDefault(); ... }` est retirée du
    // composant. La version précédente ne vérifiait que l'ABSENCE d'effet — or
    // `if (e.key !== 'Tab') return` (la ligne suivante) produit le MÊME silence
    // pour Escape, avec ou sans la branche dédiée : l'assertion ne pouvait pas
    // échouer (défaut déjà consigné sur ce projet). `defaultPrevented` est le seul
    // effet OBSERVABLE que cette branche produit — on le vérifie directement sur
    // l'événement natif dispatché (pas via `trigger`, dont le `cancelable` n'est
    // pas garanti par toutes les versions de Vue Test Utils).
    it("Échap : preventDefault() est appelé (la branche dédiée existe), rien n'est fermé ni émis", async () => {
      const w = mountIt()
      await flushPromises()
      const dialog = w.find('[role="dialog"]').element
      const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true })
      dialog.dispatchEvent(event)
      await flushPromises()

      expect(event.defaultPrevented).toBe(true)
      expect(w.find('[data-test="backup-decision-prompt"]').exists()).toBe(true)
      expect(w.emitted('resolved')).toBeFalsy()
      expect(restoreService.runRestore).not.toHaveBeenCalled()
      expect(backupService.runBackup).not.toHaveBeenCalled()
    })

    // Piège de focus (accessibilité, PAS une fermeture) : les deux boutons d'action
    // bouclent entre eux — composable partagé useFocusTrap depuis la résorption de dette technique
    // (07/09) : il n'agit qu'aux BORNES (Tab sur le dernier → premier, Maj+Tab sur le
    // premier → dernier) ; le pas intermédiaire est natif au navigateur, jsdom ne le
    // simule pas, donc le test pose le focus là où le navigateur l'aurait mis.
    it('le Tab boucle entre les deux boutons', async () => {
      const w = mountIt()
      await flushPromises() // laisse le focus initial (posé après nextTick() dans onMounted) s'appliquer
      const restoreBtn = w.find('[data-test="prompt-restore"]').element
      const startFreshBtn = w.find('[data-test="prompt-start-fresh"]').element
      expect(document.activeElement).toBe(restoreBtn) // focus initial sur « Restaurer »

      // Sur le DERNIER focusable (« Repartir de zéro »), Tab reboucle au premier.
      startFreshBtn.focus()
      await w.find('[role="dialog"]').trigger('keydown', { key: 'Tab' })
      expect(document.activeElement).toBe(restoreBtn)

      // Sur le PREMIER, Maj+Tab renvoie au dernier.
      await w.find('[role="dialog"]').trigger('keydown', { key: 'Tab', shiftKey: true })
      expect(document.activeElement).toBe(startFreshBtn)
      w.unmount()
    })
  })

  // Nuance produit — le bandeau enfermait celle qui a déjà du
  // travail réel (« Restaurer » refuse, « Repartir de zéro » écrase). Le bouton
  // « Plus tard » n'existe QUE dans ce cas précis.
  describe('cas bloqué (restauration impossible) : la sortie « Plus tard » existe', () => {
    it('texte saf.decisionBlocked, bouton « Plus tard » présent, data-test="later"', async () => {
      restoreService.isDbRestorable.mockResolvedValue(false)
      const w = mountIt()
      await flushPromises()

      expect(w.text()).toContain(fr.saf.decisionBlocked)
      expect(w.text()).not.toContain(fr.saf.backupPaused)
      expect(w.find('[data-test="later"]').exists()).toBe(true)
    })

    it('« Plus tard » ferme le bandeau SANS RIEN ÉCRIRE (ni restaurer, ni sauvegarder, ni acquitter)', async () => {
      restoreService.isDbRestorable.mockResolvedValue(false)
      const w = mountIt()
      await flushPromises()

      await w.find('[data-test="later"]').trigger('click')
      await flushPromises()

      expect(w.emitted('resolved')).toBeTruthy()
      expect(restoreService.runRestore).not.toHaveBeenCalled()
      expect(backupService.runBackup).not.toHaveBeenCalled()
      expect(backupDecision.recordBackupDecision).not.toHaveBeenCalled()
    })

    // Repli prudent (étape 1a) : `isDbRestorable()` peut lever (erreur SAF/DB) — on
    // ne doit PAS proposer la sortie de secours sans raison connue.
    it("isDbRestorable() lève → repli prudent, PAS de bouton « Plus tard »", async () => {
      restoreService.isDbRestorable.mockRejectedValue(new Error('boom'))
      const w = mountIt()
      await flushPromises()

      expect(w.find('[data-test="later"]').exists()).toBe(false)
      expect(w.text()).toContain(fr.saf.backupPaused)
    })

    // Correctif revue : le piège de focus figeait Tab/Shift+Tab sur les
    // deux premiers boutons — la seule sortie non destructrice, quand elle existe,
    // devait rester atteignable au clavier. Composable partagé useFocusTrap depuis le
    // lot « dette juillet » (07/09) : il n'agit qu'aux BORNES (Tab sur le dernier →
    // premier, Maj+Tab sur le premier → dernier) ; le pas intermédiaire est natif au
    // navigateur, jsdom ne le simule pas, donc le test pose le focus là où le
    // navigateur l'aurait mis.
    it('le Tab boucle désormais entre les TROIS boutons (Restaurer, Repartir de zéro, Plus tard)', async () => {
      restoreService.isDbRestorable.mockResolvedValue(false)
      const w = mountIt()
      await flushPromises()
      const restoreBtn = w.find('[data-test="prompt-restore"]').element
      const startFreshBtn = w.find('[data-test="prompt-start-fresh"]').element
      const laterBtn = w.find('[data-test="later"]').element
      expect(document.activeElement).toBe(restoreBtn)

      // Pas intermédiaires (natifs) : Restaurer → Repartir de zéro → Plus tard.
      startFreshBtn.focus()
      laterBtn.focus()

      // Sur le DERNIER focusable (« Plus tard »), Tab reboucle au premier — la sortie
      // non destructrice reste dans la boucle, jamais hors du dialogue.
      await w.find('[role="dialog"]').trigger('keydown', { key: 'Tab' })
      expect(document.activeElement).toBe(restoreBtn)

      // Sur le PREMIER, Maj+Tab renvoie au dernier (« Plus tard »).
      await w.find('[role="dialog"]').trigger('keydown', { key: 'Tab', shiftKey: true })
      expect(document.activeElement).toBe(laterBtn)
      w.unmount()
    })
  })

  // Le bandeau expose `canLeave`/`handleBackPressed` pour que
  // App.vue puisse router le retour Android/le balayage de bord sans dupliquer la
  // règle d'affichage du bouton « Plus tard ». Le câblage bout-en-bout (App.vue +
  // handler `backButton` natif) est couvert par tests/unit/App.back-precedence.spec.js
  // — ici, on teste le CONTRAT exposé, en isolation.
  describe('contrat exposé pour le retour Android (canLeave / handleBackPressed)', () => {
    it('cas nominal : canLeave est faux, handleBackPressed() ne ferme rien', async () => {
      restoreService.isDbRestorable.mockResolvedValue(true)
      const w = mountIt()
      await flushPromises()

      expect(w.vm.canLeave).toBe(false)
      w.vm.handleBackPressed()
      await flushPromises()

      expect(w.emitted('resolved')).toBeFalsy()
      expect(w.find('[data-test="backup-decision-prompt"]').exists()).toBe(true)
    })

    it('cas bloqué : canLeave est vrai, handleBackPressed() équivaut à « Plus tard »', async () => {
      restoreService.isDbRestorable.mockResolvedValue(false)
      const w = mountIt()
      await flushPromises()

      expect(w.vm.canLeave).toBe(true)
      w.vm.handleBackPressed()
      await flushPromises()

      expect(w.emitted('resolved')).toBeTruthy()
      expect(restoreService.runRestore).not.toHaveBeenCalled()
      expect(backupService.runBackup).not.toHaveBeenCalled()
    })
  })

  describe('bouton « Restaurer »', () => {
    it('appelle runRestore, affiche restore.done, émet "resolved" (decided:true)', async () => {
      restoreService.runRestore.mockResolvedValue({ ok: true, decided: true })
      const w = mountIt()
      const snackbar = useSnackbarStore()

      await w.find('[data-test="prompt-restore"]').trigger('click')
      await flushPromises()

      expect(restoreService.runRestore).toHaveBeenCalledWith({ onProgress: expect.any(Function) })
      expect(snackbar.message).toBe(fr.restore.done)
      expect(w.emitted('resolved')).toBeTruthy()
    })

    // Étape 4b, repris ici (pas réinventé) : réussi mais pas acquitté → le dit,
    // n'émet PAS "resolved" (le bandeau doit rester affiché pour réessayer).
    it("réussit mais decided:false → saf.decisionNotSaved, n'émet PAS resolved", async () => {
      restoreService.runRestore.mockResolvedValue({ ok: true, decided: false })
      const w = mountIt()
      const snackbar = useSnackbarStore()

      await w.find('[data-test="prompt-restore"]').trigger('click')
      await flushPromises()

      expect(snackbar.message).toBe(fr.saf.decisionNotSaved)
      expect(w.emitted('resolved')).toBeFalsy()
    })

    // Les refus distincts de `runRestore`, repris de SafFolderSection (pas une
    // seconde grille de messages) — chacun doit rester DISTINGUÉ à l'écran.
    // `skipped: 'web'` (étape 5c) : INATTEIGNABLE en pratique (App.vue ne monte ce
    // composant que sur stockage natif détecté), mais couvert quand même pour ne
    // pas laisser un message faux si ce invariant se rompait un jour.
    // (`{ ok:false, error }` a QUITTÉ cette table : la branche ne
    // passe plus par le snackbar mais par la modale — test dédié ci-dessous.)
    it.each([
      [{ ok: false, skipped: 'permission' }, fr.saf.syncFailedPermission],
      [{ ok: false, skipped: 'empty' }, fr.saf.diagBackupNone],
      [{ ok: false, skipped: 'not-empty' }, fr.saf.restoreNowBlocked],
      [{ ok: false, skipped: 'web' }, fr.saf.restoreNowBlocked],
    ])('runRestore renvoie %o → %s', async (result, expectedMessage) => {
      restoreService.runRestore.mockResolvedValue(result)
      const w = mountIt()
      const snackbar = useSnackbarStore()

      await w.find('[data-test="prompt-restore"]').trigger('click')
      await flushPromises()

      expect(snackbar.message).toBe(expectedMessage)
      expect(w.emitted('resolved')).toBeFalsy()
    })

    // (décision produit du 05/09/2026) : la branche `error` ne se contente
    // plus d'un snackbar `restore.failed` — qui tronquait/noyait le détail — elle
    // publie à la modale RestoreErrorDialog : titre, phrase courte, détail intégral,
    // bouton de copie. Le snackbar, lui, doit rester SILENCIEUX sur cette branche
    // (deux messages pour le même incident se contrediraient).
    it('runRestore renvoie { ok:false, error } → publication à la modale, PAS de snackbar', async () => {
      restoreService.runRestore.mockResolvedValue({ ok: false, error: 'disque plein' })
      const w = mountIt()
      const snackbar = useSnackbarStore()
      const restoreError = useRestoreErrorStore()

      await w.find('[data-test="prompt-restore"]').trigger('click')
      await flushPromises()

      expect(restoreError.report).toMatchObject({ kind: 'error', error: 'disque plein', path: 'Documents/Rowtine' })
      expect(restoreError.report.at).toBeTruthy() // horodatage posé à la publication
      // Le snackbar reste silencieux — l'ancien message de la branche (clé
      // `restore.failed`, retirée des locales) ne peut plus être produit par
      // personne : `visible === false` ci-dessous est LA garantie.
      expect(snackbar.visible).toBe(false)
      expect(w.emitted('resolved')).toBeFalsy()
    })

    // Étape 1d INTACTE sous la nouvelle publication : un échec de « Restaurer »
    // doit toujours faire apparaître « Plus tard » — après « Fermer » (la modale),
    // le bandeau reste avec une sortie, jamais un mur.
    it('runRestore renvoie { ok:false, error } : « Plus tard » apparaît quand même (forceLater)', async () => {
      restoreService.runRestore.mockResolvedValue({ ok: false, error: 'disque plein' })
      const w = mountIt()
      await flushPromises()
      expect(w.find('[data-test="later"]').exists()).toBe(false) // pas encore, avant l'échec

      await w.find('[data-test="prompt-restore"]').trigger('click')
      await flushPromises()

      expect(w.find('[data-test="later"]').exists()).toBe(true)
    })

    // Variante « reprise du dossier non confirmée » : restauration
    // RÉUSSIE mais `owned:false` — la modale REMPLACE le snackbar restore.done
    // (décision explicite : deux messages qui se contrediraient), le bandeau se
    // ferme (`decided:true` → restaurer EST l'acquittement, contrat inchangé).
    it('runRestore renvoie { ok:true, owned:false, decided:true } → modale unowned, PAS de restore.done, resolved émis', async () => {
      restoreService.runRestore.mockResolvedValue({ ok: true, decided: true, owned: false })
      const w = mountIt()
      const snackbar = useSnackbarStore()
      const restoreError = useRestoreErrorStore()

      await w.find('[data-test="prompt-restore"]').trigger('click')
      await flushPromises()

      expect(restoreError.report).toMatchObject({ kind: 'unowned', error: null, path: 'Documents/Rowtine' })
      expect(snackbar.visible).toBe(false)
      expect(w.emitted('resolved')).toBeTruthy()
    })

    // Les écarts consignés par `readBackup` (snapshot `errors`) traversent vers le
    // rapport copiable — sans variante visuelle supplémentaire, c'est la modale
    // unowned qui les porte dans son détail (composeBackupFailureReport).
    it('les écarts du snapshot (errors) accompagnent la publication unowned', async () => {
      const ecarts = [{ where: 'Patrons/x [9]', code: 'ENTITY_REJECTED' }]
      restoreService.runRestore.mockResolvedValue({ ok: true, decided: true, owned: false, errors: ecarts })
      const w = mountIt()
      const restoreError = useRestoreErrorStore()

      await w.find('[data-test="prompt-restore"]').trigger('click')
      await flushPromises()

      expect(restoreError.report.details).toStrictEqual(ecarts)
    })

    // Le chemin nominal NE PUBLIE PAS : `owned` absent du résultat = rien à dire,
    // le snackbar restore.done inchangé reste le seul message (non-régression).
    it('runRestore nominal (sans owned) : aucune publication à la modale', async () => {
      restoreService.runRestore.mockResolvedValue({ ok: true, decided: true })
      const w = mountIt()
      const restoreError = useRestoreErrorStore()

      await w.find('[data-test="prompt-restore"]').trigger('click')
      await flushPromises()

      expect(restoreError.report).toBeNull()
    })

    // decided:false + owned:false : DEUX écritures en échec, DEUX messages — la
    // modale dit l'appropriation, la snackbar décisionNotSaved dit l'acquittement
    // (distincte et inchangée, cf. décision A1) ; le bandeau reste (pas de resolved).
    it('runRestore renvoie { ok:true, owned:false, decided:false } → modale unowned ET decisionNotSaved, PAS de resolved', async () => {
      restoreService.runRestore.mockResolvedValue({ ok: true, decided: false, owned: false })
      const w = mountIt()
      const snackbar = useSnackbarStore()
      const restoreError = useRestoreErrorStore()

      await w.find('[data-test="prompt-restore"]').trigger('click')
      await flushPromises()

      expect(restoreError.report).toMatchObject({ kind: 'unowned' })
      expect(snackbar.message).toBe(fr.saf.decisionNotSaved)
      expect(w.emitted('resolved')).toBeFalsy()
    })
  })

  describe('bouton « Repartir de zéro »', () => {
    it('demande confirmation puis appelle runBackup avec overwriteBackup:true, acquitte, émet "resolved"', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      const w = mountIt()
      const snackbar = useSnackbarStore()

      await w.find('[data-test="prompt-start-fresh"]').trigger('click')
      await flushPromises()

      expect(confirmSpy).toHaveBeenCalledWith(fr.saf.startFreshConfirm)
      expect(backupService.runBackup).toHaveBeenCalledWith(
        expect.objectContaining({ overwriteBackup: true }),
      )
      expect(backupDecision.recordBackupDecision).toHaveBeenCalledTimes(1)
      expect(snackbar.message).toBe(fr.saf.syncDone)
      expect(w.emitted('resolved')).toBeTruthy()
    })

    it('confirmation refusée : n\'écrit rien, n\'émet pas "resolved"', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false)
      const w = mountIt()

      await w.find('[data-test="prompt-start-fresh"]').trigger('click')
      await flushPromises()

      expect(backupService.runBackup).not.toHaveBeenCalled()
      expect(backupDecision.recordBackupDecision).not.toHaveBeenCalled()
      expect(w.emitted('resolved')).toBeFalsy()
    })

    // Étape 1e (correctif revue) — CE TEST S'INVERSE : avant, l'écriture
    // réussie sans acquittement laissait le bandeau OUVERT (`resolved` PAS émis),
    // pour permettre de « réessayer » — mais chaque nouvel essai réécrivait le
    // dossier en entier, un coût inutile pour un simple problème d'acquittement.
    // Le correctif ferme désormais le bandeau dans tous les cas où l'ÉCRITURE a
    // réussi : `saf.decisionNotSaved` a déjà prévenu, les Réglages permettent de
    // reprendre l'acquittement seul (sans réécrire tout le dossier).
    it("l'écriture réussit mais l'acquittement échoue (decided:false) → saf.decisionNotSaved, émet quand même resolved (étape 1e)", async () => {
      backupDecision.recordBackupDecision.mockResolvedValue(false)
      const w = mountIt()
      const snackbar = useSnackbarStore()

      await w.find('[data-test="prompt-start-fresh"]').trigger('click')
      await flushPromises()

      expect(snackbar.message).toBe(fr.saf.decisionNotSaved)
      expect(w.emitted('resolved')).toBeTruthy()
    })

    it("runBackup échoue (permission perdue) : message dédié, decision jamais posée, bandeau reste ouvert", async () => {
      backupService.runBackup.mockResolvedValue({ ok: false, skipped: 'permission' })
      const w = mountIt()
      const snackbar = useSnackbarStore()

      await w.find('[data-test="prompt-start-fresh"]').trigger('click')
      await flushPromises()

      expect(snackbar.message).toBe(fr.saf.syncFailedPermission)
      expect(backupDecision.recordBackupDecision).not.toHaveBeenCalled()
      expect(w.emitted('resolved')).toBeFalsy()
    })

    // Étape 1d : un échec d'écriture (permission perdue, disque plein…) alors que
    // le cas était NOMINAL (canRestore vrai, pas de « Plus tard » au départ) ne doit
    // JAMAIS murer l'app — une sortie doit apparaître.
    it.each([
      [{ ok: false, skipped: 'permission' }, 'permission perdue'],
      [{ ok: false, error: 'disque plein' }, 'échec générique (disque plein)'],
    ])('%o (%s) : le bouton « Plus tard » apparaît même si canRestore était vrai', async (result) => {
      restoreService.isDbRestorable.mockResolvedValue(true) // cas nominal au départ
      backupService.runBackup.mockResolvedValue(result)
      const w = mountIt()
      await flushPromises()
      expect(w.find('[data-test="later"]').exists()).toBe(false) // pas encore, avant l'échec

      await w.find('[data-test="prompt-start-fresh"]').trigger('click')
      await flushPromises()

      expect(w.find('[data-test="later"]').exists()).toBe(true)
    })
  })

  // (lot du 06/08/2026). Le 06/08 au matin, ce bandeau a annoncé « Une sauvegarde
  // t'attend » sur le téléphone d'une utilisatrice réelle : rien n'y disait ce qu'était
  // cette sauvegarde ni d'où elle venait, et personne n'a su s'il fallait restaurer.
  // Les Réglages savent le dire désormais ; ici, c'est le moment où l'on décide
  // VRAIMENT.
  //
  // ⚠️ Les phrases sont comparées à `element.textContent`, jamais à `w.html()` :
  // l'embellisseur de @vue/test-utils réinsère des retours à la ligne DANS les nœuds de
  // texte longs, et une assertion écrite contre `html()` meurt alors sans le moindre
  // signal (mesuré : la contre-épreuve n'avait fait rougir qu'un test sur
  // quatre). Les égalités sont COMPLÈTES : vue-i18n interpole un paramètre manquant en
  // chaîne VIDE, jamais en `{date}` — le symptôme à attraper est un blanc là où un mot
  // est attendu, pas une accolade visible.
  describe("la fiche d'identité de la sauvegarde, dans le bandeau", () => {
    const ecritLe = '2026-08-06T05:15:18.402Z'
    const date = new Date(ecritLe).toLocaleString()
    const contenu = { projets: 6, patrons: 9, laines: 31 }

    const textOf = (w, sel) => w.find(sel).element.textContent.trim()

    it('fiche de cet appareil : la date et le conseil « ta propre sauvegarde »', async () => {
      backupOrigin.describeOrigin.mockResolvedValue({ origin: 'self', manifest: { ecritLe, contenu } })
      const w = mountIt()
      await flushPromises()

      expect(textOf(w, '[data-test="origin"]')).toBe(i18n.global.t('saf.originThisDevice', { date }))
      expect(textOf(w, '[data-test="origin"]')).toContain(date) // la date EST arrivée
      expect(textOf(w, '[data-test="advice"]')).toBe(fr.saf.adviceThisDevice)
    })

    // MIGRATION (base restaurable) : restaurer aboutira, donc le conseil est là.
    it("fiche d'un autre appareil nommé, base restaurable : modèle, date, et le conseil « restaure »", async () => {
      restoreService.isDbRestorable.mockResolvedValue(true)
      backupOrigin.describeOrigin.mockResolvedValue({
        origin: 'other',
        manifest: { ecritLe, modeleAppareil: 'LYA-L29' },
      })
      const w = mountIt()
      await flushPromises()

      expect(textOf(w, '[data-test="origin"]')).toBe(
        i18n.global.t('saf.originOtherDevice', { model: 'LYA-L29', date }),
      )
      expect(textOf(w, '[data-test="advice"]')).toBe(fr.saf.adviceOtherDevice)
    })

    // DOSSIER PARTAGÉ (base NON restaurable). Le conseil ne dit plus « restaure » — qui
    // contredisait le message juste au-dessus et menait à une porte fermée (`runRestore`
    // refuse sur du travail réel) — mais il ne se TAIT pas non plus : il nomme le remède
    // (correctif de revue, 07/08). C'est le seul écran où l'utilisatrice décide, et le
    // panneau lui offrait jusqu'ici deux boutons dont aucun ne règle son problème.
    it("fiche d'un autre appareil, base NON restaurable : le conseil nomme le remède", async () => {
      restoreService.isDbRestorable.mockResolvedValue(false)
      backupOrigin.describeOrigin.mockResolvedValue({
        origin: 'other',
        manifest: { ecritLe, modeleAppareil: 'LYA-L29' },
      })
      const w = mountIt({ pauseReason: 'other-device' })
      await flushPromises()

      expect(textOf(w, '[data-test="advice"]')).toBe(fr.saf.adviceOtherDeviceBlocked)
      expect(w.find('#bdp-body').element.textContent.trim()).toBe(fr.saf.otherDeviceBlocked)
      expect(textOf(w, '[data-test="origin"]')).toBe(
        i18n.global.t('saf.originOtherDevice', { model: 'LYA-L29', date }),
      )
    })

    // ⚠️ LA SONDE LÈVE — le cas où les deux écrans se contredisaient (correctif de revue,
    // 07/08). Le bandeau retombait sur `canRestore = true`, un repli conçu pour un BOUTON,
    // et conseillait donc « restaure tes données » sans rien savoir ; les Réglages, eux, ne
    // disaient rien. Le test JUMEAU est dans saf-folder-section.spec.js — les deux doivent
    // conclure la même chose, c'est la garantie centrale du module partagé.
    //
    // ⚠️ Une assertion d'ABSENCE est la plus facile à rendre vacueuse : si le composant ne
    // montait pas, elle serait verte pour la mauvaise raison. Les assertions POSITIVES qui
    // l'encadrent (la phrase d'origine, épinglée au mot près, et le panneau lui-même)
    // prouvent que l'écran a bien rendu ce qu'il devait rendre.
    it('sonde en échec : AUCUN conseil — le repli permissif du bouton ne doit pas conseiller', async () => {
      restoreService.isDbRestorable.mockRejectedValue(new Error('base illisible'))
      backupOrigin.describeOrigin.mockResolvedValue({
        origin: 'other',
        manifest: { ecritLe, modeleAppareil: 'LYA-L29' },
      })
      const w = mountIt({ pauseReason: 'other-device' })
      await flushPromises()

      expect(w.find('[data-test="advice"]').exists()).toBe(false)
      expect(textOf(w, '[data-test="origin"]')).toBe(
        i18n.global.t('saf.originOtherDevice', { model: 'LYA-L29', date }),
      )
      // Le BOUTON, lui, garde son repli permissif : pas de « Plus tard » pour la seule
      // raison que la sonde a levé. C'est la dissociation même des deux usages qui est
      // mesurée ici — sans cette ligne, ramener le conseil sur `canRestore` resterait
      // possible dans l'autre sens.
      expect(w.vm.canLeave).toBe(true) // ...mais vrai ici, par la raison « autre appareil »
      expect(w.find('[data-test="backup-decision-prompt"]').exists()).toBe(true)
    })

    // Correctif de revue (07/08) : `aria-describedby` ne désignait que le premier
    // paragraphe. L'origine et le conseil — l'objet même de cette tâche — n'étaient pas
    // dans la description accessible du dialogue. On vérifie que les identifiants cités
    // EXISTENT réellement dans le DOM : citer un identifiant absent est sans effet, et
    // l'assertion sur le seul attribut ne l'aurait pas vu.
    it('aria-describedby couvre les trois paragraphes, et ils existent tous', async () => {
      restoreService.isDbRestorable.mockResolvedValue(true)
      backupOrigin.describeOrigin.mockResolvedValue({
        origin: 'other',
        manifest: { ecritLe, modeleAppareil: 'LYA-L29' },
      })
      const w = mountIt()
      await flushPromises()

      const ids = w.find('[role="dialog"]').attributes('aria-describedby').split(' ')
      expect(ids).toEqual(['bdp-body', 'bdp-origin', 'bdp-advice'])
      expect(ids.map((id) => w.find(`#${id}`).element.textContent.trim())).toEqual([
        fr.saf.backupPaused,
        i18n.global.t('saf.originOtherDevice', { model: 'LYA-L29', date }),
        fr.saf.adviceOtherDevice,
      ])
    })

    // Sans conseil affiché, l'identifiant absent n'est PAS cité — sinon l'attribut
    // promettrait une description que le DOM ne porte pas.
    it('aria-describedby ne cite pas le conseil quand il n’y en a pas', async () => {
      backupOrigin.describeOrigin.mockResolvedValue({ origin: 'unknown', manifest: null })
      const w = mountIt()
      await flushPromises()

      expect(w.find('[role="dialog"]').attributes('aria-describedby')).toBe('bdp-body bdp-origin')
      expect(w.find('#bdp-advice').exists()).toBe(false)
    })

    // LA règle du lot : on ne conseille que lorsqu'on sait. Le FAIT reste dit (« écrite
    // par une version antérieure »), le conseil disparaît — conseiller à l'aveugle
    // enverrait quelqu'un écraser la sauvegarde qui était justement la bonne.
    // Contre-épreuve exigée : rendre le conseil inconditionnel dans le
    // composant doit faire rougir CE test.
    it('origine inconnue : le fait est dit, AUCUN conseil affiché', async () => {
      backupOrigin.describeOrigin.mockResolvedValue({ origin: 'unknown', manifest: null })
      const w = mountIt()
      await flushPromises()

      expect(textOf(w, '[data-test="origin"]')).toBe(fr.saf.originUnknown)
      expect(w.find('[data-test="advice"]').exists()).toBe(false)
    })

    // Repli : le stockage n'a pas pu être obtenu (`getBackupStorage` n'a AUCUN filet, cf.
    // App.vue). Le bandeau doit rester debout et muet sur l'origine plutôt que de
    // conseiller sur une lecture qui n'a pas eu lieu.
    it('getBackupStorage() lève : le bandeau tient, et ne conseille rien', async () => {
      backupService.getBackupStorage.mockRejectedValue(new Error('SAF HS'))
      const w = mountIt()
      await flushPromises()

      expect(w.find('[data-test="backup-decision-prompt"]').exists()).toBe(true)
      expect(w.find('[data-test="advice"]').exists()).toBe(false)
      expect(textOf(w, '[data-test="origin"]')).toBe(fr.saf.originUnknown)
    })
  })

  // La RAISON de la pause, transmise par App.vue. Le câblage bout-en-bout est
  // couvert par tests/unit/App.restore-offer.spec.js ; ici, le contrat de la propriété.
  describe("raison « un autre appareil a écrit » (propriété pauseReason)", () => {
    it('sans propriété : le message reste celui d’origine (défaut « no-decision »)', async () => {
      const w = mountIt()
      await flushPromises()
      expect(w.find('#bdp-body').element.textContent.trim()).toBe(fr.saf.backupPaused)
    })

    // ⚠️ On compare la phrase ENTIÈRE, pas un `toContain('autre appareil')` : la phrase
    // d'origine (`saf.originOtherUnnamed`) contient elle aussi ces deux mots, et une
    // assertion partielle passerait au vert sur le mauvais paragraphe. L'origine est
    // laissée à `unknown` ici pour que la confusion soit impossible.
    it('pauseReason "other-device" : le corps DIT qu’un autre appareil a écrit', async () => {
      const w = mountIt({ pauseReason: 'other-device' })
      await flushPromises()
      expect(w.find('#bdp-body').element.textContent.trim()).toBe(fr.saf.otherDeviceBlocked)
      expect(w.find('#bdp-body').element.textContent).not.toContain(fr.saf.backupPaused)
    })

    // LE test qui décide de la condition ajoutée à `canLeave`. `isDbRestorable` vaut VRAI
    // exprès : dans le cas contraire (`false`), `canLeave` est déjà vrai par `!canRestore`
    // et l'assertion passerait sans que la nouvelle condition existe — elle ne prouverait
    // RIEN. Le cas est réel : elle a rempli un dossier vide (la décision a donc été
    // enregistrée toute seule), sa base n'a encore que les exemples semés, et la
    // sauvegarde de son ancien téléphone arrive dans le dossier par Syncthing.
    // Pourquoi une sortie est nécessaire : aucun des deux boutons ne règle un conflit à
    // deux appareils — « Restaurer » lance un va-et-vient sans fin, « Repartir de zéro »
    // détruit la sauvegarde de l'autre appareil. Le vrai remède, changer de dossier, est
    // dans les Réglages, inatteignables derrière un bandeau bloquant.
    it('pauseReason "other-device" AVEC restauration possible : « Plus tard » est quand même offert', async () => {
      restoreService.isDbRestorable.mockResolvedValue(true)
      const w = mountIt({ pauseReason: 'other-device' })
      await flushPromises()

      expect(w.find('[data-test="later"]').exists()).toBe(true)
      expect(w.vm.canLeave).toBe(true)
    })

    it('pauseReason "other-device" AVEC restauration impossible : « Plus tard » est offert aussi', async () => {
      restoreService.isDbRestorable.mockResolvedValue(false)
      const w = mountIt({ pauseReason: 'other-device' })
      await flushPromises()

      expect(w.find('#bdp-body').element.textContent.trim()).toBe(fr.saf.otherDeviceBlocked)
      expect(w.find('[data-test="later"]').exists()).toBe(true)
    })

    // Le cas nominal n'a PAS bougé : la propriété ne doit pas ouvrir une porte là où
    // l'avenant en interdit une. Sans ce test, `canLeave` pourrait devenir vrai partout.
    it('pauseReason "no-decision" avec restauration possible : toujours AUCUNE sortie', async () => {
      restoreService.isDbRestorable.mockResolvedValue(true)
      const w = mountIt({ pauseReason: 'no-decision' })
      await flushPromises()

      expect(w.find('[data-test="later"]').exists()).toBe(false)
      expect(w.vm.canLeave).toBe(false)
    })
  })
})
