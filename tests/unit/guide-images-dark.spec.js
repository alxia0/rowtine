// Le jeu d'images sombre du guide (lot « mode sombre », 08/08).
//
// ⚠️ L'assertion qui compte n'est pas « une URL sombre existe » : si le second glob de
// images.js ne reconnaît rien, `guideImagesFor(lang, 'dark')` REPLIE sur le clair et renvoie
// des URL parfaitement valides — la fonctionnalité ne fait rien et un test « défini » passe.
// C'est pourquoi on compare les deux URL entre elles.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { guideImagesFor, fusionnerJeux } from '@/content/guide/images'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const LANGS = ['fr', 'en', 'de', 'es']

describe('images du guide : le jeu sombre', () => {
  // Compare les CONTENUS DES DEUX DOSSIERS SUR LE DISQUE, indépendamment de `fusionnerJeux`.
  // `guideImagesFor(lang, 'dark')` COMBLE les trous du sombre avec le clair : son jeu de clés
  // contient donc TOUJOURS celui du clair, quoi qu'il arrive sur le disque — comparer ce jeu
  // fusionné au jeu clair ne peut détecter qu'une image sombre ORPHELINE, jamais une image
  // sombre MANQUANTE (repliée en silence sur la claire), qui est précisément l'état qu'une
  // mise à jour interrompue en cours de langue produit. Lire les deux dossiers directement
  // rétablit la détection dans les deux sens.
  it.each(LANGS)('%s : le dossier sombre porte EXACTEMENT les mêmes fichiers que le clair', (lang) => {
    const lister = (sousDossier) =>
      fs
        .readdirSync(path.join(ROOT, 'src/content/guide', sousDossier, lang))
        .filter((f) => f.endsWith('.webp'))
        .sort()
    const clair = lister('images')
    const sombre = lister('images-dark')
    expect(clair.length).toBeGreaterThan(0)
    expect(sombre).toEqual(clair)
  })

  it.each(LANGS)('%s : chaque image sombre a une URL DIFFÉRENTE de sa jumelle claire', (lang) => {
    const clair = guideImagesFor(lang, 'light')
    const sombre = guideImagesFor(lang, 'dark')
    const identiques = Object.keys(clair).filter((nom) => clair[nom] === sombre[nom])
    expect(identiques, `images servies à l'identique en sombre : ${JSON.stringify(identiques)}`).toEqual([])
  })

  it.each(LANGS)('%s : autant de fichiers sur le disque que de noms résolus', (lang) => {
    const surDisque = fs.readdirSync(path.join(ROOT, 'src/content/guide/images-dark', lang)).filter((f) => f.endsWith('.webp'))
    expect(surDisque.length).toBe(Object.keys(guideImagesFor(lang, 'dark')).length)
  })

  it("sans thème, se comporte exactement comme avant (repli clair)", () => {
    expect(guideImagesFor('fr')).toEqual(guideImagesFor('fr', 'light'))
  })

  it('fusionnerJeux : une campagne sombre incomplète replie clé par clé sur le clair', () => {
    const clair = {
      '00-bienvenue': 'url-claire-00',
      '01-accueil': 'url-claire-01',
      '02-fiche-projet': 'url-claire-02',
    }
    // '01-accueil' manque exprès du jeu sombre : mise à jour interrompue en cours de langue.
    const sombre = {
      '00-bienvenue': 'url-sombre-00',
      '02-fiche-projet': 'url-sombre-02',
    }
    const resultat = fusionnerJeux(clair, sombre)

    // (a) la clé manquante en sombre rend l'URL claire
    expect(resultat['01-accueil']).toBe('url-claire-01')
    // (b) les clés présentes en sombre rendent l'URL sombre
    expect(resultat['00-bienvenue']).toBe('url-sombre-00')
    expect(resultat['02-fiche-projet']).toBe('url-sombre-02')
    // (c) l'ensemble des clés du résultat est celui du jeu clair, ni plus ni moins
    expect(Object.keys(resultat).sort()).toEqual(Object.keys(clair).sort())
  })
})
