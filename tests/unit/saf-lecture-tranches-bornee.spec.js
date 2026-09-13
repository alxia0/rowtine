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

const maxChunk = Number(JAVA.match(/MAX_CHUNK_BYTES\s*=\s*(\d+)\s*;/)?.[1])

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
