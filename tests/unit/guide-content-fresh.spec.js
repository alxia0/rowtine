// Garde anti-dérive du contenu généré du guide utilisateur. Reparse
// chaque `src/content/guide/<langue>.md` EN MÉMOIRE et compare au
// `src/generated/guide-content.<langue>.json` committé : identique → silencieux ; différent →
// échec explicite qui rappelle de relancer `yarn guide:gen`.
//
// Volontairement un test, pas un hook `prebuild` (contrairement aux licences tierces) : cf.
// commentaire de tête de scripts/gen-guide-content.mjs pour la raison — une autre session
// travaille régulièrement sur ce dépôt, un hook qui réagirait à un `.md` modifié ailleurs
// serait plus intrusif qu'un test qui se contente d'échouer.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseGuideMarkdown } from '@/content/guide/parse-guide-markdown'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const SRC_DIR = path.resolve(ROOT, 'src/content/guide')
const GEN_DIR = path.resolve(ROOT, 'src/generated')

const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.md'))

describe('contenu généré du guide : à jour par rapport au Markdown source', () => {
  it('au moins une langue de guide existe', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('src/generated/guide-content.%s.json correspond à sa source .md — relancer `yarn guide:gen` sinon', (file) => {
    const lang = file.replace(/\.md$/, '')
    const markdown = fs.readFileSync(path.join(SRC_DIR, file), 'utf-8')
    const fresh = parseGuideMarkdown(markdown)
    const genPath = path.join(GEN_DIR, `guide-content.${lang}.json`)
    expect(fs.existsSync(genPath), `${genPath} manquant — lancer \`yarn guide:gen\``).toBe(true)
    const committed = JSON.parse(fs.readFileSync(genPath, 'utf-8'))
    expect(committed).toEqual(fresh)
  })

  // Régression trouvée en revue du 02/08 : deux glyphes vivaient dans fr.md pour décrire un
  // bouton (⬍, U+2B0D — icône « Caler ») ou un menu (⋮, U+22EE — menu Actions). Le guide
  // vivait alors dans un simple document ; ce lot le fait entrer dans l'INTERFACE de l'app
  // (écran /guide), là où la règle du projet « jamais d'emoji ni de glyphe, aria-label
  // compris » s'applique — et où un glyphe peut aussi ressortir en carré vide selon la police
  // Android. Liste FERMÉE (pas un balayage large de plages Unicode) : le guide utilise
  // légitimement d'autres symboles typographiques (—, «», …, ×) qu'un balayage trop large
  // signalerait à tort.
  const KNOWN_BAD_GLYPHS = ['⬍', '⋮']
  it.each(files)('%s ne contient aucun des glyphes déjà rencontrés en revue', (file) => {
    const markdown = fs.readFileSync(path.join(SRC_DIR, file), 'utf-8')
    for (const glyph of KNOWN_BAD_GLYPHS) {
      expect(markdown, `${file} contient le glyphe "${glyph}" — décrire en mots plutôt`).not.toContain(glyph)
    }
  })

  // Régression trouvée en revue (traductions) : les 3 traductions repliaient leurs
  // légendes sur plusieurs lignes physiques (habitude de mise en page reprise du reste de la
  // prose), alors que `captionLine()` (parse-guide-markdown.js) n'accepte une légende que sur
  // UNE SEULE ligne — écrit noir sur blanc dans son propre commentaire, jamais vérifié pour
  // autant. Résultat silencieux : `caption: null` sur les blocs image concernés, et un
  // paragraphe italique orphelin juste après dans le rendu (GuideView.vue perd le style de
  // légende ET le lien figure/figcaption pour les lecteurs d'écran) — mesuré : 14/14 légendes
  // en français, mais seulement 2/14 en anglais, 1/14 en allemand, 1/14 en espagnol. Le
  // contrôle précédent (nombre d'IMAGES égal entre langues) ne portait pas
  // sur ce qui leur est attaché : cette garde-ci vérifie spécifiquement que chaque image du
  // contenu généré porte une légende non nulle, dans les 4 langues.
  it.each(files)('%s : chaque image a une légende (aucun bloc caption: null)', (file) => {
    const lang = file.replace(/\.md$/, '')
    const markdown = fs.readFileSync(path.join(SRC_DIR, file), 'utf-8')
    const { sections } = parseGuideMarkdown(markdown)
    const images = sections.flatMap((s) => s.blocks.filter((b) => b.type === 'image'))
    expect(images.length, `${lang} : aucune image trouvée`).toBeGreaterThan(0)
    const withoutCaption = images.filter((b) => b.caption === null)
    expect(
      withoutCaption.length,
      `${lang} : ${withoutCaption.length}/${images.length} image(s) sans légende (src: ${withoutCaption.map((b) => b.src).join(', ')})`
    ).toBe(0)
  })

  // Revue (2e passe) : le test précédent est une AUTORÉFÉRENCE — chaque langue est
  // comparée à sa PROPRE analyse, jamais aux 3 autres. La revue l'a démontré : supprimer
  // une image ET sa légende d'un même bloc, dans une seule langue, passe `yarn guide:gen` et
  // laisse ce test vert (la langue amputée n'a plus d'image du tout à ce endroit-là, donc rien
  // à comparer à `null`). Ce qui manquait, c'est un DÉCOMPTE CROISÉ : les 4 langues doivent
  // porter exactement le même nombre d'images (14 aujourd'hui, mais ce nombre n'est pas figé
  // en dur ici — une évolution légitime du guide qui ajoute une image partout ne doit pas
  // faire échouer ce test, seul un ÉCART ENTRE LANGUES le doit) et, pour chaque image, le
  // même jeu d'identifiants (`src`, le nom de fichier sans extension — stable par construction
  // puisque partagé par les 4 dossiers `images/<langue>/`) : un identifiant
  // manquant dans une langue trahit une section oubliée à la traduction, même si le DÉCOMPTE
  // total restait coïncidemment identique.
  it('les 4 langues portent exactement le même nombre d’images, avec les mêmes identifiants', () => {
    const bySrc = {}
    const byLang = {}
    for (const file of files) {
      const lang = file.replace(/\.md$/, '')
      const markdown = fs.readFileSync(path.join(SRC_DIR, file), 'utf-8')
      const { sections } = parseGuideMarkdown(markdown)
      const images = sections.flatMap((s) => s.blocks.filter((b) => b.type === 'image'))
      byLang[lang] = images.length
      bySrc[lang] = new Set(images.map((b) => b.src))
    }

    const counts = Object.entries(byLang)
    const referenceCount = counts[0][1]
    const mismatched = counts.filter(([, count]) => count !== referenceCount)
    expect(mismatched, `nombre d'images différent entre langues : ${JSON.stringify(byLang)}`).toEqual([])

    const referenceLang = counts[0][0]
    const referenceSrcs = bySrc[referenceLang]
    for (const [lang, srcs] of Object.entries(bySrc)) {
      if (lang === referenceLang) continue
      const missing = [...referenceSrcs].filter((src) => !srcs.has(src)).sort()
      const extra = [...srcs].filter((src) => !referenceSrcs.has(src)).sort()
      expect(missing, `${lang} : image(s) manquante(s) par rapport à ${referenceLang} : ${JSON.stringify(missing)}`).toEqual([])
      expect(extra, `${lang} : image(s) en trop par rapport à ${referenceLang} : ${JSON.stringify(extra)}`).toEqual([])
    }
  })
})
