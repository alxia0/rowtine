// Garde de résolution des images du guide (revue du 02/08, lot 2) : sans elle, renommer ou
// supprimer un fichier WebP référencé par le Markdown rendrait un `<img>` cassé dans l'app
// sans qu'aucun test ne le voie — il avait fallu vérifier les 14 noms à la main en revue dans
// les 4 langues. Découverte DYNAMIQUE des langues (comme guide-content-fresh.spec.js) :
// couvre automatiquement une langue de guide ajoutée par le lot 3, sans qu'on ait à y repenser.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { guideImagesFor } from '@/content/guide/images'
import guideFr from '@/generated/guide-content.fr.json'
import guideEn from '@/generated/guide-content.en.json'
import guideDe from '@/generated/guide-content.de.json'
import guideEs from '@/generated/guide-content.es.json'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const SRC_DIR = path.resolve(ROOT, 'src/content/guide')

// Les 4 langues du guide sont traduites depuis le lot 3 (revue du 02/08 :
// ce commentaire annonçait l'ajout progressif d'en/de/es, jamais fait — corrigé ici, dans
// le même geste que src/content/guide/index.js, qui les importe déjà tous les 4).
const GUIDE_CONTENT = { fr: guideFr, en: guideEn, de: guideDe, es: guideEs }

const langs = fs
  .readdirSync(SRC_DIR)
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.replace(/\.md$/, ''))

describe('résolution des images du guide : chaque src d’un bloc image a un fichier réel', () => {
  it('au moins une langue de contenu généré est couverte par ce test', () => {
    expect(Object.keys(GUIDE_CONTENT).length).toBeGreaterThan(0)
  })

  it.each(langs.filter((l) => GUIDE_CONTENT[l]))('%s : chaque image du contenu généré existe dans images/%s/', (lang) => {
    const content = GUIDE_CONTENT[lang]
    const images = guideImagesFor(lang)
    const imageBlocks = content.sections.flatMap((s) => s.blocks.filter((b) => b.type === 'image'))
    expect(imageBlocks.length).toBeGreaterThan(0)
    for (const block of imageBlocks) {
      expect(images[block.src], `images/${lang}/${block.src}.webp introuvable (référencé par le guide)`).toBeDefined()
    }
  })

  // Symétrique : un fichier WebP orphelin (plus référencé par aucun bloc image) ne casse
  // rien pour l'utilisatrice, mais alourdit l'app pour rien — un test qui ne regarderait
  // que le sens ci-dessus laisserait ce genre de résidu s'accumuler en silence.
  it.each(langs.filter((l) => GUIDE_CONTENT[l]))('%s : aucun fichier WebP orphelin (non référencé par le guide)', (lang) => {
    const content = GUIDE_CONTENT[lang]
    const referenced = new Set(content.sections.flatMap((s) => s.blocks.filter((b) => b.type === 'image').map((b) => b.src)))
    const images = guideImagesFor(lang)
    const orphans = Object.keys(images).filter((name) => !referenced.has(name))
    expect(orphans, `fichiers WebP orphelins dans images/${lang}/ : ${JSON.stringify(orphans)}`).toEqual([])
  })
})
