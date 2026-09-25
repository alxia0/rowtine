// Helpers e2e Rowtine.
// Note isolation : Playwright crée un contexte navigateur neuf par test → IndexedDB
// (Dexie) repart vide à chaque test, sans purge manuelle. Pas de fuite d'état entre tests.

import { expect } from '@playwright/test'

// Un PNG 1×1 transparent en data URL, pour le seam caméra (src/utils/photo.js).
export const FAKE_PHOTO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

// Écrit une clé de la table `settings` directement dans IndexedDB (contournement délibéré
// de l'UI, cf. le commentaire de `completeOnboarding` ci-dessous pour la raison de
// `swipeHintSeen`). On interroge IndexedDB directement (pas d'import du module app : les
// chemins sont hashés sous `vite preview`), comme le faisait l'ancien
// `waitForSwipeHintPersisted` qu'elle remplace (pop-ups du premier lancement, 10/08/2026 —
// cf. plus bas pourquoi cette dernière a disparu). La promesse ne se résout qu'à
// `tx.oncomplete` : l'écriture a RÉELLEMENT touché le disque quand l'appelante rend la
// main, pas seulement été mise en file. Exportée (au-delà de `swipeHintSeen`, son seul
// usage initial) pour semer `welcomeDue` dans les tests de la visite guidée
// (tests/e2e/visite-guidee.spec.js).
export async function writeSetting(page, key, value) {
  await page.evaluate(
    ({ key, value }) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('rowtine')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          try {
            const tx = db.transaction('settings', 'readwrite')
            tx.objectStore('settings').put({ key, value })
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
          } catch (e) {
            reject(e)
          } finally {
            db.close()
          }
        }
      }),
    { key, value },
  )
}

// Lit une clé de la table `settings` directement dans IndexedDB — même raison que
// `writeSetting` (pas d'import du module app sous `vite preview`), mais en LECTURE :
// sert à attendre qu'un réglage cliqué dans l'UI ait RÉELLEMENT atteint le disque avant un
// `page.goto()` qui recharge l'app. `saveTheme()` (stores/settings.js) met `theme.value` à
// jour de façon SYNCHRONE puis persiste en IndexedDB de façon ASYNCHRONE : un
// `page.goto()` lancé entre les deux réutilise le réglage encore ANCIEN au rechargement (la
// persistance n'a pas eu le temps d'aboutir), alors même que l'attribut `data-theme` du DOM,
// lui, a déjà changé — un piège que `expect.poll` sur `data-theme` seul ne voit pas.
export async function readSetting(page, key) {
  return page.evaluate(
    (key) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('rowtine')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('settings', 'readonly')
          const getReq = tx.objectStore('settings').get(key)
          getReq.onsuccess = () => {
            resolve(getReq.result ? getReq.result.value : undefined)
            db.close()
          }
          getReq.onerror = () => {
            reject(getReq.error)
            db.close()
          }
        }
      }),
    key,
  )
}

// Sème directement dans IndexedDB (table `sessions`, contournement délibéré de l'UI — même
// raison que `writeSetting` : pas d'import du module app sous `vite preview`) quatre
// séances sur quatre jours DISTINCTS récents, une par niveau de la grille calendaire
// (< 30 min, 30 min–1 h, 1–2 h, ≥ 2 h). Les dates sont calculées CÔTÉ NAVIGATEUR (pas côté
// Node) pour rester dans le même fuseau que celui qui lira ensuite ces séances via
// `ymdLocal(new Date(session.date))` — un jour par séance, jamais le même, sinon deux
// niveaux s'additionneraient dans une seule case au lieu de rester distincts.
// À appeler après `completeOnboarding` (la base `rowtine` doit déjà exister) et avant tout
// `page.goto('/stats')` : StatsView ne relit les séances qu'à son montage.
export async function seedHeatmapSessions(page) {
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('rowtine')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          try {
            const tx = db.transaction('sessions', 'readwrite')
            const store = tx.objectStore('sessions')
            // Ordre des niveaux : 10 min (1), 40 min (2), 90 min (3), 150 min (4) — un jour
            // en arrière par séance pour ne jamais superposer deux niveaux le même jour.
            const durations = [600, 2400, 5400, 9000]
            durations.forEach((durationSec, i) => {
              const d = new Date()
              d.setHours(12, 0, 0, 0)
              d.setDate(d.getDate() - (i + 1))
              store.add({ projectId: 1, sectionId: null, date: d.toISOString(), durationSec, rowsDone: 0 })
            })
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
          } catch (e) {
            reject(e)
          } finally {
            db.close()
          }
        }
      }),
  )
}

// Sème directement en base (contournement délibéré de l'UI, même raison que ci-dessus) un
// projet de CROCHET, sans aucune séance. Depuis le 11/08 (filtre tricot/crochet masqué s'il n'y a
// pas les deux techniques) : `seedHeatmapSessions`/`completeOnboarding` seuls ne créent que des
// projets de TRICOT (technique par défaut) — un test qui veut mesurer le sélecteur technique
// (2e groupe `.toggle`) a donc besoin d'un témoin de l'AUTRE technique pour qu'il existe encore
// à l'écran. `showTechniqueFilter` (stats-grid.js) ne lit que la liste de projets, jamais les
// séances : nul besoin d'en semer une pour que le sélecteur apparaisse.
export async function seedCrochetProject(page) {
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('rowtine')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          try {
            const tx = db.transaction('projects', 'readwrite')
            tx.objectStore('projects').add({ name: 'Témoin crochet', technique: 'crochet', status: 'wip' })
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
          } catch (e) {
            reject(e)
          } finally {
            db.close()
          }
        }
      }),
  )
}

// Sème une matière RICHE pour les captures d'écran de l'écran Statistiques (finitions du
// guide, §5.3) : contrairement à `seedHeatmapSessions` ci-dessus (4 séances sur 4 jours,
// pensée pour un test de couleur), il faut ici UNE ANNÉE de séances, parce que le guide montre
// désormais aussi la fenêtre Année (53 colonnes) — la version précédente de cette fonction,
// taillée pour Trimestre (24 séances sur 74 jours), y laissait les quatre cinquièmes de la
// grille vides.
//
// ⛔ « Remplie » ne veut PAS dire 365 jours sur 365 : une année sans repos donne un bloc de
// couleur uniforme (les cinq niveaux ne veulent plus rien dire) et une « Série en cours » de
// 365 jours, invraisemblable sur une image publique. Le rythme semé est donc celui d'une
// tricoteuse régulière mais humaine :
//  - ENVIRON UN JOUR DE REPOS PAR SEMAINE, mais qui DÉRIVE d'une semaine à l'autre (dernière
//    case des profils ci-dessous, lue par un `k` décalé — cf. `DECALAGE`). 🔴 Sa première version
//    le figeait sur `daysAgo % 7`, constant pour un jour de la semaine donné : la grille, dont
//    les 7 lignes SONT les jours de la semaine, portait alors une rangée entièrement blanche sur
//    52 semaines, et l'onglet Rythme affichait « Jeu. — ». Chiffres justes, motif fabriqué :
//    personne ne se repose exactement le même jour 52 fois de suite. Corrigé le 12/08 en ouvrant
//    l'image, comme les bandes horizontales la veille.
//    ⚠️ Tout est en arithmétique de `daysAgo` : la structure ne dépend PAS du jour où tourne le
//    test. La série en cours vaut 6 jours quel que soit ce jour (mesuré sur les 7 cas).
//  - trois semaines de SPRINT (un cadeau à finir) et une deuxième plus loin dans l'année ;
//  - une SEMAINE CHARGÉE (3 jours seulement, très courts) et trois semaines CALMES ;
//  - 17 jours de VACANCES quasi vides, avec deux petites séances de voyage ;
//  - quelques jours de repos ISOLÉS, posés sur des modulos premiers entre eux, pour que la
//    grille ne ressemble pas à un papier peint régulier ;
//  - quatre jours à DEUX séances (matin + soir) : elles s'additionnent dans une seule case,
//    c'est voulu ici (aucun niveau précis n'est attendu ces jours-là) ;
//  - 🔑 une SECOUSSE de ± 1 niveau, en deux temps (par semaine, puis par jour) — détaillée plus
//    bas, à l'endroit où elle est appliquée. Sans elle, l'image de l'année lue à l'œil le 11/08
//    partait en BANDES HORIZONTALES presque unies : un profil de semaine seul rend chaque ligne
//    (= un jour de la semaine) de la même couleur sur 53 colonnes, ce qui se voit immédiatement
//    comme fabriqué.
// Mesuré le 12/08 (après la dérive du jour de repos) : 274:20:06 sur l'année
// (280 jours actifs sur 367), 72:30:06 sur le trimestre — l'ordre de grandeur des vraies données
// d'une utilisatrice réelle (75:13:00) — 58:47 de moyenne par jour actif, meilleur jour à 2:30:00, série en cours
// 6 jours, record 21 jours, et les cinq niveaux de couleur tous largement représentés
// (87 cases vides, 85 / 86 / 69 / 40 aux niveaux 1 à 4). Aucune rangée de la grille Année n'est
// vide ni pleine : entre 38 et 41 cases peintes sur 53, et chacune porte les QUATRE niveaux.
//
// `projectId` DOIT être celui d'un projet RÉEL (jamais supposé égal à 1 : l'onboarding sème déjà
// deux projets d'exemple avant qu'aucun projet créé par le parcours de capture n'existe), sinon
// la tuile « Projet le plus travaillé » resterait vide.
// Écriture directe dans IndexedDB (contournement délibéré de l'UI, même raison que
// `seedHeatmapSessions`), dates calculées CÔTÉ NAVIGATEUR pour rester dans le fuseau qui les
// relira. À appeler après `completeOnboarding` et AVANT `page.goto('/stats')` : StatsView ne
// relit les séances qu'à son montage.
// Rend le nombre de séances écrites, pour qu'un appelant puisse le contrôler.
export async function seedStatsCaptureSessions(page, projectId) {
  return page.evaluate(
    (projectId) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('rowtine')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          try {
            const tx = db.transaction('sessions', 'readwrite')
            const store = tx.objectStore('sessions')
            const addOn = (daysAgo, durationSec) => {
              const d = new Date()
              d.setHours(12, 0, 0, 0)
              d.setDate(d.getDate() - daysAgo)
              store.add({ projectId, sectionId: null, date: d.toISOString(), durationSec, rowsDone: 0 })
            }
            // Les 4 niveaux (10 min, 40 min, 1 h 30, 2 h 30) déjà utilisés par
            // `seedHeatmapSessions`, réutilisés TELS QUELS pour rester cohérent avec le test qui
            // les a validés contre l'échelle de couleur (seuils 30 min / 1 h / 2 h).
            const NIVEAUX = [0, 600, 2400, 5400, 9000] // index 1..4 = les 4 niveaux, 0 = repos
            // Un profil de semaine = 7 NIVEAUX (indices dans `NIVEAUX`), lus par un `k` DÉCALÉ
            // (voir `DECALAGE` plus bas, sans quoi `k = daysAgo % 7` désignerait toujours le même
            // jour de la semaine). La dernière case (0) est le jour de repos hebdomadaire ; un 0
            // vaut « pas de séance ».
            const SEMAINE = [3, 2, 3, 1, 2, 1, 0] // ≈ 5 h 15 par semaine
            const SPRINT = [4, 3, 4, 3, 3, 3, 0] // ≈ 11 h 10, un cadeau à finir
            const CALME = [2, 0, 3, 0, 1, 0, 0] // ≈ 2 h 20, trois jours seulement
            const CHARGEE = [1, 0, 0, 1, 0, 1, 0] // ≈ 30 min, une semaine sans temps
            // 386 jours semés (de 0 à 385 jours en arrière) : la fenêtre Année couvre 53 semaines
            // ENTIÈRES, dont la plus ancienne commence jusqu'à 370 jours en arrière (364 + le rang
            // du jour courant dans sa semaine). Semer moins laisserait la colonne de gauche
            // partiellement vide selon le jour où le test tourne.
            const DERNIER_JOUR = 385
            // Les jours au-delà de 370 ne sont VISIBLES dans aucune fenêtre : ils ne servent qu'à
            // donner un passé à la tuile « Plus longue série », dont le sous-titre affiche le
            // record de TOUTE l'histoire. Sans eux, le record valait 6 comme la série de la
            // fenêtre et la tuile affichait deux fois le même nombre — le sous-titre n'apprenait
            // plus rien (même forme de défaut que la plage de dates affichée deux fois, 10/08).
            // D'où une poussée SANS repos ici (il y a plus d'un an), qui donne un record de 21
            // jours d'affilée là où la série en cours en vaut 6 : deux nombres différents, donc
            // un sous-titre qui apprend quelque chose. (Mesuré : 21/6 pour les sept jours de
            // semaine possibles du test.)
            const RECORD_DEBUT = 371
            // 🔑 LE JOUR DE REPOS DÉRIVE. `daysAgo % 7` est CONSTANT pour un jour de la semaine
            // donné : la case 0 des profils tombait donc toujours sur la même LIGNE de la grille,
            // qui restait entièrement blanche sur 52 semaines (vu à l'image le 11/08 — « Jeu. — »
            // jusque dans l'onglet Rythme). Personne ne se repose exactement le même jour 52 fois
            // de suite : c'est la même classe de défaut que les bandes horizontales corrigées plus
            // bas, des chiffres justes qui composent un motif fabriqué.
            // ⛔ Pas une formule linéaire (`semaine * n % 7`) : le pas serait CONSTANT et la ligne
            // blanche deviendrait une DIAGONALE régulière — le même défaut tourné de 45°.
            // ⇒ une table EXPLICITE (relue hors ligne, comme les listes d'exceptions du guide),
            // longue de 19 — premier avec 7 ET avec 53 — donc le motif ne se referme jamais dans
            // la fenêtre Année. Ses écarts successifs modulo 7 prennent 5 valeurs distinctes et
            // ne se répètent jamais plus de 3 semaines de suite.
            const DECALAGE = [0, 2, 5, 1, 4, 6, 3, 0, 4, 2, 6, 1, 5, 3, 6, 2, 0, 5, 1]
            // Quatre semaines SANS aucun repos hebdomadaire (elle a tricoté les sept jours). Avec
            // les repos isolés plus bas, qui en ajoutent parfois un second, une colonne de la
            // grille porte 0, 1 ou 2 jours clairs — mesuré : ~7 colonnes à 0, ~19 à 1, ~13 à 2.
            // ⚠️ N'agit QUE sur la case de repos des profils SEMAINE/SPRINT (`k === 6`) : appliqué
            // à CALME ou CHARGEE, il boucherait les trois ou quatre trous qui FONT la semaine
            // calme, et effacerait ce qui a déjà été validé.
            const SANS_REPOS = [4, 17, 29, 44]
            let seances = 0
            for (let daysAgo = 0; daysAgo <= DERNIER_JOUR; daysAgo++) {
              const semaine = Math.floor(daysAgo / 7)
              const k = (daysAgo + DECALAGE[semaine % DECALAGE.length]) % 7
              // `true` seulement pour les branches à repos hebdomadaire unique (SEMAINE/SPRINT).
              let reposHebdo = false
              let niveau
              if (daysAgo >= 154 && daysAgo <= 170) {
                // Vacances : rien, sauf deux petites séances de voyage. ⚠️ Ces deux jours-là ne
                // dépendent PAS de `k` — le décalage ne peut donc pas les déplacer. Ce qui les
                // protège, c'est de tomber hors des deux modulos de repos isolé ci-dessous
                // (vérifié : 159 et 165 ne valent ni 11 mod 31 ni 20 mod 43) ; mesuré le 11/08,
                // `166` était effacé par le modulo 31.
                niveau = daysAgo === 159 || daysAgo === 165 ? 1 : 0
              } else if (daysAgo >= RECORD_DEBUT) {
                niveau = SEMAINE[k] || 1 // aucun repos : le record
              } else if (daysAgo >= 21 && daysAgo <= 41) {
                niveau = SPRINT[k]
                reposHebdo = true
              } else if (daysAgo >= 56 && daysAgo <= 62) {
                niveau = CHARGEE[k]
              } else if (daysAgo >= 91 && daysAgo <= 111) {
                niveau = CALME[k]
              } else if (daysAgo >= 210 && daysAgo <= 230) {
                niveau = SPRINT[k]
                reposHebdo = true
              } else {
                niveau = SEMAINE[k]
                reposHebdo = true
              }
              if (niveau === 0 && reposHebdo && k === 6 && SANS_REPOS.includes(semaine)) niveau = 1
              // La secousse, en deux temps, bornée à 1..4. ⚠️ Jamais appliquée à un jour de repos
              // (`niveau > 0`) : elle le boucherait, et le rythme de repos disparaîtrait.
              //  - un décalage par SEMAINE (−1, 0, +1 en boucle de trois) : toute la colonne monte
              //    ou descend d'un cran, ce qui donne une ondulation lente d'une semaine à l'autre ;
              //  - une secousse par JOUR (deux jours sur cinq), de période 5, première avec celle
              //    des lignes (7) : le motif ne se referme qu'au bout de 35 jours.
              // 🔑 Les DEUX sont nécessaires. Mesuré à l'image le 11/08 : avec la secousse
              // journalière seule, les lignes de base 4 et de base 1 restaient quasi UNIES (le
              // bornage à 1..4 renvoie toujours sur la même valeur), et l'année se lisait comme des
              // bandes horizontales fabriquées. Avec les deux, chaque ligne porte les 4 niveaux.
              if (niveau > 0) {
                let ecart = (semaine % 3) - 1
                const secousse = (daysAgo * 3 + semaine) % 5
                if (secousse === 0) ecart += 1
                else if (secousse === 1) ecart -= 1
                niveau = Math.max(1, Math.min(4, niveau + ecart))
              }
              const jour = niveau > 0 ? [NIVEAUX[niveau]] : []
              // Repos isolés : deux modulos premiers entre eux, pour des trous irréguliers. Bornés
              // aux jours VISIBLES, pour ne pas trouer la poussée qui porte le record.
              if (daysAgo < RECORD_DEBUT && (daysAgo % 31 === 11 || daysAgo % 43 === 20)) jour.length = 0
              // Quatre jours à deux séances (matin + soir) : elles s'additionnent dans la case.
              if (jour.length && (daysAgo === 7 || daysAgo === 35 || daysAgo === 70 || daysAgo === 133))
                jour.push(NIVEAUX[2])
              for (const durationSec of jour) {
                addOn(daysAgo, durationSec)
                seances += 1
              }
            }
            tx.oncomplete = () => resolve(seances)
            tx.onerror = () => reject(tx.error)
          } catch (e) {
            reject(e)
          } finally {
            db.close()
          }
        }
      }),
    projectId,
  )
}

// Définit la photo que pickImage() renverra, sur le DOCUMENT COURANT (déterministe : pas de
// dépendance au timing d'addInitScript vs navigations SPA). À appeler juste avant l'action
// « Ajouter une photo », une fois la page chargée. Passer null simule une annulation.
export async function setCameraPhoto(page, dataUrl = FAKE_PHOTO) {
  await page.evaluate((url) => {
    window.__E2E_PHOTO__ = url
  }, dataUrl)
}

// Déroule l'onboarding via l'UI et atterrit sur l'accueil.
// technique: 'knitting' | 'crochet'
// messages : JSON i18n de la langue à utiliser pour les libellés (src/i18n/<langue>.json).
// Par défaut ABSENT : les 4 littéraux français ci-dessous restent inchangés — la suite e2e
// existante (163 tests au 18/07/2026, 187 au 04/08/2026 — snapshot daté, pas un invariant à
// maintenir ici) asserte des libellés français et ne doit pas être touchée
// par le paramétrage par langue introduit pour tests/e2e/_captures-guide.spec.js (écran
// « À propos »). Ne passer `messages` que depuis ce générateur-là.
export async function completeOnboarding(page, { firstName = 'Alex', technique = 'knitting', messages = null, theme = null } = {}) {
  const m = messages
  await page.goto('/')
  // La garde de route renvoie sur l'onboarding au 1er lancement.
  const welcome = m ? m.onboarding.welcome : 'Bienvenue sur Rowtine'
  await expect(page.getByRole('heading', { name: welcome })).toBeVisible()

  if (firstName) await page.locator('#fn').fill(firstName)
  const techniqueLabel = m ? (technique === 'crochet' ? m.onboarding.crochet : m.onboarding.knitting) : technique === 'crochet' ? 'Crochet' : 'Tricot'
  await page.getByRole('button', { name: techniqueLabel, exact: true }).click()

  // Thème explicite, demandé uniquement par les générateurs de captures (mode sombre,
  // 08/08). Défaut `null` = aucun clic : les ~190 tests e2e existants ne changent pas d'un
  // iota. Le sélecteur d'apparence de l'onboarding persiste le choix immédiatement
  // (OnboardingView.setTheme), donc l'écran suivant est déjà dans le bon thème.
  if (theme === 'dark' || theme === 'light') {
    const libelleTheme = m ? m.theme[theme] : theme === 'dark' ? 'Sombre' : 'Clair'
    await page.getByRole('button', { name: libelleTheme, exact: true }).click()
  }

  const cta = m
    ? technique === 'crochet'
      ? m.onboarding.startCrochet
      : m.onboarding.startKnitting
    : technique === 'crochet'
      ? /Commence à crocheter/
      : /Commence à tricoter/
  await page.getByRole('button', { name: cta }).click()

  // On arrive sur l'accueil (le seed des exemples est tolérant aux erreurs).
  await expect(page).toHaveURL(/\/$|\/#?$/)
  // Le 1er mot de `home.hello`/`helloNeutral` (« Bonjour {name} ! ») suffit à identifier le
  // titre dans toute langue, sans dépendre du prénom saisi.
  const helloWord = m ? m.home.hello.split(/[{\s]/)[0] : 'Bonjour'
  const helloHeading = new RegExp(helloWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  await expect(page.getByRole('heading', { name: helloHeading })).toBeVisible()

  // DEUX POP-UPS DE PREMIER LANCEMENT (pop-ups du premier lancement, 10/08/2026),
  // deux traitements différents — ne pas les confondre en réintroduisant un clic générique
  // ici.
  //
  // 1) La BIENVENUE de l'accueil (onboarding.welcomeTitle/welcomeStart) : rien à faire ici.
  // Elle n'est posée QUE par la porte du dossier SAF (OnboardingFolderPrompt.vue::
  // onChooseNow → settingsStore.setWelcomeDue()), un flux NATIF UNIQUEMENT
  // (Capacitor.isNativePlatform()) — sur le web, terrain de cette suite Playwright, la
  // porte ne s'affiche jamais (cf. tests/e2e/onboarding-folder.spec.js) et `welcomeDue`
  // reste donc à `false` pour toute la session : la bienvenue est structurellement
  // inatteignable ici, vérifié par une exécution (page snapshot de l'accueil sans aucun
  // `dialog`). Sa couverture vit en unitaire (tests/unit/home-welcome-popup.spec.js). Le
  // seul test e2e qui exerce vraiment le flux de bienvenue est
  // tests/e2e/onboarding.spec.js (via un parcours manuel, hors de ce helper) — SI la porte
  // devient un jour observable sur le web, la traverser par un clic y sera la bonne
  // stratégie, comme une utilisatrice réelle, et non la contourner.
  //
  // 2) L'ASTUCE de navigation (FirstDetailTip.vue, ex-astuce d'accueil) : montrée à la
  // PREMIÈRE visite d'un projet, de la Bibliothèque ou du Stock — décision produit du
  // 19/08/2026, elle a quitté la fiche patron entre-temps — l'écran variant d'un test à
  // l'autre, elle peut surgir n'importe où dans un scénario et avaler le clic suivant
  // (voile plein écran `.cfd__scrim`). Contrairement à la bienvenue, elle EST atteignable
  // sur le web (swipeHintSeen=false sur une IndexedDB fraîche à chaque test) — mais la
  // traverser « comme une utilisatrice réelle » n'a plus de point d'entrée unique à câbler
  // ici : on sème donc `swipeHintSeen: true` directement, pour qu'elle ne s'invite jamais
  // au milieu d'un scénario qui ne l'attend pas. Le rechargement qui suit n'est pas
  // cosmétique : `router.beforeEach` (router/index.js) n'appelle `settings.load()` qu'une
  // fois par session (`if (!settings.loaded)`) — sans ce rechargement, le store Pinia déjà
  // en mémoire garderait `swipeHintSeen` à `false` malgré l'écriture IndexedDB, et
  // `FirstDetailTip` continuerait de lire cette valeur périmée au premier écran concerné.
  await writeSetting(page, 'swipeHintSeen', true)
  await page.reload()
  await expect(page.getByRole('heading', { name: helloHeading })).toBeVisible()
}

// Bibliothèque (P2) : un seul bouton « Ajouter un patron » ouvre une feuille du bas à 3
// choix (import PDF, « Importer au format Rowtine » depuis le 23/09, ajout manuel) ; les
// anciens boutons ne sont plus directement présents sur /library. À appeler avant toute
// interaction avec `.lib-import__input--pdf` / `.lib-import__input--rowtine` ou le bouton
// « Créer manuellement » de la feuille.
// `label` par défaut en FRANÇAIS : la suite e2e ordinaire tourne toujours en locale fr-FR
// (baseline `playwright.config.js`). Les générateurs de captures du site, seuls appelants en
// locale non-française, passent `m.pattern.add` explicitement — sans quoi ce clic ne trouve
// jamais son bouton dans une autre langue et bloque jusqu'au timeout du test (10 min), en
// silence (mesuré le 06/08 sur le test `en`).
export async function openAddPatternSheet(page, label = 'Ajouter un patron') {
  await page.getByRole('button', { name: label }).click()
}

// Ouvre le suivi interactif (lecteur, contexte projet) d'un patron de démo à diagramme
// (Bonnet Torsade). Reprend la navigation du test « projet : diagramme + chrono discret »
// de reader.spec.js. IDEMPOTENT : si la page est déjà sur /project/:id/read (ex. après un
// page.reload() dans le même test), ne recrée pas un second projet — se contente de
// vérifier que le diagramme est rendu — pour permettre de retrouver le MÊME projet (et
// donc son état persisté) après un rechargement.
export async function openDemoReaderWithChart(page) {
  if (/\/project\/\d+\/read/.test(page.url())) {
    await expect(page.locator('.chart').first()).toBeVisible()
    return
  }
  await page.goto('/library')
  await page.getByRole('button', { name: 'Bonnet Torsade' }).click()
  await expect(page).toHaveURL(/\/pattern\/\d+/)
  await page.getByRole('button', { name: /Créer un projet/ }).click()
  await page.locator('#name').fill('Test Twist')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/project\/\d+/)
  await page.getByRole('button', { name: /Suivre le patron/ }).click()
  await expect(page).toHaveURL(/\/project\/\d+\/read/)
  await attendreFinFondu(page)
}

// Depuis le 2026-09-01 (fondu d'entrée des écrans) : la vue montée par le routeur
// s'anime 150 ms en opacité (tokens.css `.route-fade-*`). Les tests qui MESURENT le rendu
// (contraste axe, géométrie de bandes) doivent attendre la FIN du fondu, jamais mesurer
// pendant — un contraste relu à opacité 0,4 est un contre-sens, pas un bug de l'app.
// Même philosophie que `attendreStabilite` ci-dessous (le fait observable, pas un délai
// arbitraire) : on attend qu'aucune vue montée ne porte plus de classe de transition.
// DEUX attentes enchaînées, pas une : d'abord la fin du démontage de l'écran quitté
// (le suivant n'est pas encore inséré), puis la fin du fondu du suivant — la classe
// `route-fade-enter-active` est posée DÈS l'insertion, aucune fenêtre n'échappe.
export async function attendreFinFondu(page) {
  await page.waitForFunction(() => !document.querySelector('.route-fade-leave-active'))
  await page.waitForFunction(() => !document.querySelector('.route-fade-enter-active'))
}

// Attend qu'un élément ait CESSÉ de bouger verticalement, avant de mesurer sa position.
//
// Depuis le 30/07 (src/utils/keyboard-avoidance.js), donner le focus à
// un champ de saisie déclenche un défilement ANIMÉ (`behavior: 'smooth'`) d'environ 130 ms.
// Une mesure lancée juste après le clic tombe donc au milieu de l'animation, et deux
// relevés faits dans deux allers-retours distincts (même lancés en `Promise.all`, qui ne
// les rend PAS atomiques) voient deux positions de défilement différentes.
//
// On surveille le rectangle de l'ÉLÉMENT qu'on s'apprête à mesurer, jamais `window.scrollY` :
// selon l'écran, le conteneur qui défile est le document OU une carte de dialogue (cf.
// `findScrollContainer`) — une attente sur `scrollY` serait un no-op silencieux dans le
// second cas, et le test se remettrait simplement à clignoter.
//
// ⚠️ `frames` généreux À DESSEIN : le mécanisme pose sa marge basse puis attend UNE
// `requestAnimationFrame` avant de LANCER le défilement, qui ne démarre lui-même qu'à
// l'image suivante. Il existe donc une fenêtre de ~2 images où la position est
// parfaitement stable PARCE QUE le défilement n'a pas encore commencé : un critère à
// 2 images pourrait y répondre « stabilisé » et ne rien prouver. Mesuré sur l'écran de
// correction (sonde image par image, 20 répétitions) : plateau initial ~5 images avant le
// clic, montée ~120 ms, position finale atteinte ~135 ms après le focus ; l'attente rend
// la main au bout de ~272 ms, toujours sur la position FINALE (20/20). 8 images (~130 ms)
// franchissent largement la fenêtre d'avant-démarrage, y compris quand la machine est
// chargée et que les images s'espacent. Critère « stable pendant N images » et non
// « démarre puis s'arrête » : `scrollCaretIntoView` sort sans rien faire quand le curseur
// est déjà en place (`Math.abs(delta) < 4`), un défilement peut donc n'avoir jamais lieu.
export function waitForScrollSettled(page, selector, { frames = 8, timeoutMs = 5000 } = {}) {
  return page.evaluate(
    ({ selector, frames, timeoutMs }) =>
      new Promise((resolve, reject) => {
        const debut = performance.now()
        let precedent = null
        let stables = 0
        const tick = () => {
          const el = document.querySelector(selector)
          if (!el) {
            reject(new Error(`waitForScrollSettled : « ${selector} » introuvable`))
            return
          }
          const top = el.getBoundingClientRect().top
          stables = precedent !== null && Math.abs(top - precedent) < 0.5 ? stables + 1 : 0
          precedent = top
          if (stables >= frames) {
            resolve(Math.round(performance.now() - debut))
            return
          }
          if (performance.now() - debut > timeoutMs) {
            reject(new Error(`waitForScrollSettled : « ${selector} » bouge encore après ${timeoutMs} ms`))
            return
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
    { selector, frames, timeoutMs },
  )
}
