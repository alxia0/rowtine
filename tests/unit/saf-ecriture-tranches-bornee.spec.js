// Écriture par tranches du pont SAF : le pic mémoire côté natif est borné par une
// CONSTANTE, pas par la taille du fichier. Miroir de la lecture, en fin de fichier.
// Les invariants vivent dans le Java, sans harnais de test JVM : on verrouille la SOURCE.
//
// Le Bridge Capacitor sérialise les arguments AVANT d'invoquer le plugin : seul le découpage
// côté JavaScript prévient l'OutOfMemoryError. Le natif rend la borne NON OPTIONNELLE en
// refusant toute charge hors borne, pour qu'un appelant distrait échoue partout, et pas
// seulement sur une tablette au petit tas.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHUNK_BYTES } from '@/backup/saf-storage'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const JAVA = fs.readFileSync(
  path.join(ROOT, 'android/app/src/main/java/com/rowtine/app/RowtineSafPlugin.java'),
  'utf-8',
)
const JS = fs.readFileSync(path.join(ROOT, 'src/backup/saf-storage.js'), 'utf-8')
// Vue « code seul » : les commentaires du fichier CITENT les pièges qu'ils décrivent
// (le spread interdit, par exemple). Sans les retirer, une garde chercherait son
// propre contre-exemple dans le commentaire qui l'explique et resterait rouge à jamais.
const JS_CODE = JS.replace(/^\s*\/\/.*$/gm, '')

const JAVA_CODE = JAVA.replace(/^\s*\/\/.*$/gm, '')

// Corps de writeFile SEUL, borne a la methode suivante : une garde qui balaierait
// tout le fichier trouverait ses motifs dans une AUTRE methode et deviendrait aveugle
// en silence si writeFile perdait les siens ou si les methodes etaient reordonnees.
const CORPS_WRITE = (() => {
  const debut = JAVA_CODE.indexOf('public void writeFile')
  const suite = JAVA_CODE.indexOf('@PluginMethod', debut)
  return JAVA_CODE.slice(debut, suite === -1 ? undefined : suite)
})()

const maxChunk = Number(JAVA.match(/MAX_CHUNK_BYTES\s*=\s*(\d+)\s*;/)?.[1])

describe('écriture par tranches : la borne mémoire du pont est structurelle', () => {
  it('le natif ÉCRÊTE la charge utile reçue : un appelant ne peut pas écrire un fichier entier en un appel', () => {
    // Sans ce refus, la borne redeviendrait une convention côté application : le
    // même code « marcherait » sur un téléphone récent et ferait replanter la
    // tablette selon l'état de la mémoire au moment de la sauvegarde.
    expect(
      JAVA_CODE,
      "l'écrêtage de la charge utile en écriture a disparu du Java",
    ).toMatch(/bytes\.length\s*>\s*MAX_CHUNK_BYTES/)
  })

  it('une tranche voyage TOUJOURS en base64 — jamais en utf8 découpé', () => {
    // Couper de l'UTF-8 à un octet arbitraire couperait un caractère accentué en
    // deux, et les deux moitiés seraient irrécupérables une fois écrites.
    expect(JAVA_CODE, "le refus des tranches en utf8 a disparu").toMatch(
      /chunked\s*&&\s*!b64/,
    )
  })

  it("le natif REFUSE une tranche non finale désalignée plutôt que d'écrire un fichier corrompu en silence", () => {
    // 4 caractères base64 = 3 octets. Une tranche non finale dont le base64 n'est
    // pas un multiple de 4, ou qui porte du remplissage « = », ne décode pas
    // exactement les octets voulus — et la tranche suivante repart au milieu d'un
    // groupe. C'est le pire cas possible pour une sauvegarde : elle se corrompt
    // sans rien dire.
    expect(JAVA_CODE, "le garde-fou d'alignement de l'écriture a disparu").toMatch(
      /data\.length\(\)\s*%\s*4\s*!=\s*0\s*\|\|\s*data\.indexOf\('='\)\s*>=\s*0/,
    )
  })

  it('ATOMICITÉ : une écriture en plusieurs appels passe par un document temporaire, jamais par le nom final', () => {
    expect(JAVA_CODE, 'PART_SUFFIX a disparu : les tranches retomberaient sous le nom final').toMatch(
      /PART_SUFFIX\s*=\s*"\.part"/,
    )
    expect(JAVA_CODE, 'le document temporaire ne dérive plus du nom cible').toMatch(
      /tmpName\s*=\s*name\s*\+\s*PART_SUFFIX/,
    )
    // La publication ne peut avoir lieu qu'APRÈS la dernière tranche : sans cette
    // sortie anticipée, chaque tranche renommerait, et le nom final porterait un
    // fichier tronqué dès la première.
    expect(JAVA_CODE, 'la sortie anticipée des tranches non finales a disparu').toMatch(
      /if\s*\(\s*!last\s*\)\s*\{\s*call\.resolve\(\);\s*return;\s*\}/,
    )
    expect(JAVA_CODE, 'la publication par renommage a disparu').toMatch(
      /DocumentsContract\.renameDocument\([\s\S]{0,120}tmp\.getUri\(\),\s*name\)/,
    )
  })

  it("les tranches 2..n ouvrent le flux en AJOUT, sans jamais réécrire depuis le début", () => {
    expect(JAVA_CODE, 'le mode d\'ouverture des tranches suivantes n\'est plus l\'ajout').toMatch(
      /mode\s*=\s*offset\s*==\s*0\s*\?\s*"wt"\s*:\s*"wa"/,
    )
    // Le message d'échec doit NOMMER le mode : « wa » n'est pas garanti chez tous
    // les fournisseurs SAF, et c'est la seule ligne de logcat qui l'identifiera
    // en un coup d'œil lors de la validation sur appareil.
    expect(JAVA_CODE, "l'échec d'ouverture en ajout ne nomme plus le mode").toMatch(
      /ajout en fin de fichier/,
    )
  })

  it('SONDE DE CAPACITÉ : les contrôles de longueur ne sont relâchés que chez un fournisseur AVEUGLE', () => {
    // DocumentFile.length() rend 0 chez certains fournisseurs — c'est déjà la raison
    // du `expected > 0` du contrôle de taille en lecture. Inconditionnels, ces deux
    // contrôles refuseraient la 2ᵉ tranche puis la publication chez eux, et PLUS
    // AUCUN gros fichier ne s'écrirait : une régression pire que le plantage corrigé.
    //
    // Mais les DEUX tombaient sur la MÊME réserve `> 0` : chez un fournisseur aveugle,
    // un mode « ajout » qui tronquerait publiait un fichier ne contenant que la
    // DERNIÈRE tranche, sans une ligne de log. La sonde tranche : on écrit la tranche 0
    // en « wt », on relit la longueur, et si elle concorde le fournisseur SAIT mesurer
    // ⇒ les deux contrôles redeviennent OBLIGATOIRES pour cette écriture.
    expect(CORPS_WRITE, "la sonde de capacité n'est plus armée à la tranche 0").toMatch(
      /offset\s*==\s*0\s*&&\s*!last\)\s*\{[\s\S]{0,160}measuringWrites\.put/,
    )
    expect(CORPS_WRITE, 'la sonde ne compare plus la longueur relue à celle écrite').toMatch(
      /tmp\.length\(\)\s*==\s*bytes\.length/,
    )
    expect(CORPS_WRITE, 'le contrôle de séquence ne consulte plus la sonde').toMatch(
      /\(measures\s*\|\|\s*have\s*>\s*0\)\s*&&\s*have\s*!=\s*offset/,
    )
    expect(CORPS_WRITE, 'la sonde n’est plus réservée aux écritures en plusieurs appels').toMatch(
      /measures\s*=\s*offset\s*>\s*0\s*&&\s*Boolean\.TRUE\.equals\(sonde\)/,
    )
    expect(CORPS_WRITE, 'le contrôle du total ne consulte plus la sonde').toMatch(
      /\(measures\s*\|\|\s*written\s*>\s*0\)\s*&&\s*written\s*!=\s*expected/,
    )
  })

  it('la sonde est indexée sur l’URI du document, jamais sur le chemin relatif', () => {
    // Deux dossiers désignés — ou une re-désignation en cours de session — produisent
    // le MÊME chemin relatif pour deux documents différents. Une entrée périmée ferait
    // refuser une écriture parfaitement légitime.
    expect(CORPS_WRITE, 'la sonde est repassée sur une clé ambiguë').toMatch(
      /measuringWrites\.(put|get|remove)\([\s\S]{0,40}tmp\.getUri\(\)\.toString\(\)/,
    )
  })

  it("FOURNISSEUR AVEUGLE : le natif COMPTE les octets avant de publier, au lieu de faire confiance", () => {
    // Là où length() ne dit rien, aucune des deux gardes n'a pu mordre. Compter en
    // faisant DÉFILER les octets (tampon fixe, rien ne s'accumule) est le seul moyen
    // de refuser un « ajout » qui tronquerait — et ça ne coûte rien aux appareils
    // validés, dont le fournisseur sait mesurer.
    expect(CORPS_WRITE, 'la vérification par comptage a disparu').toMatch(/countBytes\(tmp\)/)
    expect(JAVA_CODE, 'countBytes accumule désormais le contenu en mémoire').toMatch(
      /long countBytes\(DocumentFile[\s\S]{0,400}new byte\[8192\]/,
    )
  })

  it('la publication est refusée si le total écrit ne retombe pas sur la taille annoncée', () => {
    // Dernière occasion de refuser : une tranche perdue rend un fichier plus court,
    // et c'est au renommage que la corruption deviendrait définitive.
    expect(JAVA_CODE, "le contrôle du total à la publication a disparu").toMatch(
      /total\s*=\s*call\.getInt\("total",\s*-1\)/,
    )
    expect(JS_CODE, "l'application n'annonce plus la taille finale").toMatch(
      /offset,\s*last,\s*total,/,
    )
  })

  it("ATOMICITÉ UNIVERSELLE : aucun chemin n'écrit sous le nom final — même un fichier court", () => {
    // L'ancienne protection était indexée sur la TAILLE, pas sur le BESOIN : sous
    // 96 Kio, l'écriture restait `delete` → `create` → `write` sous le nom définitif,
    // donc un projet.json pouvait apparaître TRONQUÉ — et restore.js fait `JSON.parse`
    // sans garde, ce qui fait échouer la restauration ENTIÈRE, pas une entrée.
    expect(
      CORPS_WRITE.match(/createFile\("application\/octet-stream",\s*(\w+)\)/g) || [],
      'writeFile crée un document sous un nom autre que le temporaire',
    ).toEqual(['createFile("application/octet-stream", tmpName)'])
    // Et `chunked` ne doit plus commander le passage par le temporaire — seulement les
    // règles propres aux TRANCHES (base64 obligatoire, alignement).
    expect(CORPS_WRITE, 'le raccourci « petit fichier » est revenu').not.toMatch(
      /if\s*\(\s*!chunked\s*\)/,
    )
    expect(CORPS_WRITE, 'la notion de tranche a disparu des règles qui en dépendent').toMatch(
      /chunked\s*=\s*offset\s*>\s*0\s*\|\|\s*!last/,
    )
    // L'aller-retour reste UNIQUE côté application : un fichier court part en un appel.
    // (`await` toléré : les appels partent en `return await` pour que l'invalidation
    // du cache s'exécute au règlement, cf. saf-storage.js.)
    expect(JS_CODE, "le raccourci d'un seul aller-retour a disparu côté application").toMatch(
      /bytes\.length\s*<=\s*chunk\s*\)\s*\{?\s*return\s+(?:await\s+)?RowtineSaf\.writeFile\(\{\s*path,\s*data:\s*str,\s*encoding,\s*total:/,
    )
  })

  it('les NOMS obtenus sont constatés, jamais supposés', () => {
    // `createFile` peut désambiguïser en « x (1) », et un `renameDocument` qui rend un
    // URI non nul dit que l'opération n'a pas échoué, PAS sous quel nom le document a
    // atterri. On ne suppose rien du fournisseur : on constate. Aucune exécution
    // réussie n'exerce ces deux branches — elles ne peuvent pas être validées sur
    // appareil, seulement rendues infranchissables sans bruit.
    expect(CORPS_WRITE, 'le nom du temporaire créé n’est plus vérifié').toMatch(
      /!tmpName\.equals\(tmp\.getName\(\)\)/,
    )
    expect(CORPS_WRITE, 'la publication n’est plus confirmée par une relecture du nom').toMatch(
      /renameDocument[\s\S]{0,600}parent\.findFile\(name\)\s*==\s*null/,
    )
  })

  it('le pas de découpe en caractères base64 dérive de la tranche en octets — donc multiple de 4', () => {
    // 4 caractères = 3 octets : un pas qui ne serait pas (chunk / 3) * 4 tomberait
    // à côté d'une frontière d'octet, et le natif refuserait chaque tranche.
    expect(JS_CODE, 'le pas de découpe base64 ne dérive plus de la taille de tranche').toMatch(
      /step\s*=\s*\(chunk\s*\/\s*3\)\s*\*\s*4/,
    )
    expect(CHUNK_BYTES % 3, 'la tranche doit rester un multiple de 3').toBe(0)
    expect(
      CHUNK_BYTES,
      'envoyer plus que la borne native ferait rejeter chaque tranche',
    ).toBeLessThanOrEqual(maxChunk)
  })

  it('la tranche tient LARGEMENT dans le tas de 16 Mo de la Nexus 7', () => {
    // Borne ABSOLUE, répétée exprès : sans elle, ce fichier ne verrouille que du RELATIF, et un
    // MAX_CHUNK_BYTES de 12582912 (entier positif, multiple de 3) passerait en ramenant
    // l'OutOfMemoryError. 384 Kio retenus (393 216 = 3 × 131 072) : la pire allocation du pont
    // (char[] du JSONStringer, 2 octets/char au doublement) reste ~2 Mo, sous les 3,18 Mo qui
    // ont tué la tablette. Le seuil du test mord avant : 576 Kio (589 824) = 1,5× la valeur.
    expect(
      maxChunk,
      'la tranche dépasse le budget mémoire du pont : la Nexus 7 replanterait',
    ).toBeLessThanOrEqual(589824)
  })

  it('la purge du cache de dossiers PRÉCÈDE la résolution de la racine, comme avant les tranches', () => {
    // Le cache de dossiers du plugin garde des handles DocumentFile, qu'un rename/remove rend
    // périmés : writeFile le purge en toute première instruction. Purger APRÈS `treeRoot()`
    // capturerait la racine périmée, et aucun autre test ne le verrait (le mock de plugin n'a
    // pas de cache de dossiers).
    const purge = CORPS_WRITE.indexOf('clearDirCache()')
    const racine = CORPS_WRITE.indexOf('treeRoot()')
    expect(purge, 'la purge du cache a disparu de writeFile').toBeGreaterThan(-1)
    expect(racine, 'writeFile ne résout plus la racine').toBeGreaterThan(-1)
    expect(purge, 'la racine est résolue AVANT la purge : le handle peut être périmé').toBeLessThan(
      racine,
    )
  })

  it('la synchro des .md ignore elle aussi les résidus d’écriture', () => {
    // `readAssetFiles` ne saute que `.json` et `.md` : un résidu `patron.md.part` atterrirait
    // dans les assets du lecteur, et l'atomicité universelle le rend atteignable pour tout
    // fichier. Verrou sur la source, faute de pouvoir provoquer un résidu depuis ces tests.
    const SYNC = fs.readFileSync(path.join(ROOT, 'src/backup/patron-md-sync.js'), 'utf-8')
    const corps = SYNC.slice(SYNC.indexOf('async function readAssetFiles'))
    expect(
      corps.slice(0, corps.indexOf('return filesByName')),
      'un patron.md.part repartirait dans les assets du lecteur',
    ).toMatch(/\/\\\.\(part\|tmp\)\$\/i\.test\(entry\.name\)/)
  })

  it("l'encodage octets → base64 n'utilise PAS le spread, qui déborde la pile sur une tranche pleine", () => {
    // Le spread pousse un argument par octet. MESURÉ sur le V8 de Node : 98 304
    // arguments passent, 131 072 lèvent « Maximum call stack size exceeded » — une
    // tranche pleine est donc à 1,33× de la limite, et cette limite dépend du moteur
    // et de la pile déjà consommée. Le défaut ne frapperait que les GROS fichiers,
    // donc jamais un test aux fixtures minuscules : d'où cette garde sur la source.
    expect(JS_CODE, 'le spread est revenu dans la conversion octets → base64').not.toMatch(
      /fromCharCode\s*\(\s*\.\.\.|fromCharCode\s*\.\s*apply/,
    )
  })
})

// Verrou du CRITÈRE D'ACCEPTATION du correctif mémoire du pont natif :
//
//   « Le pic mémoire côté natif est borné par une CONSTANTE, pas par la taille
//     du fichier. »
//
// Ce que ce test protège ne peut pas être prouvé par un test JavaScript ordinaire :
// la borne vit dans le Java, et seul l'écrêtage CÔTÉ NATIF la rend structurelle —
// si c'était l'application qui choisissait seule la taille des tranches, un appelant
// distrait (ou un vieux bundle) redemanderait le fichier entier et ferait retomber
// la Nexus 7 (16 Mo de tas) dans l'OutOfMemoryError de call.resolve().
//
// Le dépôt n'a pas de harnais de test JVM pour le plugin (android/app/src/test ne
// contient que les stubs du gabarit Capacitor) et la consigne du lot interdit de
// construire l'APK : on verrouille donc les invariants sur la SOURCE Java
// directement, faute d'autre moyen.
describe('lecture par tranches : la borne mémoire du pont est structurelle', () => {
  it('le plugin natif déclare une taille de tranche maximale', () => {
    expect(
      Number.isInteger(maxChunk),
      'MAX_CHUNK_BYTES a disparu du Java : plus rien ne borne le pic mémoire du pont',
    ).toBe(true)
    expect(maxChunk).toBeGreaterThan(0)
  })

  it('cette taille tient LARGEMENT dans le tas de 16 Mo de la Nexus 7', () => {
    // Sans cette borne haute, le fichier ne verrouillerait que la FORME de la
    // constante, pas la borne : MAX_CHUNK_BYTES = 12582912 est un entier positif
    // multiple de 3, laisserait toute la suite verte, et ferait retomber la
    // tablette dans l'OutOfMemoryError exact que ce lot corrige.
    //
    // 1 Mio de tranche = ~1,4 Mio de caractères base64, dont le StringBuilder de
    // JSONStringer fait un char[] de ~2,8 Mio — déjà au-delà de ce qui restait
    // (2 505 Kio) au point d'échec relevé dans logcat. La valeur retenue (384 Kio)
    // donne une pire allocation unitaire de ~2 Mo, sous l'allocation fatale de
    // 3,18 Mo — marge ~1,6× (même arithmétique que le Java et la spec écriture).
    expect(
      maxChunk,
      'la tranche dépasse le budget mémoire du pont : la Nexus 7 replanterait',
    ).toBeLessThanOrEqual(1 << 20)
  })

  it('cette taille est un MULTIPLE DE 3 — sans quoi la concaténation des tranches base64 est invalide', () => {
    // 3 octets → 4 caractères base64. Une tranche non multiple de 3 se termine par
    // du remplissage « = » ; concaténée à la suivante, elle produit un fichier
    // silencieusement corrompu.
    expect(maxChunk % 3, `MAX_CHUNK_BYTES = ${maxChunk} n'est pas un multiple de 3`).toBe(0)
  })

  it('le natif ÉCRÊTE la longueur demandée : un appelant ne peut pas réclamer le fichier entier', () => {
    expect(
      JAVA,
      'sans écrêtage natif, la borne redevient une simple convention côté application',
    ).toMatch(/want\s*>\s*MAX_CHUNK_BYTES\)\s*want\s*=\s*MAX_CHUNK_BYTES/)
    // Et une longueur quelconque est ramenée à un multiple de 3.
    expect(JAVA, "l'alignement base64 n'est plus garanti côté natif").toMatch(/want\s*-=\s*want\s*%\s*3/)
  })

  it('le tampon natif est PRÉ-DIMENSIONNÉ à la tranche, sans accumulateur qui grossit', () => {
    expect(
      JAVA,
      'ByteArrayOutputStream est revenu : le tampon redevient proportionnel au fichier',
    ).not.toContain('ByteArrayOutputStream')
    expect(JAVA, 'le tampon doit être alloué une fois, à la taille de la tranche').toContain('new byte[want]')
  })

  it('le décalage est atteint par une BOUCLE : un skip() court ne peut pas décaler la lecture', () => {
    // InputStream.skip peut sauter MOINS que demandé sans lever d'exception. Un seul
    // in.skip(offset) rendrait alors les mauvais octets, en silence, et la
    // restauration écrirait un fichier corrompu sans qu'aucune erreur ne remonte.
    expect(JAVA, 'la boucle de rattrapage du décalage a disparu').toMatch(
      /while\s*\(\s*skipped\s*<\s*offset\s*\)/,
    )
    // Repli lorsque skip() ne progresse pas du tout : avancer d'un octet lu.
    expect(JAVA, 'sans repli, un skip() qui rend 0 boucle indéfiniment').toMatch(
      /in\.read\(\)\s*==\s*-1/,
    )
  })

  it("la taille de tranche de l'application respecte la borne du natif", () => {
    expect(CHUNK_BYTES % 3, 'la tranche demandée doit être un multiple de 3').toBe(0)
    expect(
      CHUNK_BYTES,
      'demander plus que la borne native ferait écrêter en silence à chaque tranche',
    ).toBeLessThanOrEqual(maxChunk)
  })
})
