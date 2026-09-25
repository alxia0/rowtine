// @vitest-environment jsdom
// Garde-fou de démarrage (nettoyage avant la 1.0, 13/08/2026) : une base
// IndexedDB PLUS RÉCENTE que ce que le code déclare doit se voir, jamais disparaître en
// silence. Trois cas : base plus récente (⇒ alerte), base identique (⇒ rien), aucune
// base (⇒ rien, première installation) — plus la preuve que la garde sait se déclencher
// pour de vrai, contre une base fake-indexeddb réellement ouverte (pas un mock booléen).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkVersionGuardOnStartup,
  existingIndexedDbVersion,
  expectedIndexedDbVersion,
  isDatabaseNewerThanCode,
  versionGuardState,
} from '@/db/version-guard'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_JS_PATH = path.resolve(__dirname, '../..', 'src/db/db.js')
const APP_VUE_PATH = path.resolve(__dirname, '../..', 'src/App.vue')
const ROUTER_PATH = path.resolve(__dirname, '../..', 'src/router/index.js')
const LOCALES = ['fr', 'en', 'de', 'es']

// Le plus haut `db.version(N)` RÉELLEMENT déclaré dans src/db/db.js, en ignorant les
// lignes de commentaire — depuis la fusion du 13/08/2026, src/db/db.js cite un
// `db.version(2).stores({...})` FICTIF dans son commentaire de tête (src/db/db.js:26,
// l'exemple d'une future version à ajouter à la suite), alors qu'il ne DÉCLARE qu'une
// `db.version(1)`. Un balayage naïf du fichier entier compterait 2, attendrait 20 et ce
// test rougirait pour rien. C'est ce filtre — et le fait que db.js ne porte AUCUN
// commentaire de bloc `/* */`, qu'il ne saurait pas ignorer — qui le garde juste.
function highestDeclaredDbVersion(source) {
  let max = 0
  for (const line of source.split('\n')) {
    if (line.trim().startsWith('//')) continue
    const match = line.match(/db\.version\((\d+)\)/)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return max
}

// Ouvre une base IndexedDB réelle (fake-indexeddb, cf. tests/unit/setup.js) au numéro
// de version donné — comme un appareil déjà passé par une version antérieure du code —
// puis la referme aussitôt : le test suivant ne doit trouver QUE la trace laissée dans
// `indexedDB.databases()`, jamais une connexion encore ouverte.
function openAndCloseDatabase(name, version) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version)
    req.onupgradeneeded = () => {}
    req.onsuccess = () => {
      req.result.close()
      resolve()
    }
    req.onerror = () => reject(req.error)
  })
}

function deleteDatabase(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name)
    req.onsuccess = () => resolve()
    req.onblocked = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

describe('expectedIndexedDbVersion', () => {
  it('applique le facteur x10 de Dexie sur une dépendance injectée', () => {
    expect(expectedIndexedDbVersion({ verno: 1 })).toBe(10)
    expect(expectedIndexedDbVersion({ verno: 3 })).toBe(30)
  })

  // Le garde-fou n'a de sens QUE s'il suit le schéma réellement déclaré par
  // src/db/db.js, jamais un nombre écrit en dur ici : sinon un futur nettoyage du schéma (qui tronque
  // db.js à une seule version(1)) le périmerait EN SILENCE, sans qu'aucun test ne
  // rougisse — exactement le défaut invisible que ce garde-fou doit prévenir chez lui-
  // même. Ce test lit la SOURCE réelle du fichier : il continuera de protéger après
  // ce nettoyage, sans qu'il faille le retoucher.
  it('sans argument, dérive la version attendue du schéma RÉELLEMENT déclaré par src/db/db.js', () => {
    const source = fs.readFileSync(DB_JS_PATH, 'utf-8')
    const declared = highestDeclaredDbVersion(source)
    expect(declared).toBeGreaterThan(0) // prémisse : au moins une version(n) trouvée
    expect(expectedIndexedDbVersion()).toBe(declared * 10)
  })

  // `highestDeclaredDbVersion` ne filtre que les commentaires de LIGNE (`//`) — un
  // commentaire de BLOC (`/* */`) contenant un faux `db.version(N)` la ferait mesurer
  // faux EN SILENCE, exactement le défaut invisible que ce fichier existe pour éviter.
  // Cette garde transforme l'avertissement en assertion : src/db/db.js ne doit porter
  // AUCUN commentaire de bloc. Dernier correctif, 13/08/2026 — preuve par
  // mutation faite à la main (ajout temporaire d'un `/* */` dans db.js, ce test et le
  // précédent rougissent, `git diff` confirme le retour à l'état propre).
  it('src/db/db.js ne porte aucun commentaire de bloc /* */ (sinon highestDeclaredDbVersion mesurerait faux en silence)', () => {
    const source = fs.readFileSync(DB_JS_PATH, 'utf-8')
    expect(source.includes('/*'), 'un commentaire de bloc /* */ est apparu dans db.js — highestDeclaredDbVersion ne le filtre pas').toBe(false)
  })
})

describe('existingIndexedDbVersion', () => {
  const DB_NAME = 'version-guard-existing-test'
  afterEach(() => deleteDatabase(DB_NAME))

  it("lit la version d'une base EXISTANTE sans l'ouvrir en écriture", async () => {
    await openAndCloseDatabase(DB_NAME, 30)
    expect(await existingIndexedDbVersion({ dbName: DB_NAME })).toBe(30)
  })

  it('renvoie null quand aucune base ne porte ce nom (première installation)', async () => {
    expect(await existingIndexedDbVersion({ dbName: 'base-jamais-creee-' + DB_NAME })).toBeNull()
  })

  it('renvoie null sans jamais lever quand indexedDB.databases() est absent (navigateur ancien)', async () => {
    expect(await existingIndexedDbVersion({ indexedDBRef: {}, dbName: DB_NAME })).toBeNull()
  })

  it('renvoie null sans jamais lever quand indexedDB.databases() rejette', async () => {
    const boom = { databases: () => Promise.reject(new Error('boom')) }
    expect(await existingIndexedDbVersion({ indexedDBRef: boom, dbName: DB_NAME })).toBeNull()
  })

  // Dernier correctif (13/08) : le `try/catch` protège d'une exception, pas
  // d'une promesse qui ne se résout JAMAIS — un `databases()` qui pend bloquerait le
  // premier lancement à l'infini, malgré le commentaire de `checkVersionGuardOnStartup`
  // qui promet « ne bloque jamais la navigation ». `timeoutMs` court (test, pas les
  // 1500 ms réels) prouve que la sonde abandonne SANS lever ni bloquer.
  it('renvoie null sans jamais lever ni attendre indéfiniment quand indexedDB.databases() ne se résout jamais', async () => {
    const hung = { databases: () => new Promise(() => {}) }
    expect(await existingIndexedDbVersion({ indexedDBRef: hung, dbName: DB_NAME, timeoutMs: 20 })).toBeNull()
  })
})

describe('isDatabaseNewerThanCode — les trois cas demandés', () => {
  const DB_NAME = 'version-guard-newer-test'
  afterEach(() => deleteDatabase(DB_NAME))

  it('base PLUS RÉCENTE que le code (v3 -> 30 côté IndexedDB, code en v1 -> 10) : alerte', async () => {
    await openAndCloseDatabase(DB_NAME, 30)
    expect(await isDatabaseNewerThanCode({ dbName: DB_NAME, expectedVersion: 10 })).toBe(true)
  })

  it('base IDENTIQUE à ce que le code déclare : rien', async () => {
    await openAndCloseDatabase(DB_NAME, 10)
    expect(await isDatabaseNewerThanCode({ dbName: DB_NAME, expectedVersion: 10 })).toBe(false)
  })

  it('AUCUNE base (première installation) : rien', async () => {
    expect(await isDatabaseNewerThanCode({ dbName: 'base-jamais-creee-' + DB_NAME, expectedVersion: 10 })).toBe(
      false,
    )
  })

  it('une base MOINS récente que le code ne déclenche rien non plus', async () => {
    await openAndCloseDatabase(DB_NAME, 10)
    expect(await isDatabaseNewerThanCode({ dbName: DB_NAME, expectedVersion: 30 })).toBe(false)
  })
})

// Principe du garde-fou : « une garde jamais vue se déclencher ne protège rien ». Les tests
// ci-dessous ouvrent une VRAIE base (fake-indexeddb) plus récente que ce que le code
// déclare et vérifient que `versionGuardState.triggered` — l'état que App.vue affichera
// — passe réellement à `true`. Pas un booléen mocké : le chemin complet, jusqu'à l'état
// consommé par l'affichage.
describe('checkVersionGuardOnStartup — la garde sait se déclencher', () => {
  const DB_NAME = 'version-guard-startup-test'
  beforeEach(() => {
    versionGuardState.triggered = false
  })
  afterEach(async () => {
    versionGuardState.triggered = false
    await deleteDatabase(DB_NAME)
  })

  it('déclenche versionGuardState.triggered quand une base plus récente existe (repro directe du défaut)', async () => {
    // Scénario mesuré en phase 1 et confirmé sur le Pixel 7 : le code déclare v1 (10),
    // l'appareil porte une base v3 (30) laissée par une version antérieure du code.
    await openAndCloseDatabase(DB_NAME, 30)
    await checkVersionGuardOnStartup({ dexieDb: { verno: 1 }, dbName: DB_NAME })
    expect(versionGuardState.triggered).toBe(true)
  })

  it('ne déclenche rien quand la base est identique à ce que le code déclare', async () => {
    await openAndCloseDatabase(DB_NAME, 10)
    await checkVersionGuardOnStartup({ dexieDb: { verno: 1 }, dbName: DB_NAME })
    expect(versionGuardState.triggered).toBe(false)
  })

  it("ne déclenche rien à la première installation (aucune base)", async () => {
    await checkVersionGuardOnStartup({ dexieDb: { verno: 1 }, dbName: 'base-jamais-creee-' + DB_NAME })
    expect(versionGuardState.triggered).toBe(false)
  })

  it('ne casse jamais la navigation même si indexedDB.databases() rejette (jamais de blocage)', async () => {
    const boom = { databases: () => Promise.reject(new Error('boom')) }
    await expect(
      checkVersionGuardOnStartup({ dexieDb: { verno: 1 }, indexedDBRef: boom, dbName: DB_NAME }),
    ).resolves.toBeUndefined()
    expect(versionGuardState.triggered).toBe(false)
  })

  // Bout en bout : le chemin réel de démarrage (checkVersionGuardOnStartup) ne reste
  // pas suspendu quand la sonde ne se résout jamais — repli sur `timeoutMs` court, pas
  // les 1500 ms réels, pour que ce test lui-même n'attende pas inutilement.
  it('ne bloque jamais le démarrage même si indexedDB.databases() ne se résout jamais', async () => {
    const hung = { databases: () => new Promise(() => {}) }
    await expect(
      checkVersionGuardOnStartup({ dexieDb: { verno: 1 }, indexedDBRef: hung, dbName: DB_NAME, timeoutMs: 20 }),
    ).resolves.toBeUndefined()
    expect(versionGuardState.triggered).toBe(false)
  })
})

// Tous les tests ci-dessus passent un `dbName` explicite — aucun n'exerce le chemin de
// PRODUCTION réel : `router/index.js` appelle `checkVersionGuardOnStartup()` SANS
// argument, donc `dbName` prend sa valeur par défaut ('rowtine', posée dans
// version-guard.js). Ce bloc couvre spécifiquement ce chemin par défaut, sans lequel
// un défaut de frappe dans le nom par défaut (ex. 'tricoche' au lieu de 'rowtine',
// piège déjà connu) passerait tous les tests ci-dessus sans jamais être
// détecté.
describe('checkVersionGuardOnStartup — chemin de production (dbName par défaut)', () => {
  beforeEach(() => {
    versionGuardState.triggered = false
  })
  afterEach(async () => {
    versionGuardState.triggered = false
    await deleteDatabase('rowtine')
  })

  it("sans dbName explicite, sonde bien la base 'rowtine' — celle que src/db/db.js déclare (new Dexie('rowtine'))", async () => {
    const source = fs.readFileSync(DB_JS_PATH, 'utf-8')
    expect(source).toContain("new Dexie('rowtine')")
    // ⚠️ Le numéro est DÉRIVÉ, jamais écrit en dur (il valait 30 avant ce nettoyage du schéma, quand
    // db.js déclarait encore trois versions). Deux blocs de ce fichier ouvrent la base
    // 'rowtine' : si celui-ci l'ouvrait à un numéro PLUS HAUT que le suivant, une
    // suppression d'`afterEach` qui n'aboutirait pas (`onblocked` est acquitté en succès
    // par `deleteDatabase` ci-dessus) ferait rougir le second par `VersionError` — pour une
    // mauvaise raison, et sans que la panne de nettoyage se voie. Les deux ouvrent donc
    // désormais le MÊME numéro dérivé.
    await openAndCloseDatabase('rowtine', expectedIndexedDbVersion() + 10)
    // Exactement l'appel de router/index.js : dbName omis, seul `dexieDb` est injecté
    // pour ne pas dépendre du schéma réel du dépôt à cet instant précis.
    await checkVersionGuardOnStartup({ dexieDb: { verno: 1 } })
    expect(versionGuardState.triggered).toBe(true)
  })
})

// Premier correctif (revue, 13/08/2026) : le test précédent injecte encore
// `dexieDb` — la protection « jamais de nombre en dur » ne couvrait donc que
// `expectedIndexedDbVersion()` isolée. Ici, AUCUNE injection : c'est l'appel EXACT que
// fait router/index.js (`checkVersionGuardOnStartup()`, zéro argument), contre le VRAI
// `db` importé de `@/db/db`. Écrit pour survivre à ce nettoyage du schéma : la base ouverte est à
// `expectedIndexedDbVersion() + 10`, un cran AU-DESSUS de ce que `src/db/db.js` déclare
// réellement au moment où le test tourne — vrai aujourd'hui (30 + 10 = 40 contre un
// code qui attend 30) comme après ce nettoyage (10 + 10 = 20 contre un code qui attend
// 10), sans qu'il faille retoucher ce fichier.
describe('checkVersionGuardOnStartup — bout en bout, AUCUNE injection (le vrai chemin de production)', () => {
  beforeEach(() => {
    versionGuardState.triggered = false
  })
  afterEach(async () => {
    versionGuardState.triggered = false
    await deleteDatabase('rowtine')
  })

  it("détecte une base plus récente que le VRAI schéma de src/db/db.js, sans injecter ni dexieDb ni dbName", async () => {
    const newerThanRealCode = expectedIndexedDbVersion() + 10
    await openAndCloseDatabase('rowtine', newerThanRealCode)
    await checkVersionGuardOnStartup() // l'appel réel, mot pour mot, de router/index.js
    expect(versionGuardState.triggered).toBe(true)
  })
})

// Premier correctif : rien ne reliait `t('versionGuard.title')` / `t('versionGuard.
// message')` dans App.vue aux clés du JSON — une faute de frappe dans App.vue aurait
// affiché le chemin brut à l'écran avec tous les tests précédents encore verts (piège
// déjà vécu dans ce dépôt). Ce test lit la SOURCE réelle de App.vue, extrait les clés
// `t('…')` du bloc du garde-fou, et vérifie CES clés précises (pas une chaîne
// redéclarée ici) dans les 4 langues.
describe('affichage — les clés i18n APPELÉES PAR App.vue existent et ne sont pas vides', () => {
  it('extrait les t(\'…\') du bloc ConfirmDialog du garde-fou dans src/App.vue et les vérifie dans les 4 langues', () => {
    const appSource = fs.readFileSync(APP_VUE_PATH, 'utf-8')
    // Ancre `:open="versionGuardHasSlot"` depuis l'introduction de la file des messages
    // (19/08/2026) : l'affichage passe désormais par la file (`useNoticeSlot`), qui décide QUI
    // s'affiche — `versionGuardState.triggered` reste la condition RÉELLE consultée par le
    // composable et par `versionGuardHandlesBack` (bouton retour), mais n'est plus lue
    // directement par ce binding.
    const blockMatch = appSource.match(/:open="versionGuardHasSlot"[\s\S]*?\/>/)
    expect(blockMatch, "bloc ConfirmDialog du garde-fou introuvable dans App.vue — structure du template changée").toBeTruthy()
    const block = blockMatch[0]
    const keys = [...block.matchAll(/t\('([\w.]+)'\)/g)].map((m) => m[1])
    expect(keys, 'aucune clé t(\'…\') trouvée dans le bloc du garde-fou').toEqual(
      expect.arrayContaining(['versionGuard.title', 'versionGuard.message', 'common.gotIt']),
    )
    for (const locale of LOCALES) {
      const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../..', `src/i18n/${locale}.json`), 'utf-8'))
      for (const key of keys) {
        const value = key.split('.').reduce((obj, part) => obj?.[part], data)
        expect(typeof value, `App.vue appelle t('${key}'), absente de ${locale}.json`).toBe('string')
        expect(value.trim().length, `App.vue appelle t('${key}'), vide dans ${locale}.json`).toBeGreaterThan(0)
      }
    }
  })
})

// Premier correctif : rien n'empêchait qu'un futur déplacement de l'appel hors du
// bloc `if (!settings.loaded)` fasse revenir le message à CHAQUE navigation — exactement
// ce que la consigne demandait d'éviter. Ce test lit la source réelle de
// router/index.js et vérifie STRUCTURELLEMENT (comptage d'accolades, pas une regex sur
// une ligne) que l'appel reste dans ce bloc précis, avant `settings.load()`, et qu'il
// n'apparaît nulle part ailleurs dans le fichier.
//
// ⚠️ Piège rencontré en écrivant CE test : le commentaire qui documente l'appel dans
// router/index.js contient lui-même la sous-chaîne « settings.load() » AVANT le vrai
// appel de code (« …AVANT que settings.load() n'ouvre la base… ») — un `indexOf` naïf
// sur le bloc BRUT y trouvait « settings.load( » avant `checkVersionGuardOnStartup(`,
// et le test rougissait pour une MAUVAISE raison. Corrigé en retirant les lignes de
// commentaire avant de chercher les deux appels — même parade que
// `highestDeclaredDbVersion` plus haut pour db.js.
function stripCommentLines(source) {
  return source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

function extractIfNotLoadedBlock(source) {
  const code = stripCommentLines(source)
  const startMarker = 'if (!settings.loaded) {'
  const start = code.indexOf(startMarker)
  if (start === -1) return null
  let i = start + startMarker.length
  let depth = 1
  while (depth > 0 && i < code.length) {
    if (code[i] === '{') depth++
    else if (code[i] === '}') depth--
    i++
  }
  return code.slice(start, i)
}

describe("emplacement du garde-fou dans le routeur — DANS if (!settings.loaded), AVANT settings.load()", () => {
  it('checkVersionGuardOnStartup() est appelé dans ce bloc précis, avant settings.load()', () => {
    const routerSource = fs.readFileSync(ROUTER_PATH, 'utf-8')
    const block = extractIfNotLoadedBlock(routerSource)
    expect(block, "bloc if (!settings.loaded) introuvable dans router/index.js — structure changée").toBeTruthy()
    const guardIndex = block.indexOf('checkVersionGuardOnStartup(')
    const loadIndex = block.indexOf('settings.load(')
    expect(guardIndex, "checkVersionGuardOnStartup() n'est plus DANS le bloc if (!settings.loaded) — il reviendrait à CHAQUE navigation").toBeGreaterThan(-1)
    expect(loadIndex, 'settings.load() introuvable dans ce bloc').toBeGreaterThan(-1)
    expect(guardIndex, 'checkVersionGuardOnStartup() doit être appelé AVANT settings.load(), pas après').toBeLessThan(loadIndex)
  })

  it("checkVersionGuardOnStartup() n'est appelé QU'UNE FOIS dans tout router/index.js (jamais hors de ce bloc)", () => {
    const routerSource = fs.readFileSync(ROUTER_PATH, 'utf-8')
    const calls = [...routerSource.matchAll(/checkVersionGuardOnStartup\(/g)]
    expect(calls.length, 'un déplacement/doublon ferait revenir le message à chaque navigation').toBe(1)
  })
})

// Une clé de traduction absente s'affiche à l'écran en CHEMIN BRUT (piège connu de ce
// dépôt) : ce filet vérifie que les trois clés existent et sont non vides dans les
// quatre langues, pas seulement en français.
describe('traductions versionGuard — présentes et non vides dans les 4 langues', () => {
  const KEYS = ['title', 'message']

  for (const locale of LOCALES) {
    it(`${locale}.json porte versionGuard.title et versionGuard.message, non vides`, () => {
      const filePath = path.resolve(__dirname, '../..', `src/i18n/${locale}.json`)
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      expect(data.versionGuard, `versionGuard manquant dans ${locale}.json`).toBeTruthy()
      for (const key of KEYS) {
        const value = data.versionGuard[key]
        expect(typeof value, `versionGuard.${key} manquant dans ${locale}.json`).toBe('string')
        expect(value.trim().length, `versionGuard.${key} vide dans ${locale}.json`).toBeGreaterThan(0)
      }
    })
  }

  // ⚠️ CE QUE LES TESTS CI-DESSUS NE FONT PAS, constaté le 13/08/2026 : les quatre
  // messages ont été RÉÉCRITS INTÉGRALEMENT (premier correctif — l'ancien texte
  // affirmait des tables invisibles et une sauvegarde arrêtée, deux faits que la fusion du
  // schéma a rendus faux) et pas un test n'a rougi. Ils vérifient la présence et la
  // non-vacuité des clés, jamais ce qu'elles disent. C'est assumé : la prose se relit et se
  // voit sur appareil, la figer en test la rendrait immodifiable. Ce qui suit fixe donc la
  // seule chose qui se contrôle mécaniquement — la FORME typographique.
  //
  // ⛔ U+202F (espace fine insécable) est absente des trois polices de l'app : elle
  // s'affiche en carré vide. C'est l'insécable ORDINAIRE U+00A0 qu'il faut. Les deux
  // caractères sont écrits en séquence \u : une insécable littérale ne survit pas à un
  // copier-coller ni à un heredoc, et sa disparition ne se verrait pas à l'œil — le test
  // deviendrait vert pour rien.
  const FINE_INSECABLE = '\u202f'
  const INSECABLE = '\u00a0'

  for (const locale of LOCALES) {
    it(`${locale}.json — aucun U+202F dans versionGuard (absent des polices de l'app)`, () => {
      const filePath = path.resolve(__dirname, '../..', `src/i18n/${locale}.json`)
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      for (const key of KEYS) {
        expect(
          data.versionGuard[key].includes(FINE_INSECABLE),
          `versionGuard.${key} de ${locale}.json contient U+202F : il s'affichera en carré vide`,
        ).toBe(false)
      }
    })
  }

  it("fr.json — chaque deux-points de versionGuard.message est précédé d'une insécable U+00A0", () => {
    const filePath = path.resolve(__dirname, '../..', 'src/i18n/fr.json')
    const message = JSON.parse(fs.readFileSync(filePath, 'utf-8')).versionGuard.message
    const avantDeuxPoints = [...message.matchAll(/(.):/g)].map((m) => m[1])
    // Prémisse : sans deux-points dans le texte, ce test ne mesurerait rien et resterait
    // vert pour toujours. Il doit tomber le jour où la prose n'en porte plus.
    expect(avantDeuxPoints.length, 'aucun deux-points dans le message français').toBeGreaterThan(0)
    for (const avant of avantDeuxPoints) {
      expect(
        avant === INSECABLE,
        `un deux-points du message français est précédé de ${JSON.stringify(avant)} au lieu d'une insécable U+00A0`,
      ).toBe(true)
    }
  })

  // common.gotIt existe déjà (réutilisé comme bouton unique du dialogue) — ce test
  // documente la dépendance : s'il disparaissait un jour, le bouton afficherait la clé
  // brute plutôt qu'un texte.
  for (const locale of LOCALES) {
    it(`${locale}.json porte toujours common.gotIt (bouton unique réutilisé par le garde-fou)`, () => {
      const filePath = path.resolve(__dirname, '../..', `src/i18n/${locale}.json`)
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      expect(typeof data.common?.gotIt).toBe('string')
      expect(data.common.gotIt.trim().length).toBeGreaterThan(0)
    })
  }
})
