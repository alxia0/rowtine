// Implémentation « device » de BackupStorage sur SAF : délègue au plugin natif
// RowtineSaf, qui écrit sous le dossier désigné (DocumentFile). Fine couche de
// traduction (déballe { data }/{ entries }/{ exists }). Seul backend de stockage
// (le plugin MANAGE a été retiré). Le comportement natif
// réel est validé sur device.
//
// TRANCHES, DANS LES DEUX SENS (correctif mémoire du pont) : ni `readFile` ni
// `writeFile` ne font transiter plus de CHUNK_BYTES octets par appel natif. Le pic
// mémoire côté natif est ainsi borné par une CONSTANTE, pas par la taille du
// fichier — un PDF de patron de 3,4 Mo ne fait plus tomber la tablette Nexus 7
// (16 Mo de tas) dans la sérialisation JSON de Capacitor, ni au retour (lecture,
// `PluginResult.toString`) ni à l'aller (écriture, `Bridge.callPluginMethod` qui
// sérialise les arguments AVANT d'appeler la méthode du plugin).
import { RowtineSaf } from './saf-plugin'
// base64ToBytes/bytesToBase64 sont partagées avec memory-storage.js (même algorithme,
// même contrainte anti-spread) ET avec zip-import.js/PdfViewer.vue : voir
// src/utils/base64.js.
import { base64ToBytes, bytesToBase64 } from '@/utils/base64'
// Les erreurs levées ici remontent JUSQU'AU RAPPORT DE SYNCHRO : elles portent un code du
// catalogue WARNING_CODES (fabrique E(), cf. warning-codes.js) pour être traduites à
// l'affichage — le verbatim français reste dans .message pour le diagnostic (console,
// logs). Toute levée passe par E : un `new Error` nu dans ce fichier est une régression
// du canal, interdite par la garde de tests/unit/warnings-no-french.spec.js.
import { E, WARNING_CODES } from '@/utils/pattern-md/warning-codes'
// base64ByteLength partagée avec memory-storage.js (même algorithme, même contrainte :
// mesurer ne doit jamais coûter une copie complète du contenu) — cf. naming.js.
import { base64ByteLength } from './naming'

// Taille d'une tranche, en octets. MULTIPLE DE 3, impératif : le base64
// encode 3 octets en 4 caractères ; une tranche dont le nombre d'octets n'est pas
// multiple de 3 se termine par du remplissage « = » et la concaténation des
// tranches devient invalide. Doit rester ≤ MAX_CHUNK_BYTES du plugin natif, qui
// écrête de toute façon toute demande supérieure.
export const CHUNK_BYTES = 393216 // 384 Kio = 3 × 131072

// base64 STRICTEMENT canonique : alphabet standard, longueur multiple de 4,
// remplissage en fin seulement. C'est la condition pour découper la chaîne telle
// quelle (sans la décoder) : une donnée qui ne la remplit pas — base64 enroulé sur
// plusieurs lignes par un encodeur tiers, par exemple — repasse par les octets.
function isCanonicalBase64(str) {
  return str.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(str)
}

// Découpe un chemin de l'inventaire en [parent, base] : 'a/b/c' → ['a/b', 'c'] ;
// sans « / » (fichier à la racine) → ['', nom]. Cette couche ne produit jamais de
// slash final — le natif découpe lui aussi sur '/' (segments, cf. RowtineSafPlugin).
function splitParent(path) {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? ['', path] : [path.slice(0, slash), path.slice(slash + 1)]
}

export class SafBackupStorage {
  #chunkBytes
  // Cache d'instantanés de dossiers : Map<cheminDossier, Map<nom, isDir>>. Peuplé
  // par readdir (appel natif TOUJOURS exécuté — c'est l'instantané autoritaire) et
  // lu par exists : un exists natif coûte une énumération ContentResolver du parent
  // (~300 ms mesurés sur tablette lente), la lecture d'une Map déjà là coûte 0.
  // readFile ne passe JAMAIS par ici : contenu toujours frais, seul l'INVENTAIRE
  // est caché. Invalidation par own-mutation : toute écriture/suppression droppent
  // les entrées concernées. Borne de staleness RÉELLE : un instantané vit jusqu'au
  // prochain readdir du dossier SUR CETTE INSTANCE — et une instance ne vit qu'une
  // passe (getBackupStorage() fait un `new SafBackupStorage()` à chaque appel,
  // backup-service.js:23). Conséquence : un fichier créé/supprimé en externe pendant
  // une passe peut être vu avec retard jusqu'au readdir suivant — auto-réparé au
  // passage d'après.
  #dirCache = new Map()

  // `chunkBytes` n'existe que pour les tests (fixtures minuscules) : la production
  // n'en passe jamais. Une SEULE taille sert la lecture et l'écriture — un second
  // réglage dériverait sans que rien ne le dise. La signature et le contrat de
  // `readFile` et `writeFile` sont inchangés.
  constructor({ chunkBytes = CHUNK_BYTES } = {}) {
    if (!Number.isInteger(chunkBytes) || chunkBytes <= 0 || chunkBytes % 3 !== 0) {
      throw E(WARNING_CODES.SAF_CHUNK_SIZE, { bytes: chunkBytes }, `taille de tranche invalide (multiple de 3 positif attendu) : ${chunkBytes}`)
    }
    this.#chunkBytes = chunkBytes
  }

  // La création change l'inventaire du PARENT : son instantané est droppé, quelle
  // que soit l'issue (dropper n'est jamais faux — au pire un readdir natif de plus).
  async mkdir(path) {
    try {
      return await RowtineSaf.mkdir({ path })
    } finally {
      this.#dropDirOf(path)
    }
  }

  // Envoie les tranches d'un fichier déjà mesuré. `sliceAt(offset)` rend le base64
  // de la tranche qui commence à cet octet. Le natif écrit dans `<nom>.part` et ne
  // publie sous le nom final qu'au dernier appel : une interruption laisse l'ANCIEN
  // fichier intact, jamais un fichier tronqué sous le bon nom.
  async #writeChunks(path, total, sliceAt) {
    const chunk = this.#chunkBytes
    for (let offset = 0; offset < total; offset += chunk) {
      const last = offset + chunk >= total
      await RowtineSaf.writeFile({
        path,
        data: sliceAt(offset),
        encoding: 'base64',
        offset,
        last,
        total,
      })
    }
  }

  // Contrat INCHANGÉ pour ses appelants (orchestrateur, manifeste, synchro des .md) :
  // writeFile(path, data, { encoding }) écrit le fichier entier et rend une promesse.
  //
  // Un fichier qui tient dans une tranche part EN UN SEUL aller-retour, charge utile
  // strictement inchangée : ni conversion, ni fichier temporaire, ni renommage — un
  // reglages.json coûte exactement ce qu'il coûtait.
  //
  // Au-delà, il part par tranches, toujours en base64 (découper de l'UTF-8 à un
  // octet arbitraire couperait un caractère accentué en deux). L'entrée déjà en
  // base64 (photos, PDF) est découpée SANS ÊTRE DÉCODÉE : 4 caractères valent 3
  // octets, donc un pas multiple de 4 tombe pile sur une frontière d'octet et
  // aucune tranche non finale ne porte de remplissage « = ».
  async writeFile(path, data, { encoding = 'utf8' } = {}) {
    const chunk = this.#chunkBytes
    const step = (chunk / 3) * 4 // caractères base64 par tranche — multiple de 4 par construction
    const str = data == null ? '' : String(data)

    // L'inventaire du parent est invalidé QUELLE QUE SOIT l'issue : une réussite
    // publie le fichier, mais un échec en pleine écriture laisse derrière lui le
    // résidu `<chemin>.part` — les deux changent le listing du parent, qu'un exists
    // servi du cache répondrait sinon à tort. Dropper un instantané n'est jamais
    // faux : au pire, un readdir natif de plus. Les allers-retours partent en
    // `return await`, comme mkdir/remove/rename : le finally d'un `return` non
    // awaité court à l'INITIATION de la promesse, pas à son règlement — dropper au
    // règlement est strictement plus sûr (toute repopulation du cache pendant
    // l'écriture est re-tuée après coup).
    try {
      if (encoding === 'base64') {
        // Court-circuit sans le moindre calcul : `step` caractères ne peuvent pas
        // valoir plus de `chunk` octets.
        if (str.length <= step) return await RowtineSaf.writeFile({ path, data: str, encoding })
        if (isCanonicalBase64(str)) {
          return await this.#writeChunks(path, base64ByteLength(str), (offset) => {
            const i = (offset / 3) * 4
            return str.slice(i, i + step)
          })
        }
        const bytes = base64ToBytes(str)
        return await this.#writeChunks(path, bytes.length, (offset) =>
          bytesToBase64(bytes.subarray(offset, offset + chunk)),
        )
      }

      // UTF-8 : `str.length` compte des unités UTF-16, pas des octets — « é » en vaut
      // une pour deux octets. Seul TextEncoder donne la taille réelle.
      const bytes = new TextEncoder().encode(str)
      // `total` est annoncé MÊME quand tout part en un seul appel : sans lui le natif
      // reçoit -1 et ne vérifie RIEN de ce qui a atterri. Or ce sont précisément les
      // fichiers de ce chemin (projet.json, patron.json, laines.json, reglages.json…)
      // dont une troncature fait échouer la restauration ENTIÈRE — `restore.js` les
      // passe à `JSON.parse` sans garde.
      //
      // ⚠️ PAS sur le chemin base64 ci-dessus : son court-circuit ne passe jamais par
      // `isCanonicalBase64`, donc `base64ByteLength` y serait FAUX sur un base64
      // enroulé sur plusieurs lignes — alors que le décodeur Java, lui, ignore les
      // blancs. On rejetterait une écriture parfaitement légitime.
      if (bytes.length <= chunk) {
        return await RowtineSaf.writeFile({ path, data: str, encoding, total: bytes.length })
      }
      return await this.#writeChunks(path, bytes.length, (offset) =>
        bytesToBase64(bytes.subarray(offset, offset + chunk)),
      )
    } finally {
      this.#dropDirOf(path)
    }
  }

  // Contrat INCHANGÉ pour les appelants (sauvegarde, restauration, synchro des
  // .md) : rend la chaîne complète, texte si `encoding` vaut 'utf8', base64 sinon.
  // Option ADDITIVE (restauration lourde) : `onChunk(cumul)` est appelée
  // après CHAQUE tranche réussie, avec le cumul d'octets du fichier (offset après
  // incrément, tranche finale comprise) — c'est ce qui fait vivre la sous-barre du
  // dossier en cours (restore.js) à la cadence du disque. Observer ne touche à rien :
  // le garde-fou d'intégrité (`expected`) reste après la boucle, hors de portée de
  // l'option. Sans l'option, comportement strictement identique.
  //
  // En interne, le transfert se fait TOUJOURS en base64, y compris pour 'utf8' :
  // découper de l'UTF-8 à un octet arbitraire couperait un caractère accentué en
  // deux. Le décodage UTF-8 n'a lieu qu'une fois toutes les tranches lues, mais EN
  // FLUX — chaque tranche passe SEULE par TextDecoder, en mode stream (voir la fin
  // de méthode) — `atob` seul rendrait du mojibake sur les accents.
  //
  // Un petit fichier (réglages, manifeste…) tient dans une tranche : le natif
  // répond `eof` dès le premier appel, donc UN SEUL aller-retour.
  //
  // PERTE DE DONNÉES LATENTE RÉPARÉE, au passage. L'ancien décodage natif
  // (`new String(bytes, UTF_8)`) conservait une BOM en tête de fichier ; TextDecoder
  // la retire. Or une BOM dans un `patron.md` (un éditeur de bureau en pose une)
  // faisait diverger `hash8(diskMd)` du témoin : `hasPendingExternalMdEdit` restait
  // vrai, et `orchestrator.js:94-96` retournait — L'ENTRÉE ENTIÈRE (patron.json,
  // photos, PDF) était donc exclue de la sauvegarde, indéfiniment et sans trace.
  // Ce n'était pas « une réécriture inutile » : c'était une entrée qui ne se
  // sauvegardait plus du tout. Elle repart.
  async readFile(path, { encoding = 'utf8', onChunk } = {}) {
    const chunk = this.#chunkBytes
    const parts = []
    let offset = 0
    let expected = null // taille annoncée par la PREMIÈRE tranche
    for (;;) {
      const res = await RowtineSaf.readFile({ path, encoding: 'base64', offset, length: chunk })
      const data = res?.data ?? ''
      // `eof` et `bytesRead` sont EXIGÉS. Pas de repli « vieux natif » : un natif qui
      // ignorerait offset/length rendrait le fichier entier à chaque tour, et un repli
      // fondé sur la taille de la tranche ferait boucler sans fin en gonflant `parts`.
      // Le cas est de toute façon inatteignable — les fichiers web voyagent DANS l'APK,
      // jamais désynchronisés du natif.
      if (res?.eof === undefined || !Number.isFinite(res?.bytesRead)) {
        throw E(WARNING_CODES.SAF_DESYNC, { path }, `pont natif désynchronisé à ${path} : lecture par tranches non supportée`)
      }
      const read = res.bytesRead
      const done = res.eof === true
      if (expected === null && Number.isFinite(res?.size)) expected = res.size
      // Garde-fou d'alignement : une tranche NON finale qui porte du remplissage
      // « = » rendrait la concaténation invalide. Échouer bruyamment plutôt que
      // rendre un fichier silencieusement corrompu.
      if (!done && data.includes('=')) {
        throw E(WARNING_CODES.SAF_CHUNK_ALIGN, { offset, path }, `tranche non alignée à l'octet ${offset} de ${path} : concaténation base64 impossible`)
      }
      if (data) parts.push(data)
      offset += read
      // Progression par tranche : chaque aller-retour réussi ré-émet le
      // CUMUL d'octets du fichier, tranche FINALE comprise (émis avant le break) —
      // c'est le battement de la sous-barre du dossier en cours (~0,5-2 s par
      // tranche de 384 Kio sur tablette, contre 10-25 s immobiles pour 8 Mo sans
      // elle). Un échec ultérieur (garde-fou ci-dessous) rejette la promesse entière :
      // aucun cumul émis ne survit à une lecture qui échoue.
      onChunk?.(offset)
      if (done) break
      // Sans progression, la boucle tournerait indéfiniment.
      if (read <= 0) throw E(WARNING_CODES.SAF_READ_STUCK, { offset, path }, `lecture bloquée à l'octet ${offset} de ${path}`)
    }
    // Le fichier est rouvert à CHAQUE tranche : s'il change entre deux (le dossier est
    // visible de l'utilisatrice, un client de synchro tiers peut y toucher), les
    // décalages se désynchronisent et la recomposition est incohérente, en silence.
    // Le total lu doit donc retomber sur la taille annoncée.
    // ⚠️ `size > 0` est indispensable : DocumentFile.length() rend 0 chez certains
    // fournisseurs SAF, et un contrôle inconditionnel casserait de vraies lectures.
    if (expected > 0 && offset !== expected) {
      throw E(WARNING_CODES.SAF_SIZE_MISMATCH, { path, read: offset, expected }, `taille incohérente pour ${path} : ${offset} octets lus pour ${expected} annoncés — fichier modifié pendant la lecture ?`)
    }
    // Détection précoce de l'encodage demandé : le chemin base64 accumule les
    // tranches telles quelles (le contrat EST une chaîne base64) ; le chemin utf8
    // décode EN FLUX, tranche par tranche — jamais la chaîne base64 complète ni le
    // fichier entier en octets ne vivent en mémoire. Au pic, `parts` (~1,33× le
    // fichier, en base64) et la sortie décodée (~2×, en UTF-16) coexistent, soit
    // ~3× le fichier — contre ~8× avant ce lot (chaîne base64 jointe + octets +
    // chaîne décodée). fatal:true : un contenu non-UTF-8 échoue BRUYAMMENT
    // (consigné par dossier par readBackup) au lieu de rendre des caractères de
    // remplacement en silence — durcissement voulu, cohérent avec « jamais de
    // corruption muette » ; stream:true : le décodeur bufferise les séquences
    // multi-octets coupées à la frontière de tranche (garanti par la spec).
    if (encoding === 'base64') {
      return parts.join('')
    }
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let out = ''
    for (const tranche of parts) {
      out += decoder.decode(base64ToBytes(tranche), { stream: true })
    }
    out += decoder.decode() // vide le tampon des octets restants
    return out
  }

  async readdir(path = '') {
    const { entries } = await RowtineSaf.readdir({ path })
    // Le natif VIENT de répondre : cet instantané est autoritaire, il peut servir
    // les exists suivants du même dossier. readdir lui-même n'est JAMAIS servi du
    // cache — c'est lui qui rafraîchit l'inventaire, donc une modification externe
    // entre deux readdir est toujours vue.
    const inventory = new Map()
    for (const e of entries) inventory.set(e.name, e.isDir === true)
    this.#dirCache.set(path, inventory)
    return entries
  }

  // Servi par l'instantané du parent quand il en existe un (peuplé par readdir,
  // droppé par les mutations propres) : exists('a/b/c') lit la Map de 'a/b'. Un
  // fichier à la racine a pour parent '' — la racine se met en cache comme les
  // autres. Dossier absent → readdir [] → instantané vide → faux : parité native.
  // Limite connue : la racine '' est un dossier, pas un fichier nommé '' —
  // exists('') rend false là où le natif rend true ; aucun appelant actuel.
  async exists(path) {
    const [parent, base] = splitParent(path)
    if (!this.#dirCache.has(parent)) await this.readdir(parent)
    return this.#dirCache.get(parent)?.has(base) ?? false
  }

  // La suppression vide l'inventaire du PARENT et rend morts tous les instantanés
  // du sous-arbre supprimé (la clé === path ou dessous) : un exists dessous doit
  // repasser par un readdir, qui constatera l'absence.
  async remove(path) {
    try {
      return await RowtineSaf.remove({ path })
    } finally {
      this.#dropDirOf(path)
      this.#dropSubtree(path)
    }
  }

  async rename(from, to) {
    try {
      return await RowtineSaf.rename({ from, to })
    } finally {
      // Le sous-arbre from déménage, son parent perd l'entrée, celui de to la reçoit.
      // to est droppé lui aussi : s'il pré-existait comme dossier en cache, son
      // inventaire périmé resterait sinon serviable après l'écrasement.
      this.#dropDirOf(from)
      this.#dropDirOf(to)
      this.#dropSubtree(from)
      this.#dropSubtree(to)
    }
  }

  // Droppé l'instantané du dossier PARENT de path : fichiers et sous-dossiers d'un
  // dossier partagent ce même inventaire. '' — la racine — est un parent comme les
  // autres : un fichier posé à la racine change aussi son listing.
  #dropDirOf(path) {
    const [parent] = splitParent(path)
    this.#dirCache.delete(parent)
  }

  #dropSubtree(path) {
    const prefix = `${path}/`
    for (const key of this.#dirCache.keys()) {
      if (key === path || key.startsWith(prefix)) this.#dirCache.delete(key)
    }
  }
}
