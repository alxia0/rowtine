import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock-plugin : traduit les appels « plugin » (objets {path,...}) vers un
// MemoryBackupStorage, et ré-emballe les retours comme le fera le natif.
// Vitest hoiste vi.mock au-dessus des déclarations top-level du fichier ; un
// `const plugin = {...}` déclaré séparément puis référencé dans le factory
// lève "Cannot access 'plugin' before initialization" (bug Vitest v4). Le
// factory importe donc MemoryBackupStorage dynamiquement et construit le
// mock-plugin lui-même, sans dépendre d'aucune variable top-level du fichier.
//
// Le backing (`mem`) est mutable et réinitialisé avant CHAQUE test via
// `__resetBacking` (exposée uniquement par ce mock, pas par le vrai plugin) :
// sans cela, tous les tests du fichier partageraient un seul stockage en
// mémoire, et le round-trip de contrat ci-dessous serait pollué par les
// écritures des tests précédents (`a/b.txt`, `x`, `d/final`…).
//
// `readFile` du mock reproduit FIDÈLEMENT le natif après le correctif mémoire :
// il honore `offset`/`length`, écrête à MAX_CHUNK_BYTES, arrondit à un multiple
// de 3 et renvoie { data, size, bytesRead, eof, base64 }. Sans cette fidélité,
// la lecture par tranches ne serait jamais exercée ici.
//
// `writeFile` du mock reproduit de même le natif côté ÉCRITURE : écrêtage à
// MAX_CHUNK_BYTES, refus d'une tranche non alignée sur 4 caractères base64, refus
// d'une tranche hors séquence, écriture dans `<chemin>.part` et publication par
// renommage au DERNIER appel seulement. Sans cette fidélité, rien ne prouverait
// qu'une écriture interrompue laisse l'ancien fichier intact.
vi.mock('@/backup/saf-plugin', async () => {
  const { MemoryBackupStorage } = await import('@/backup/memory-storage')
  const { readFileSync } = await import('node:fs')
  const nodePath = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  // Le plafond du mock est LU dans la source Java, pas recopié à la main : si le
  // natif change sa constante, le mock suit. Un littéral dupliqué ici dériverait
  // sans qu'aucun test ne le dise (saf-lecture-tranches-bornee.spec.js verrouille
  // le Java et CHUNK_BYTES, pas les copies éparpillées dans les tests).
  const ROOT = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '../..')
  const JAVA = readFileSync(
    nodePath.join(ROOT, 'android/app/src/main/java/com/rowtine/app/RowtineSafPlugin.java'),
    'utf-8',
  )
  const MAX_CHUNK_BYTES = Number(JAVA.match(/MAX_CHUNK_BYTES\s*=\s*(\d+)\s*;/)[1])
  let mem = new MemoryBackupStorage()
  // Force la taille de tranche RENDUE par le « natif » en ignorant celle demandée :
  // sert à simuler un natif mal aligné (tranche non multiple de 3).
  let forcedChunk = null
  // Force la taille ANNONCÉE, sans toucher au contenu : simule un fichier qui change
  // sous la lecture (le dossier est visible de l'utilisatrice).
  let forcedSize = null
  // Omet `eof` : simule un natif antérieur au correctif.
  let dropEof = false
  // Simule un fournisseur SAF dont DocumentFile.length() rend 0 : les contrôles de
  // séquence et de total du natif doivent alors s'effacer, pas bloquer l'écriture.
  let blindLength = false
  // Interrompt l'écriture juste AVANT la tranche n° `abortAt` (0 = la première) :
  // simule une application tuée en pleine sauvegarde.
  let abortAtChunk = null
  let chunkSeen = 0
  // Ampute la DERNIÈRE tranche d'un octet : simule une tranche partiellement écrite
  // (disque plein, flux coupé). Le total annoncé ne retombe plus, et la publication
  // doit être refusée.
  let truncateLast = false
  // Fournisseur dont le mode « ajout » TRONQUE au lieu d'ajouter : chaque tranche
  // écrase la précédente. Combiné à `blindLength`, c'est le scénario où les deux
  // contrôles de longueur tombaient ENSEMBLE et publiaient un fichier amputé.
  let brokenAppend = false
  // Fait echouer l'ecriture du temporaire pour UN chemin donne : sert a prouver
  // qu'un petit fichier interrompu ne laisse rien sous le nom final.
  let breakWritePath = null
  // Ampute d'un octet une écriture partie en UN SEUL appel : sans `total` annoncé,
  // le natif ne vérifierait rien de ce qui a atterri.
  let truncateSingle = false
  // Sonde de capacité du natif : URI (ici chemin) du temporaire → « sait mesurer ».
  const measuring = new Map()
  // Compteurs d'appels NATIFS : la preuve du cache de dossiers (lot 06/09) est
  // statistique — un readdir doit remplacer les N exists suivants du même dossier,
  // donc le test compte ce que le « natif » a réellement vu.
  const calls = { readFile: 0, writeFile: 0, readdir: 0, exists: 0 }
  const binToBytes = (bin) => Uint8Array.from(bin, (c) => c.charCodeAt(0))
  const utf8ToBin = (str) => {
    const bytes = new TextEncoder().encode(str)
    let bin = ''
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i])
    return bin
  }
  return {
    RowtineSaf: {
      mkdir: ({ path }) => mem.mkdir(path),
      // Transcription fidèle de RowtineSafPlugin.writeFile.
      writeFile: async ({ path, data = '', encoding = 'utf8', offset = 0, last = true, total = -1 }) => {
        calls.writeFile += 1
        const b64 = encoding === 'base64'
        const chunked = offset > 0 || last !== true
        if (chunked) {
          chunkSeen += 1
          if (abortAtChunk !== null && chunkSeen > abortAtChunk) {
            throw new Error('application interrompue en pleine ecriture')
          }
        }
        if (chunked && !b64) throw new Error(`une tranche doit etre transmise en base64 : ${path}`)
        if (chunked && last !== true && (data.length % 4 !== 0 || data.includes('='))) {
          throw new Error(`tranche non alignee a l'octet ${offset} de ${path}`)
        }
        // Chaîne binaire : un caractère = un octet, comme le byte[] côté Java.
        const bin = b64 ? atob(data) : utf8ToBin(String(data))
        if (bin.length > MAX_CHUNK_BYTES) {
          throw new Error(
            `charge utile hors borne pour ${path} : ${bin.length} octets pour un maximum de ${MAX_CHUNK_BYTES}`,
          )
        }
        // TOUTE écriture passe par le temporaire, quelle que soit sa taille : c'est
        // l'élargissement du 13/08. Un fichier court y entre et en sort dans le MÊME
        // appel — un seul aller-retour, mais publié par renommage.
        const tmp = `${path}.part`
        if (breakWritePath === path) throw new Error(`ecriture de tranche impossible : ${path}`)
        let have = ''
        if (offset === 0) {
          await mem.remove(tmp)
        } else {
          if (!(await mem.exists(tmp))) throw new Error(`tranche orpheline pour ${path}`)
          have = atob(await mem.readFile(tmp, { encoding: 'base64' }))
          const reported = blindLength ? 0 : have.length
          // Conditionnel à `> 0` SEULEMENT chez un fournisseur dont la sonde a établi
          // qu'il ne sait pas mesurer.
          if ((measuring.get(tmp) === true || reported > 0) && reported !== offset) {
            measuring.delete(tmp)
            throw new Error(`tranche desordonnee pour ${path} : ${reported} octets pour le decalage ${offset}`)
          }
        }
        // `brokenAppend` rejoue un fournisseur dont le mode "wa" TRONQUE au lieu
        // d'ajouter : chaque tranche écrase la précédente.
        const socle = brokenAppend ? '' : have
        const ampute = (last === true && truncateLast) || (offset === 0 && last === true && truncateSingle)
        const put = ampute ? bin.slice(0, Math.max(0, bin.length - 1)) : bin
        await mem.writeFile(tmp, btoa(socle + put), { encoding: 'base64' })
        const surDisque = socle.length + put.length
        // SONDE DE CAPACITÉ, tranche 0 d'une écriture multi-tranches seulement : le
        // natif compare la longueur relue à celle qu'il vient d'écrire.
        if (offset === 0 && last !== true) {
          measuring.set(tmp, (blindLength ? 0 : surDisque) === bin.length)
        }
        if (last !== true) return undefined
        // La sonde est toujours RETIRÉE, mais consultée seulement en multi-appels : une
        // écriture en un seul appel ne l'arme jamais et retomberait sinon sur le résidu
        // d'une écriture abandonnée au même chemin.
        const sonde = measuring.get(tmp)
        measuring.delete(tmp)
        const mesure = offset > 0 && sonde === true
        // ATTENDU : la taille annoncée, sinon — écriture en un seul appel — le nombre
        // d'octets que CE MÊME appel vient de décoder.
        const attendu = total >= 0 ? total : offset === 0 ? bin.length : -1
        const written = blindLength ? 0 : surDisque
        if (attendu >= 0 && (mesure || written > 0) && written !== attendu) {
          throw new Error(`ecriture incomplete pour ${path} : ${written} octets pour ${attendu} attendus`)
        }
        // Fournisseur AVEUGLE : length() n'a rien dit, donc aucune garde n'a pu mordre.
        // Le natif compte alors les octets en les faisant DÉFILER (tampon fixe, rien en
        // mémoire) — ici, `surDisque` EST ce compte.
        if (attendu >= 0 && !mesure && written <= 0 && surDisque !== attendu) {
          throw new Error(
            `ecriture incomplete pour ${path} : ${surDisque} octets comptes pour ${attendu} attendus`,
          )
        }
        await mem.remove(path)
        await mem.rename(tmp, path)
        return undefined
      },
      readFile: async ({ path, encoding = 'utf8', offset = 0, length = MAX_CHUNK_BYTES }) => {
        calls.readFile += 1
        // Chaîne binaire : un caractère = un octet, comme le byte[] côté Java.
        const bin = atob(await mem.readFile(path, { encoding: 'base64' }))
        let want = forcedChunk === null ? length : forcedChunk
        if (want <= 0 || want > MAX_CHUNK_BYTES) want = MAX_CHUNK_BYTES
        if (forcedChunk === null) {
          want -= want % 3
          if (want === 0) want = 3
        }
        const slice = bin.slice(offset, offset + want)
        const eof = slice.length < want
        const sliced = offset > 0 || !eof
        const base64 = encoding === 'base64' || sliced
        const out = {
          data: base64 ? btoa(slice) : new TextDecoder('utf-8').decode(binToBytes(slice)),
          size: forcedSize === null ? bin.length : forcedSize,
          bytesRead: slice.length,
          eof,
          base64,
        }
        if (dropEof) delete out.eof
        return out
      },
      readdir: async ({ path }) => {
        calls.readdir += 1
        return { entries: await mem.readdir(path) }
      },
      exists: async ({ path }) => {
        calls.exists += 1
        return { exists: await mem.exists(path) }
      },
      remove: ({ path }) => mem.remove(path),
      rename: ({ from, to }) => mem.rename(from, to),
    },
    __resetBacking: () => {
      mem = new MemoryBackupStorage()
      forcedChunk = null
      forcedSize = null
      dropEof = false
      blindLength = false
      abortAtChunk = null
      chunkSeen = 0
      truncateLast = false
      brokenAppend = false
      breakWritePath = null
      truncateSingle = false
      measuring.clear()
      calls.readFile = 0
      calls.writeFile = 0
      calls.readdir = 0
      calls.exists = 0
    },
    __forceNativeChunk: (n) => {
      forcedChunk = n
    },
    __forceAnnouncedSize: (n) => {
      forcedSize = n
    },
    __dropEof: () => {
      dropEof = true
    },
    __forceBlindLength: () => {
      blindLength = true
    },
    __abortAfterChunks: (n) => {
      abortAtChunk = n
      chunkSeen = 0
    },
    __truncateLastChunk: () => {
      truncateLast = true
    },
    __breakAppendMode: () => {
      brokenAppend = true
    },
    __breakWriteAt: (p) => {
      breakWritePath = p
    },
    __truncateSingleWrite: () => {
      truncateSingle = true
    },
    __calls: calls,
  }
})

import {
  __resetBacking,
  __forceNativeChunk,
  __forceAnnouncedSize,
  __dropEof,
  __forceBlindLength,
  __abortAfterChunks,
  __truncateLastChunk,
  __breakAppendMode,
  __breakWriteAt,
  __truncateSingleWrite,
  __calls,
} from '@/backup/saf-plugin'
import { SafBackupStorage } from '@/backup/saf-storage'
import { WARNING_CODES } from '@/utils/pattern-md/warning-codes'

const bytesToB64 = (bytes) => btoa(String.fromCharCode(...bytes))

beforeEach(() => {
  __resetBacking()
})

describe('SafBackupStorage (adaptateur)', () => {
  it('writeFile/readFile utf8 round-trip', async () => {
    const s = new SafBackupStorage()
    await s.writeFile('a/b.txt', 'héllo')
    expect(await s.readFile('a/b.txt')).toBe('héllo')
  })

  it('readdir renvoie [] pour un dossier absent', async () => {
    const s = new SafBackupStorage()
    expect(await s.readdir('nexiste/pas')).toEqual([])
  })

  it('exists reflète la présence', async () => {
    const s = new SafBackupStorage()
    expect(await s.exists('x')).toBe(false)
    await s.writeFile('x', 'v')
    expect(await s.exists('x')).toBe(true)
  })

  it('rename même parent remplace la destination', async () => {
    const s = new SafBackupStorage()
    await s.writeFile('d/final', 'old')
    await s.writeFile('d/final.tmp', 'new')
    await s.rename('d/final.tmp', 'd/final')
    expect(await s.readFile('d/final')).toBe('new')
    expect(await s.exists('d/final.tmp')).toBe(false)
  })
})

// CACHE DE DOSSIERS (lot « restauration lourde », 06/09). Mesuré sur tablette :
// 302 exists à ~300 ms pièce — chaque exists natif est un findFile, donc une
// énumération ContentResolver du dossier PARENT. Un readdir déjà fait connaît donc
// déjà ces réponses : il peuple un instantané que les exists suivants du même
// dossier lisent à coût nul. Seul l'INVENTAIRE est caché : readdir et readFile
// restent TOUJOURS natifs (le readdir rafraîchit l'inventaire, le contenu n'est
// jamais servi du cache), et toute mutation propre (writeFile/mkdir/remove/rename)
// invalide les instantanés concernés.
describe('SafBackupStorage : cache de dossiers (un readdir remplace N exists)', () => {
  it('les exists d’un dossier déjà lu sont servis par le readdir : UN readdir natif, ZÉRO exists natif', async () => {
    const s = new SafBackupStorage()
    for (let i = 1; i <= 5; i += 1) await s.writeFile(`Projets/x/photo-${i}.jpg`, `p${i}`)
    __calls.readdir = 0
    await s.readdir('Projets/x')
    for (let i = 1; i <= 5; i += 1) {
      expect(await s.exists(`Projets/x/photo-${i}.jpg`)).toBe(true)
    }
    expect(__calls.readdir, 'le readdir déjà fait doit servir les exists suivants').toBe(1)
    expect(__calls.exists, 'chaque exists natif coûte une énumération du parent (~300 ms)').toBe(0)
  })

  it('deux readdir du même dossier font DEUX appels natifs (le cache ne sert JAMAIS readdir)', async () => {
    const s = new SafBackupStorage()
    await s.writeFile('Projets/x/f.txt', 'v')
    __calls.readdir = 0
    await s.readdir('Projets/x')
    await s.readdir('Projets/x')
    expect(__calls.readdir, 'le readdir est l’instantané autoritaire : toujours natif').toBe(2)
  })

  it('writeFile invalide le parent : le nouveau fichier est vu par exists — y compris à la racine', async () => {
    const s = new SafBackupStorage()
    await s.writeFile('Projets/x/ancien.txt', 'a')
    await s.readdir('Projets/x')
    __calls.readdir = 0
    await s.writeFile('Projets/x/nouveau.json', '{"n":1}')
    expect(await s.exists('Projets/x/nouveau.json')).toBe(true)
    // Le parent de « laines.json » est '' (la racine) : lui aussi doit se mettre en
    // cache au readdir('') puis être invalidé par l'écriture d'un fichier racine.
    await s.readdir('')
    expect(await s.exists('laines.json')).toBe(false)
    await s.writeFile('laines.json', '[{"id":50,"brand":"Drops"}]')
    expect(await s.exists('laines.json')).toBe(true)
    // 3 rechargements d'inventaire : un par exists après écriture, plus le
    // readdir('') explicite — l'invalidation SE CONTENTE de dropper, la vérité
    // revient par readdir, jamais par un exists natif.
    expect(__calls.readdir, 'chaque écriture doit recharger le parent au prochain exists').toBe(3)
    expect(__calls.exists, 'la vérité vient du readdir, pas d’un exists natif').toBe(0)
  })

  it('remove invalide le sous-arbre : exists sous le dossier supprimé rend faux, la vérité vient d’un readdir', async () => {
    const s = new SafBackupStorage()
    await s.writeFile('Projets/x/photo.jpg', 'p')
    await s.readdir('Projets')
    __calls.readdir = 0
    await s.readdir('Projets/x')
    await s.remove('Projets/x')
    // Sans invalidation, l'instantané périmé de 'Projets/x' répondrait encore vrai.
    expect(await s.exists('Projets/x/photo.jpg')).toBe(false)
    expect(__calls.exists, 'aucun appel natif de vérité : le readdir rafraîchi suffit').toBe(0)
    expect(__calls.readdir, "l'instantané périmé a dû être rechargé (et rendre [])").toBe(2)
  })

  it('dossier absent : readdir rend [] et exists rend faux, sans exists natif (parité native)', async () => {
    const s = new SafBackupStorage()
    expect(await s.readdir('nexiste/pas')).toEqual([])
    expect(await s.exists('nexiste/pas/fichier.txt')).toBe(false)
    expect(__calls.exists, "l'absence se déduit du readdir [], pas d'un exists natif").toBe(0)
  })
})

// Lecture PAR TRANCHES (correctif mémoire du pont natif). Le crash relevé sur la
// Nexus 7 (16 Mo de tas) n'était ni dans la lecture du fichier ni dans le base64,
// mais dans call.resolve() : Capacitor sérialise le résultat en JSON, et trois
// exemplaires de la même chaîne base64 cohabitent le temps de la sérialisation.
// C'est donc le PLUS GROS FICHIER qui décide, pas le volume total — pire cas
// connu, un PDF de patron de 3,4 Mo.
//
// Les tranches sont ici minuscules (6 octets) via l'option `chunkBytes` du
// constructeur : la signature et le contrat de readFile(path, { encoding }) sont
// strictement inchangés pour ses appelants.
describe('SafBackupStorage : lecture par tranches', () => {
  it('recompose un fichier binaire lu en plusieurs tranches, octet pour octet', async () => {
    // 50 octets : 8 tranches pleines de 6 + une dernière de 2.
    const bytes = Uint8Array.from({ length: 50 }, (_, i) => (i * 7 + 3) % 256)
    const b64 = bytesToB64(bytes)
    const s = new SafBackupStorage({ chunkBytes: 6 })
    await s.writeFile('gros.bin', b64, { encoding: 'base64' })

    expect(await s.readFile('gros.bin', { encoding: 'base64' })).toBe(b64)
    // La preuve que le découpage a bien eu lieu : sans elle, un readFile qui lirait
    // tout d'un coup passerait aussi.
    expect(__calls.readFile, 'le fichier doit être lu en plusieurs allers-retours').toBe(9)
  })

  it('gère le cas limite du fichier dont la taille est un MULTIPLE EXACT de la tranche', async () => {
    // 12 octets pour des tranches de 6 : la 2ᵉ tranche est pleine, donc rien ne dit
    // encore que le fichier est fini ; une 3ᵉ lecture, vide, clôt la boucle.
    const bytes = Uint8Array.from({ length: 12 }, (_, i) => 200 + i)
    const b64 = bytesToB64(bytes)
    const s = new SafBackupStorage({ chunkBytes: 6 })
    await s.writeFile('pile.bin', b64, { encoding: 'base64' })

    expect(await s.readFile('pile.bin', { encoding: 'base64' })).toBe(b64)
    expect(__calls.readFile).toBe(3)
  })

  it("décode l'UTF-8 APRÈS recomposition, même quand un accent est coupé par une frontière de tranche", async () => {
    // « é » occupe les octets 5 et 6 : avec des tranches de 6 octets, il est coupé
    // exactement en deux par la première frontière.
    const texte = 'abcdeéfghij ç à ü — très serré'
    expect(
      new TextEncoder().encode(texte).indexOf(0xc3),
      "le fixture ne coupe plus d'accent : le test ne prouverait plus rien",
    ).toBe(5)

    const s = new SafBackupStorage({ chunkBytes: 6 })
    await s.writeFile('notes.md', texte)
    expect(await s.readFile('notes.md')).toBe(texte)
  })

  it('un petit fichier ne coûte QU’UN seul aller-retour', async () => {
    const s = new SafBackupStorage()
    await s.writeFile('reglages.json', '{"theme":"clay"}')
    expect(await s.readFile('reglages.json')).toBe('{"theme":"clay"}')
    expect(__calls.readFile, 'un JSON de réglages ne doit pas payer plusieurs tranches').toBe(1)
  })

  it('refuse une taille de tranche non multiple de 3 (le base64 encode 3 octets en 4 caractères)', () => {
    // L'erreur porte un CODE du catalogue (fabrique E()), pas une phrase
    // nue — on épingle le code et les params ; le verbatim reste dans .message pour le
    // diagnostic (console, logs) et est vérifié ici à titre de contrat.
    const capture = (chunkBytes) => {
      try {
        new SafBackupStorage({ chunkBytes })
        return null
      } catch (err) {
        return err
      }
    }
    const err8 = capture(8)
    expect(err8.code).toBe(WARNING_CODES.SAF_CHUNK_SIZE)
    expect(err8.params).toEqual({ bytes: 8 })
    const err0 = capture(0)
    expect(err0.code).toBe(WARNING_CODES.SAF_CHUNK_SIZE)
    expect(err0.params).toEqual({ bytes: 0 })
    expect(err8.message, 'le verbatim diagnostique survit dans .message').toMatch(/multiple de 3/)
    expect(new SafBackupStorage({ chunkBytes: 6 })).toBeInstanceOf(SafBackupStorage)
  })

  it('refuse un total qui ne retombe pas sur la taille annoncée (fichier modifié pendant la lecture)', async () => {
    // Le fichier est rouvert à CHAQUE tranche : un client de synchro tiers peut le
    // changer entre deux, et la recomposition serait incohérente EN SILENCE.
    const bytes = Uint8Array.from({ length: 20 }, (_, i) => i)
    const s = new SafBackupStorage({ chunkBytes: 6 })
    await s.writeFile('mouvant.bin', bytesToB64(bytes), { encoding: 'base64' })
    __forceAnnouncedSize(26) // le natif annonce 26 octets, la lecture n'en rend que 20
    const err = await s.readFile('mouvant.bin', { encoding: 'base64' }).then(
      () => null,
      (e) => e,
    )
    expect(err.code).toBe(WARNING_CODES.SAF_SIZE_MISMATCH)
    expect(err.params).toEqual({ path: 'mouvant.bin', read: 20, expected: 26 })
    expect(err.message, 'le verbatim diagnostique survit dans .message').toMatch(/taille incohérente/)
  })

  it("n'applique PAS ce contrôle quand le fournisseur SAF annonce une taille de 0", async () => {
    // DocumentFile.length() rend 0 chez certains fournisseurs : un contrôle
    // inconditionnel casserait de vraies restaurations.
    const bytes = Uint8Array.from({ length: 20 }, (_, i) => i)
    const b64 = bytesToB64(bytes)
    const s = new SafBackupStorage({ chunkBytes: 6 })
    await s.writeFile('taille-zero.bin', b64, { encoding: 'base64' })
    __forceAnnouncedSize(0)
    expect(await s.readFile('taille-zero.bin', { encoding: 'base64' })).toBe(b64)
  })

  it('rejette un pont natif qui ne sait pas découper, au lieu de boucler sans fin', async () => {
    const s = new SafBackupStorage({ chunkBytes: 6 })
    await s.writeFile('vieux.txt', 'peu importe')
    __dropEof() // natif antérieur au correctif : pas de `eof`
    const err = await s.readFile('vieux.txt').then(
      () => null,
      (e) => e,
    )
    expect(err.code).toBe(WARNING_CODES.SAF_DESYNC)
    expect(err.params).toEqual({ path: 'vieux.txt' })
    expect(err.message, 'le verbatim diagnostique survit dans .message').toMatch(/désynchronisé/)
  })

  it('échoue bruyamment si une tranche NON finale porte du remplissage « = » plutôt que de rendre un fichier corrompu', async () => {
    const bytes = Uint8Array.from({ length: 20 }, (_, i) => i)
    const s = new SafBackupStorage({ chunkBytes: 6 })
    await s.writeFile('mal-aligne.bin', bytesToB64(bytes), { encoding: 'base64' })
    // Natif simulé qui rend des tranches de 4 octets : 4 n'est pas multiple de 3,
    // chaque tranche non finale se termine donc par « == » et la concaténation des
    // base64 serait silencieusement invalide.
    __forceNativeChunk(4)
    const err = await s.readFile('mal-aligne.bin', { encoding: 'base64' }).then(
      () => null,
      (e) => e,
    )
    expect(err.code).toBe(WARNING_CODES.SAF_CHUNK_ALIGN)
    // DÈS LA PREMIÈRE tranche (offset 0) le base64 rendu porte du remplissage : 4 octets
    // décodent 8 caractères base64 se terminant par « == » — la garde mord d'entrée.
    expect(err.params).toEqual({ offset: 0, path: 'mal-aligne.bin' })
    expect(err.message, 'le verbatim diagnostique survit dans .message').toMatch(/non alignée/)
  })
})

// DÉCODAGE UTF-8 EN FLUX (lot « restauration lourde », 06/09). L'ancienne fin de
// readFile empilait QUATRE exemplaires du fichier : parts (base64), la chaîne
// jointe, TOUS les octets, puis TOUT le texte — ~5-6× la taille du fichier
// cohabitaient en mémoire, plus une boucle charCodeAt plein-fichier en CPU.
// Désormais chaque tranche est décodée À MESURE par un TextDecoder en mode
// stream : jamais la chaîne base64 complète ni le fichier entier en octets ne
// vivent en mémoire (pic ~2×, la copie de JSON.parse en plus). Au passage,
// DURCISSEMENT voulu : fatal:true — un contenu réellement non-UTF-8 lève
// BRUYAMMENT au lieu de rendre des caractères de remplacement en silence (le
// catch par dossier de readBackup le consigne dans errors, comme tout fichier
// abîmé). Le chemin base64, lui, est inchangé : voir les tests « lecture par
// tranches » ci-dessus (recomposition octet pour octet, y compris à la taille
// de tranche réelle de 384 Kio).
describe('SafBackupStorage : décodage utf8 en flux', () => {
  it('recompose EXACTEMENT un texte dont un émoji de 4 octets chevauche une frontière de tranche', async () => {
    // « 🧶 » encode 4 octets (F0 9F A7 B6) et démarre à l'octet 3 : la frontière
    // de la première tranche de 6 le coupe APRÈS son 3ᵉ octet — et presque chaque
    // frontière suivante coupe un autre caractère multi-octets. En mode stream, le
    // décodeur bufferise chaque séquence incomplète et la complète à la tranche
    // suivante (garanti par la spec WHATWG Encoding) : c'est ce que ce test prouve.
    const texte = 'abc🧶🧵çàé — tricot serré'
    const octets = new TextEncoder().encode(texte)
    expect(octets.length, 'le fixture doit tenir sur PLUSIEURS tranches').toBeGreaterThan(6)
    expect(octets[3], "l'émoji doit démarrer à l'octet 3").toBe(0xf0)
    expect(octets[6] & 0xc0, "la frontière de tranche doit couper l'émoji en plein milieu").toBe(0x80)

    const s = new SafBackupStorage({ chunkBytes: 6 })
    await s.writeFile('notes-emoji.md', texte)
    expect(await s.readFile('notes-emoji.md')).toBe(texte)
    expect(__calls.readFile, 'la lecture doit être réellement multi-tranches').toBeGreaterThan(1)
  })

  it('rejette BRUYAMMENT un contenu non-UTF-8 au lieu de rendre des caractères de remplacement', async () => {
    // 0xFF 0xFE : jamais du UTF-8 valide (et signature d'un BOM UTF-16 — typique
    // d'un fichier produit hors de l'app). L'ancien décodeur, non-fatal, rendait
    // des caractères de remplacement EN SILENCE ; fatal:true l'interdit.
    const s = new SafBackupStorage({ chunkBytes: 6 })
    const corrompu = Uint8Array.of(
      0xff, 0xfe, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
      0x49, 0x4a, 0x4b, 0x4c, 0x4d, 0x4e, 0x4f, 0x50, 0x51, 0x52,
    )
    await s.writeFile('corrompu.bin', bytesToB64(corrompu), { encoding: 'base64' })
    await expect(s.readFile('corrompu.bin')).rejects.toThrow()

    // Variante : une séquence multi-octets TRONQUÉE en toute fin de fichier. Le
    // décodeur en mode stream la bufferise (rien à signaler pendant les tranches),
    // et c'est le flush FINAL qui doit lever — sans lui, l'octet orphelin passerait.
    const tronque = Uint8Array.of(0x61, 0x62, 0x63, 0x64, 0x65, 0xc3)
    await s.writeFile('tronque.bin', bytesToB64(tronque), { encoding: 'base64' })
    await expect(s.readFile('tronque.bin')).rejects.toThrow()
  })

  it('readBackup écarte le dossier concerné, le consigne dans errors et CONTINUE (durcissement fatal:true)', async () => {
    // Côté restauration, le rejet est rattrapé par le try/catch PAR DOSSIER de
    // readBackup : un projet.json qui n'est pas de l'UTF-8 valide écarte ce projet
    // EN ENTIER (visiblement, dans errors) — jamais un plantage global de la
    // restauration, jamais une corruption muette.
    const s = new SafBackupStorage({ chunkBytes: 6 })
    await s.writeFile(
      'Projets/p [1]/projet.json',
      bytesToB64(Uint8Array.of(0xff, 0xfe, 0x7b, 0x7d)),
      { encoding: 'base64' },
    )
    const { readBackup } = await import('@/backup/restore')
    const snapshot = await readBackup(s)
    expect(snapshot.projects).toEqual([])
    expect(snapshot.errors).toHaveLength(1)
    expect(snapshot.errors[0].where).toBe('Projets/p [1]')
  })
})

// onChunk (restauration lourde) : option ADDITIVE de readFile — chaque
// tranche réussie ré-émet le CUMUL d'octets lus du fichier, pour que la sous-barre
// du dossier en cours (restore.js) vive à la cadence réelle du disque (~0,5-2 s par
// tranche de 384 Kio sur tablette) au lieu de celle du dossier (10-25 s pour 8 Mo,
// retour terrain sur marisol-shawl : « j'ai cru qu'il avait planté »). Le garde-fou
// d'intégrité (taille annoncée) reste APRÈS la boucle : rien de ce qui touche à la
// fiabilité ne bouge, l'option ne fait que OBSERVER.
describe('SafBackupStorage : onChunk — le cumul d’octets à chaque tranche', () => {
  it('émet onChunk après CHAQUE tranche, avec le cumul depuis le début du fichier', async () => {
    // 50 octets, tranches de 6 : 8 tranches pleines + une dernière de 2.
    const bytes = Uint8Array.from({ length: 50 }, (_, i) => (i * 7 + 3) % 256)
    const b64 = bytesToB64(bytes)
    const s = new SafBackupStorage({ chunkBytes: 6 })
    await s.writeFile('gros-onchunk.bin', b64, { encoding: 'base64' })

    const cums = []
    expect(
      await s.readFile('gros-onchunk.bin', { encoding: 'base64', onChunk: (n) => cums.push(n) }),
    ).toBe(b64)
    // Y compris la tranche FINALE (le cumul doit atteindre exactement la taille) —
    // et exactement UN cumul par aller-retour natif.
    expect(cums).toEqual([6, 12, 18, 24, 30, 36, 42, 48, 50])
    expect(__calls.readFile, 'la lecture doit être réellement multi-tranches').toBe(9)
  })

  it('reste optionnel — et un fichier vide émet un unique cumul à 0', async () => {
    const s = new SafBackupStorage({ chunkBytes: 6 })
    await s.writeFile('vide-onchunk.txt', '')
    const cums = []
    await expect(s.readFile('vide-onchunk.txt', { onChunk: (n) => cums.push(n) })).resolves.toBe('')
    expect(cums).toEqual([0])
    // Sans l'option : comportement strictement inchangé (contrat additif).
    await expect(s.readFile('vide-onchunk.txt')).resolves.toBe('')
  })

  it('un fichier modifié PENDANT la lecture rejette malgré onChunk — aucun état mensonger ne survit', async () => {
    // Les cumuls intermédiaires ont pu être émis, mais le garde-fou de fin (taille
    // annoncée) rejette APRÈS la boucle : la promesse échoue, l'appelant (restore.js)
    // jette le tout via son catch par dossier — l'option n'a jamais le dernier mot
    // sur l'intégrité.
    const bytes = Uint8Array.from({ length: 20 }, (_, i) => i)
    const s = new SafBackupStorage({ chunkBytes: 6 })
    await s.writeFile('mouvant-onchunk.bin', bytesToB64(bytes), { encoding: 'base64' })
    __forceAnnouncedSize(26)
    const cums = []
    await expect(
      s.readFile('mouvant-onchunk.bin', { encoding: 'base64', onChunk: (n) => cums.push(n) }),
    ).rejects.toThrow(/taille incohérente/)
    expect(cums).toEqual([6, 12, 18, 20])
  })
})

// Écriture PAR TRANCHES (même correctif, sens inverse). Le plantage relevé sur la
// tablette pendant la sauvegarde automatique n'était pas dans `PluginResult.toString`
// (la réponse) mais dans `Bridge.callPluginMethod` (les ARGUMENTS de l'appel) :
// Capacitor sérialise `call.getData()` en JSON avant même d'invoquer la méthode du
// plugin. Une allocation de 3,18 Mo refusée sur 16 Mo de tas, soit le base64 d'un
// fichier de 2,4 Mo. La même sauvegarde était pourtant passée deux heures plus tôt :
// le chemin n'est pas mort, il est À LA LIMITE — il cède selon la fragmentation.
describe('SafBackupStorage : écriture par tranches', () => {
  it('écrit un fichier binaire en plusieurs tranches et le relit octet pour octet', async () => {
    // 50 octets : 8 tranches pleines de 6 + une dernière de 2.
    const bytes = Uint8Array.from({ length: 50 }, (_, i) => (i * 11 + 5) % 256)
    const b64 = bytesToB64(bytes)
    const s = new SafBackupStorage({ chunkBytes: 6 })
    await s.writeFile('gros-ecrit.bin', b64, { encoding: 'base64' })

    expect(await s.readFile('gros-ecrit.bin', { encoding: 'base64' })).toBe(b64)
    // Preuve que le découpage a bien eu lieu : sans elle, une écriture d'un seul
    // bloc passerait aussi. 9 tranches, aucun aller-retour de plus (la publication
    // se fait DANS le dernier appel, pas dans un appel de renommage supplémentaire).
    expect(__calls.writeFile, "le fichier doit partir en plusieurs allers-retours").toBe(9)
  })

  it('gère le cas limite du fichier dont la taille est un MULTIPLE EXACT de la tranche', async () => {
    // 12 octets pour des tranches de 6 : c'est la 2ᵉ tranche, pleine, qui doit porter
    // `last` — un `>` au lieu d'un `>=` enverrait une 3ᵉ tranche vide, ou pire, aucune
    // tranche finale et donc aucun fichier publié.
    const bytes = Uint8Array.from({ length: 12 }, (_, i) => 150 + i)
    const b64 = bytesToB64(bytes)
    const s = new SafBackupStorage({ chunkBytes: 6 })
    await s.writeFile('pile-ecrit.bin', b64, { encoding: 'base64' })

    expect(await s.readFile('pile-ecrit.bin', { encoding: 'base64' })).toBe(b64)
    expect(__calls.writeFile).toBe(2)
  })

  it("écrit de l'UTF-8 dont un accent CHEVAUCHE une frontière de tranche", async () => {
    // « é » occupe les octets 5 et 6 : avec des tranches de 6 octets, il est coupé
    // exactement en deux. Le découpage se fait donc sur les OCTETS, jamais sur les
    // caractères de la chaîne JavaScript.
    const texte = 'abcdeéfghij ç à ü — très serré'
    expect(
      new TextEncoder().encode(texte).indexOf(0xc3),
      "le fixture ne coupe plus d'accent : le test ne prouverait plus rien",
    ).toBe(5)

    const s = new SafBackupStorage({ chunkBytes: 6 })
    await s.writeFile('notes-ecrites.md', texte)
    expect(await s.readFile('notes-ecrites.md')).toBe(texte)
    expect(__calls.writeFile).toBeGreaterThan(1)
  })

  it('un petit fichier ne coûte QU’UN seul aller-retour, sans fichier temporaire', async () => {
    const s = new SafBackupStorage()
    await s.writeFile('reglages.json', '{"theme":"clay"}')
    expect(await s.readFile('reglages.json')).toBe('{"theme":"clay"}')
    expect(__calls.writeFile, 'un JSON de réglages ne doit pas payer plusieurs tranches').toBe(1)
    expect(await s.exists('reglages.json.part')).toBe(false)
  })

  it('une chaîne vide reste un seul aller-retour', async () => {
    const s = new SafBackupStorage({ chunkBytes: 6 })
    await s.writeFile('vide.txt', '')
    expect(__calls.writeFile).toBe(1)
    expect(await s.readFile('vide.txt')).toBe('')
  })

  it("découpe aussi un base64 NON canonique (enroulé sur plusieurs lignes) sans le corrompre", async () => {
    // Un encodeur tiers peut produire du base64 avec des retours à la ligne : la
    // découpe de la chaîne telle quelle tomberait alors à côté des frontières
    // d'octets. Ce cas doit repasser par les octets, pas produire un fichier faux.
    const bytes = Uint8Array.from({ length: 45 }, (_, i) => (i * 3 + 1) % 256)
    const plat = bytesToB64(bytes)
    const enroule = `${plat.slice(0, 20)}\n${plat.slice(20)}`
    const s = new SafBackupStorage({ chunkBytes: 6 })
    await s.writeFile('enroule.bin', enroule, { encoding: 'base64' })
    expect(await s.readFile('enroule.bin', { encoding: 'base64' })).toBe(plat)
  })

  it("ATOMICITÉ : une écriture interrompue laisse l'ANCIEN fichier intact, jamais un fichier tronqué sous le nom final", async () => {
    const s = new SafBackupStorage({ chunkBytes: 6 })
    const ancien = bytesToB64(Uint8Array.from({ length: 4 }, (_, i) => 0xa0 + i))
    await s.writeFile('photo.webp', ancien, { encoding: 'base64' })

    const nouveau = bytesToB64(Uint8Array.from({ length: 50 }, (_, i) => (i * 13 + 7) % 256))
    __abortAfterChunks(3) // tuée après 3 tranches sur 9
    await expect(s.writeFile('photo.webp', nouveau, { encoding: 'base64' })).rejects.toThrow(/interrompue/)

    // C'EST le point de conception de ce lot : le nom final ne porte que du contenu
    // complet. Une photo à moitié écrite sous son nom définitif ne serait JAMAIS
    // réécrite (l'orchestrateur écrit les fichiers lourds de façon incrémentale,
    // « seulement s'ils manquent ») — une sauvegarde silencieusement corrompue.
    expect(await s.readFile('photo.webp', { encoding: 'base64' })).toBe(ancien)
    // Le fichier temporaire, lui, existe : c'est un résidu inerte, jeté à la
    // prochaine écriture du même chemin.
    expect(await s.exists('photo.webp.part')).toBe(true)
  })

  it("refuse de PUBLIER quand le total écrit ne retombe pas sur la taille annoncée", async () => {
    const s = new SafBackupStorage({ chunkBytes: 6 })
    await s.writeFile('journal.bin', bytesToB64(Uint8Array.of(1, 2, 3)), { encoding: 'base64' })

    const nouveau = bytesToB64(Uint8Array.from({ length: 50 }, (_, i) => (i * 17 + 2) % 256))
    __truncateLastChunk() // une tranche partiellement écrite (flux coupé, disque plein)
    await expect(s.writeFile('journal.bin', nouveau, { encoding: 'base64' })).rejects.toThrow(
      /ecriture incomplete/,
    )
    expect(await s.readFile('journal.bin', { encoding: 'base64' })).toBe(
      bytesToB64(Uint8Array.of(1, 2, 3)),
    )
  })

  it("écrit quand même chez un fournisseur SAF dont length() rend 0", async () => {
    // Symétrique du contrôle de taille en lecture : inconditionnel, le contrôle de
    // séquence refuserait la 2ᵉ tranche chez ces fournisseurs et PLUS AUCUN gros
    // fichier ne s'écrirait — une régression bien pire que le plantage corrigé.
    const bytes = Uint8Array.from({ length: 50 }, (_, i) => (i * 5 + 9) % 256)
    const b64 = bytesToB64(bytes)
    const s = new SafBackupStorage({ chunkBytes: 6 })
    __forceBlindLength()
    await s.writeFile('aveugle.bin', b64, { encoding: 'base64' })
    expect(await s.readFile('aveugle.bin', { encoding: 'base64' })).toBe(b64)
  })

  it('À LA TAILLE DE TRANCHE RÉELLE : un fichier de 500 Kio part en 2 tranches et revient intact', async () => {
    // Les autres tests utilisent des tranches de 6 octets — utiles pour les
    // frontières, mais incapables de faire apparaître ce qui ne casse qu'à
    // l'échelle : un pas de 524 288 caractères base64, une conversion de 393 216
    // octets d'un coup. C'est exactement le profil du fichier qui a fait planter la
    // tablette (2,4 Mo → 3,18 Mo de base64), en plus petit.
    const bytes = Uint8Array.from({ length: 500 * 1024 }, (_, i) => (i * 31 + 7) % 256)
    let bin = ''
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i])
    const b64 = btoa(bin)

    const s = new SafBackupStorage() // taille de tranche de PRODUCTION
    await s.writeFile('Projets/vrai/original.pdf', b64, { encoding: 'base64' })
    expect(await s.readFile('Projets/vrai/original.pdf', { encoding: 'base64' })).toBe(b64)
    // 500 Kio / 384 Kio = 2 tranches — juste au-dessus de la borne, pour prouver que
    // le chemin multi-tranches reste emprunté. Aucune n'a dépassé la borne : le mock
    // rejette toute charge utile supérieure à MAX_CHUNK_BYTES, comme le natif.
    expect(__calls.writeFile).toBe(2)
  })

  it("ATOMICITÉ UNIVERSELLE : même un petit fichier utf8 est publié par renommage, en UN seul appel", async () => {
    // Élargissement du 13/08 : l'ancienne protection était indexée sur la TAILLE, pas
    // sur le BESOIN. Un `projet.json` de 300 octets pouvait encore apparaître TRONQUÉ
    // sous son nom final — et restore.js fait `JSON.parse` sans garde, donc un seul
    // fichier court abîmé faisait échouer la restauration ENTIÈRE.
    const s = new SafBackupStorage()
    await s.writeFile('Projets/p [1]/projet.json', '{"name":"Pull Torsadé"}')
    // L'aller-retour doit rester UNIQUE : la publication tient dans le même appel.
    expect(__calls.writeFile, 'un fichier court ne doit pas payer un appel de plus').toBe(1)
    expect(await s.readFile('Projets/p [1]/projet.json')).toBe('{"name":"Pull Torsadé"}')
    expect(await s.exists('Projets/p [1]/projet.json.part')).toBe(false)
  })

  it("un petit fichier interrompu ne laisse PAS de fichier tronqué sous le nom final", async () => {
    const s = new SafBackupStorage()
    await s.writeFile('reglages.json', '{"theme":"clay"}')
    // Le natif simulé échoue pendant l'écriture du temporaire : le nom final ne doit
    // pas avoir bougé. C'est le trou que l'élargissement referme.
    __breakWriteAt('reglages.json')
    await expect(s.writeFile('reglages.json', '{"theme":"bento"}')).rejects.toThrow()
    expect(await s.readFile('reglages.json')).toBe('{"theme":"clay"}')
  })

  it("un mode « ajout » qui TRONQUE est refusé chez un fournisseur qui sait mesurer", async () => {
    // Chez un fournisseur qui mesure, c'est la garde de séquence (`have != offset`)
    // qui mord dès la 3ᵉ tranche : le temporaire ne porte que la tranche précédente.
    // La SONDE ne sert pas ici — son rôle est de rendre cette même garde obligatoire
    // là où length() rend 0 (test suivant).
    const b64 = bytesToB64(Uint8Array.from({ length: 50 }, (_, i) => (i * 19 + 3) % 256))
    const s = new SafBackupStorage({ chunkBytes: 6 })
    __breakAppendMode()
    await expect(s.writeFile('ajout-casse.bin', b64, { encoding: 'base64' })).rejects.toThrow(
      /desordonnee/,
    )
    expect(await s.exists('ajout-casse.bin'), 'rien ne doit être publié').toBe(false)
  })

  it("SONDE : chez un fournisseur AVEUGLE, un mode « ajout » qui tronque est encore refusé", async () => {
    // Sans la sonde, ce cas publiait un fichier ne contenant que la DERNIÈRE tranche,
    // sans une ligne de log — `__forceBlindLength` prouvait seulement que l'écriture
    // PASSAIT chez un tel fournisseur, pas qu'elle était CORRECTE.
    const b64 = bytesToB64(Uint8Array.from({ length: 50 }, (_, i) => (i * 23 + 11) % 256))
    const s = new SafBackupStorage({ chunkBytes: 6 })
    __forceBlindLength()
    __breakAppendMode()
    await expect(s.writeFile('aveugle-casse.bin', b64, { encoding: 'base64' })).rejects.toThrow()
    expect(await s.exists('aveugle-casse.bin'), 'rien ne doit être publié').toBe(false)
  })

  it("un JSON parti en UN SEUL appel est lui aussi VÉRIFIÉ avant publication", async () => {
    // L'atomicité universelle protège ces fichiers d'une INTERRUPTION, mais rien ne
    // disait ce qui avait réellement atterri : sans `total` annoncé, le natif reçoit
    // -1 et saute ses deux contrôles. Or c'est exactement ce chemin que prennent
    // projet.json, patron.json, laines.json et reglages.json — ceux dont une
    // troncature fait échouer la restauration ENTIÈRE.
    const s = new SafBackupStorage()
    await s.writeFile('laines.json', '[{"id":50,"brand":"Drops"}]')
    __truncateSingleWrite()
    await expect(s.writeFile('laines.json', '[{"id":51,"brand":"Katia"}]')).rejects.toThrow(
      /ecriture incomplete/,
    )
    expect(await s.readFile('laines.json')).toBe('[{"id":50,"brand":"Drops"}]')
  })

  it('une PHOTO partie en un seul appel est vérifiée par le natif, sans `total` annoncé', async () => {
    // `step` vaut 524 288 caractères : tout binaire ≤ 384 Kio prend ce chemin, et les
    // photos mesurées sur le Huawei font 54 706 / 67 464 / 84 150 octets. Toutes les
    // photos de la validation passent donc par là — sans `total`, rien n'était vérifié.
    // Le natif ne peut pas se fier à une longueur déduite côté application (fausse sur
    // un base64 enroulé), mais il a DÉJÀ DÉCODÉ : il compare ce qu'il a écrit à ce
    // qu'il relit.
    const photo = bytesToB64(Uint8Array.from({ length: 900 }, (_, i) => (i * 7 + 1) % 256))
    const s = new SafBackupStorage()
    await s.writeFile('Projets/p [1]/photo-abcd1234.webp', photo, { encoding: 'base64' })
    expect(__calls.writeFile, 'une photo courte doit rester un seul aller-retour').toBe(1)
    __truncateSingleWrite()
    await expect(
      s.writeFile('Projets/p [1]/photo-abcd1234.webp', photo, { encoding: 'base64' }),
    ).rejects.toThrow(/ecriture incomplete/)
    expect(await s.readFile('Projets/p [1]/photo-abcd1234.webp', { encoding: 'base64' })).toBe(photo)
  })

  it('FOURNISSEUR AVEUGLE : une écriture en UN SEUL appel est vérifiée par comptage', async () => {
    // Là où length() rend 0, le contrôle de taille s'efface — et si la branche de
    // comptage restait réservée aux écritures en plusieurs appels, un tel fournisseur
    // ne vérifierait toujours RIEN sur une photo ou un JSON court. C'est le second
    // morceau du correctif, sans lequel le premier ne couvre que les appareils qui
    // savent mesurer.
    const s = new SafBackupStorage()
    await s.writeFile('laines.json', '[{"id":50}]')
    __forceBlindLength()
    __truncateSingleWrite()
    await expect(s.writeFile('laines.json', '[{"id":51,"brand":"Katia"}]')).rejects.toThrow(
      /octets comptes/,
    )
    expect(await s.readFile('laines.json')).toBe('[{"id":50}]')
  })

  it("un base64 ENROULÉ parti en un seul appel n'est PAS rejeté à tort", async () => {
    // Le garde-fou ajouté ne doit pas casser ce qui marchait : un encodeur tiers peut
    // livrer du base64 sur plusieurs lignes. L'application n'en déduit AUCUNE taille
    // sur ce chemin, et le natif compare des octets qu'il tient lui-même.
    const plat = bytesToB64(Uint8Array.from({ length: 300 }, (_, i) => (i * 3) % 256))
    const enroule = `${plat.slice(0, 40)}\n${plat.slice(40)}`
    const s = new SafBackupStorage()
    await s.writeFile('enroule-court.bin', enroule, { encoding: 'base64' })
    expect(await s.readFile('enroule-court.bin', { encoding: 'base64' })).toBe(plat)
  })

  it('une chaîne vide et un fournisseur aveugle ne déclenchent AUCUN faux rejet', async () => {
    // `written > 0` est faux dans les deux cas : le contrôle s'efface au lieu de
    // refuser une écriture parfaitement légitime.
    const s = new SafBackupStorage()
    await s.writeFile('vide-verifie.txt', '')
    expect(await s.readFile('vide-verifie.txt')).toBe('')
    __forceBlindLength()
    await s.writeFile('aveugle-court.json', '{"a":1}')
    expect(await s.readFile('aveugle-court.json')).toBe('{"a":1}')
  })

  it('le natif REFUSE une tranche non alignée sur 4 caractères base64 plutôt que de corrompre le fichier', async () => {
    // Garde-fou d'alignement, côté natif : c'est lui qui attrape un appelant dont le
    // pas de découpe ne serait pas un multiple de 4 caractères. Une tranche non
    // finale mal alignée décoderait un nombre d'octets faux, et la suivante
    // repartirait au milieu d'un groupe — corruption SILENCIEUSE.
    const { RowtineSaf } = await import('@/backup/saf-plugin')
    await expect(
      RowtineSaf.writeFile({ path: 'x.bin', data: 'AAAAAA', encoding: 'base64', offset: 0, last: false }),
    ).rejects.toThrow(/non alignee/)
    await expect(
      RowtineSaf.writeFile({ path: 'x.bin', data: 'AAAA==', encoding: 'base64', offset: 0, last: false }),
    ).rejects.toThrow(/non alignee/)
    expect(await new SafBackupStorage().exists('x.bin')).toBe(false)
  })

  it("le natif REFUSE une tranche transmise en utf8 (couper de l'UTF-8 casserait un accent)", async () => {
    const { RowtineSaf } = await import('@/backup/saf-plugin')
    await expect(
      RowtineSaf.writeFile({ path: 'y.txt', data: 'abc', encoding: 'utf8', offset: 0, last: false }),
    ).rejects.toThrow(/base64/)
  })

  it('le natif REFUSE une tranche hors séquence', async () => {
    const { RowtineSaf } = await import('@/backup/saf-plugin')
    await expect(
      RowtineSaf.writeFile({ path: 'z.bin', data: 'AAAA', encoding: 'base64', offset: 12, last: false }),
    ).rejects.toThrow(/orpheline/)
    await RowtineSaf.writeFile({ path: 'z.bin', data: 'AAAA', encoding: 'base64', offset: 0, last: false })
    await expect(
      RowtineSaf.writeFile({ path: 'z.bin', data: 'BBBB', encoding: 'base64', offset: 99, last: false }),
    ).rejects.toThrow(/desordonnee/)
  })
})

// Round-trip de contrat COMPLET : prouve que la chaîne réelle
// collecte → sauvegarde → lecture → réécriture DB passe intégralement par
// l'adaptateur SafBackupStorage, pas seulement par MemoryBackupStorage
// directement (déjà couvert par tests/unit/backup-restore.spec.js). Fixtures
// calquées sur backup-orchestrator.spec.js/backup-restore.spec.js (mêmes
// champs), trimmées à l'essentiel : projet + patron forké relié + section +
// compteur + laine + réglage.
describe('round-trip contrat complet : backupAll → readBackup → writeSnapshotToDb via SafBackupStorage', () => {
  const PHOTO_A = 'data:image/jpeg;base64,AAAA'
  const PHOTO_B = 'data:image/png;base64,BBBB'
  const PDF = 'data:application/pdf;base64,CCCC'

  beforeEach(async () => {
    const { db } = await import('@/db/db')
    await db.open()
    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it("collecte → backupAll → readBackup → writeSnapshotToDb → collecte reproduit le snapshot d'origine", async () => {
    const { db, setSetting } = await import('@/db/db')
    const { collectBackupData } = await import('@/backup/collect')
    const { backupAll } = await import('@/backup/orchestrator')
    const { readBackup, writeSnapshotToDb } = await import('@/backup/restore')

    await db.patterns.bulkAdd([{ id: 9, name: 'Torsade', ownerProjectId: 1, photos: [PHOTO_B], pdf: PDF }])
    await db.projects.bulkAdd([
      {
        id: 1,
        name: 'Pull Torsadé',
        technique: 'aiguilles',
        patternId: 9,
        photos: [PHOTO_A, PHOTO_B],
        activeSectionId: 12,
        status: 'in_progress',
      },
    ])
    await db.sections.bulkAdd([{ id: 12, projectId: 1, patternId: 9, name: 'Dos', order: 0 }])
    await db.counters.bulkAdd([{ id: 20, projectId: 1, name: 'Rangs', value: 5 }])
    await db.yarns.bulkAdd([{ id: 50, brand: 'Drops', weight: 'DK', quantity: 5, reservations: { 1: 1 }, consumed: {} }])
    await setSetting('theme', 'clay')

    const snapshotA = await collectBackupData()

    // C'est ICI que réside la preuve : SafBackupStorage (adaptateur), pas
    // MemoryBackupStorage directement — la chaîne passe par RowtineSaf mocké.
    //
    // Tranches de 6 octets : le PARCOURS ENTIER (readBackup, restore.js) est ainsi
    // exercé en lecture découpée, pas seulement l'adaptateur isolé. Les fixtures
    // font quelques centaines d'octets, donc chaque projet.json / patron.md
    // traverse des dizaines de frontières de tranche — et « Pull Torsadé » y perd
    // son accent au premier décodage UTF-8 fautif.
    const storage = new SafBackupStorage({ chunkBytes: 6 })
    await backupAll(storage, snapshotA)

    const dbSnapshot = await readBackup(storage)

    // Base vidée entièrement (simule une réinstallation) avant restauration.
    await Promise.all(db.tables.map((t) => t.clear()))
    await writeSnapshotToDb(dbSnapshot)

    const snapshotB = await collectBackupData()

    expect(snapshotB.projects).toHaveLength(1)
    const p1 = snapshotB.projects.find((p) => p.id === 1)
    expect(p1).toMatchObject({ name: 'Pull Torsadé', patternId: 9, photos: [PHOTO_A, PHOTO_B] })
    // Le patron forké (instance) lui-même doit survivre au round-trip via
    // SafBackupStorage — nom, photos ET pdf (le payload le plus sensible à
    // l'encodage/décodage base64 côté adaptateur fichier).
    expect(p1.instancePattern).toMatchObject({ id: 9, name: 'Torsade', photos: [PHOTO_B], pdf: PDF })
    expect(p1.sections).toEqual([{ id: 12, projectId: 1, patternId: 9, name: 'Dos', order: 0 }])
    expect(p1.counters).toEqual([{ id: 20, projectId: 1, name: 'Rangs', value: 5 }])
    expect(snapshotB.yarns).toEqual([{ id: 50, brand: 'Drops', weight: 'DK', quantity: 5, reservations: { 1: 1 }, consumed: {} }])
    expect(snapshotB.settings.theme).toBe('clay')
  })
})
