import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const RES = resolve(ROOT, 'android/app/src/main/res')

// Le defaut que ces gardes empechent de revenir : jusqu'au 18/08/2026 l'ecran de
// demarrage etait un bitmap pose en fond de FENETRE. Android etire un fond de
// fenetre pour le remplir, sans conserver les proportions. Mesure sur appareil :
// le motif sortait a 0,788 sur le Huawei et 1,151 sur la Nexus 7, pour 0,99 a la
// source. Un bitmap plein ecran ne doit donc plus JAMAIS revenir ici.

describe('ecran de demarrage Android', () => {
  it('ne contient plus aucun splash.webp', () => {
    const coupables = readdirSync(RES, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) => readdirSync(join(RES, d.name)).map((f) => join(d.name, f)))
      .filter((p) => p.endsWith('splash.webp'))
    expect(coupables).toEqual([])
  })

  it('dessine le fond en XML, pas en bitmap', () => {
    const xml = readFileSync(resolve(RES, 'drawable/splash.xml'), 'utf8')
    expect(xml).toContain('<layer-list')
    // La balise <gradient> est isolee AVANT d'etre inspectee : le commentaire
    // d'en-tete du fichier cite les memes trois couleurs a titre documentaire,
    // et une assertion lancee sur le fichier entier resterait verte meme si le
    // degrade lui-meme etait faux. Chaque couleur est en plus rattachee a SON
    // attribut, pour que permuter start/end fasse rougir le test.
    const gradientMatch = xml.match(/<gradient[\s\S]*?\/>/)
    expect(gradientMatch).not.toBeNull()
    const gradient = gradientMatch[0]
    expect(gradient).toMatch(/android:angle="315"/)
    expect(gradient).toMatch(/android:startColor="#F0EDCB"/)
    expect(gradient).toMatch(/android:centerColor="#A7BA9A"/)
    expect(gradient).toMatch(/android:endColor="#759273"/)
  })

  it('pose la tuile a taille fixe et dessine le herisson, jamais un autre drawable', () => {
    const xml = readFileSync(resolve(RES, 'drawable/splash.xml'), 'utf8')
    // Meme precaution que pour <gradient> ci-dessus : l'element qui porte la
    // tuile est isole avant d'etre inspecte, pour que chaque attribut soit
    // rattache a CET element, pas au fichier entier.
    const itemMatch = xml.match(/<item\s+android:width="@dimen\/splash_tuile"[\s\S]*?\/>/)
    expect(itemMatch).not.toBeNull()
    const item = itemMatch[0]
    // La ligne qui compte : l'element qui porte la tuile doit fixer SES DEUX
    // dimensions. Sans elles, le bitmap remplit l'element, donc l'ecran.
    expect(item).toMatch(/android:width="@dimen\/splash_tuile"/)
    expect(item).toMatch(/android:height="@dimen\/splash_tuile"/)
    expect(item).toContain('android:gravity="center"')
    // Et c'est LE herisson qui doit y etre dessine, pas n'importe quel autre
    // drawable (mutation prouvee : @drawable/ic_launcher_background passait).
    expect(item).toMatch(/android:drawable="@drawable\/splash_herisson"/)
    expect(xml).not.toContain('match_parent')
    expect(xml).not.toContain('fill_parent')
  })

  it('le theme de lancement pointe le dessin XML, pas autre chose', () => {
    const styles = readFileSync(resolve(RES, 'values/styles.xml'), 'utf8')
    // Isole le style AppTheme.NoActionBarLaunch : c'est lui, et lui seul, que
    // Theme.SplashScreen lit sur Android <= 11 (values-v31/styles.xml couvre
    // Android 12+, avec un theme different). Mutation prouvee : remplacer
    // @drawable/splash par @color/ic_launcher_background laissait passer
    // toutes les autres assertions de ce fichier.
    const styleMatch = styles.match(/<style name="AppTheme\.NoActionBarLaunch"[\s\S]*?<\/style>/)
    expect(styleMatch).not.toBeNull()
    const style = styleMatch[0]
    expect(style).toContain('<item name="android:background">@drawable/splash</item>')
  })

  it('donne une taille de tuile a chaque famille d ecran', () => {
    const tel = readFileSync(resolve(RES, 'values/dimens.xml'), 'utf8')
    const telLarge = readFileSync(resolve(RES, 'values-sw360dp/dimens.xml'), 'utf8')
    const tab = readFileSync(resolve(RES, 'values-sw600dp/dimens.xml'), 'utf8')
    expect(tel).toMatch(/<dimen name="splash_tuile">\s*170dp\s*<\/dimen>/)
    expect(telLarge).toMatch(/<dimen name="splash_tuile">\s*225dp\s*<\/dimen>/)
    expect(tab).toMatch(/<dimen name="splash_tuile">\s*370dp\s*<\/dimen>/)
  })

  it('embarque une tuile carree avec un canal alpha', () => {
    const webp = resolve(RES, 'drawable-nodpi/splash_herisson.webp')
    expect(existsSync(webp)).toBe(true)
    const buf = readFileSync(webp)
    // En-tete etendu (VP8X) d'un WebP avec alpha : signature RIFF/WEBP,
    // bloc VP8X, drapeaux a l'octet 20 (bit 0x10 = canal alpha present),
    // largeur et hauteur sur 3 octets chacune, petit-boutistes, aux octets
    // 24-26 et 27-29 — la valeur lue plus 1 donne la dimension reelle. C'est
    // lui qui garantit que la tuile est detouree.
    //
    // 760 n'est pas un nombre libre : c'est SPLASH_TUILE dans
    // tools/icones/generer.py, soit 190 dp a la densite 640. Si cette assertion
    // rougit, la source de verite est le generateur — le corriger LA, pas ici.
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF')
    expect(buf.toString('ascii', 8, 12)).toBe('WEBP')
    expect(buf.toString('ascii', 12, 16)).toBe('VP8X')
    expect(buf[20] & 0x10).toBe(0x10)
    const largeur = buf[24] | (buf[25] << 8) | (buf[26] << 16)
    const hauteur = buf[27] | (buf[28] << 8) | (buf[29] << 16)
    expect(largeur + 1).toBe(760)
    expect(hauteur + 1).toBe(760)
  })
})
