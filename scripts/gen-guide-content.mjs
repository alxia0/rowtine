// Génère `src/generated/guide-content.<langue>.json` depuis chaque
// `src/content/guide/<langue>.md` réellement présent — tâche 2.1, lot 2 du plan « écran À
// propos ». Même esprit que `gen-third-party-licenses.mjs` (source réelle → fichier généré
// committé, pas écrit à la main), mais SANS mode `--check` ni hook `prebuild` : contrairement
// aux licences, personne ne touche ce Markdown sans le vouloir, et une garde en mode ÉCRITURE
// silencieuse au build serait le même risque déjà documenté ailleurs (écraser un fichier suivi
// pendant qu'une autre session travaille sur le dépôt). La garde CONTRE LA DÉRIVE est un test
// vitest (`tests/unit/guide-content-fresh.spec.js`), pas ce script : il fait ÉCHOUER la suite
// si quelqu'un édite un `.md` sans relancer `yarn guide:gen`, sans jamais rien écraser seul.
//
// Découverte DYNAMIQUE des fichiers sources (`fs.readdirSync`) : n'ajoute rien à la main
// quand le lot 3 introduira `en.md`/`de.md`/`es.md`.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseGuideMarkdown } from '../src/content/guide/parse-guide-markdown.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC_DIR = path.resolve(ROOT, 'src/content/guide')
const OUT_DIR = path.resolve(ROOT, 'src/generated')

fs.mkdirSync(OUT_DIR, { recursive: true })

const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.md'))
if (files.length === 0) throw new Error(`Aucun fichier .md trouvé dans ${SRC_DIR}`)

let totalWarnings = 0
for (const file of files) {
  const lang = file.replace(/\.md$/, '')
  const markdown = fs.readFileSync(path.join(SRC_DIR, file), 'utf-8')
  const data = parseGuideMarkdown(markdown)
  const outPath = path.join(OUT_DIR, `guide-content.${lang}.json`)
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n')
  console.log(`✓ ${path.relative(ROOT, outPath)} (${data.sections.length} sections)`)
  // Un avertissement à la génération vaut mieux qu'une perte silencieuse (revue du 02/08) :
  // le parseur signale les constructions Markdown qu'il risque de mal interpréter (cf.
  // detectInlineWarnings) au lieu de les avaler sans rien dire.
  for (const w of data.warnings) {
    console.warn(`  ⚠ [${lang}] ${w}`)
    totalWarnings++
  }
}
if (totalWarnings > 0) {
  console.warn(`\n${totalWarnings} avertissement(s) — relire le Markdown source avant de committer.`)
}
