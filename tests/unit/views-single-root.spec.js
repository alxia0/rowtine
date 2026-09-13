// Garde « racine unique par vue routée ».
//
// App.vue anime les changements d'écran avec <Transition name="route-fade" mode="out-in">
// autour de la vue montée par <RouterView>. Or <Transition> exige une racine UNIQUE : une
// vue à plusieurs racines (le motif historique était AppHeader + main) rend un fragment,
// <Transition> ne sait l'animer — le défaut d'origine était une PAGE VIDE. Les transitions,
// retirées des débuts du projet, n'ont été réactivées (commit 0cb0238b) qu'APRÈS avoir donné
// une racine unique à chacune des 21 vues. Sans cette garde, une vue future à deux racines
// ré-ensevelirait ce bug en silence : d'où ce test, qui compile chaque src/views/*.vue avec
// @vue/compiler-sfc (la VRAIE chaîne de compilation, pas un grep) et refuse tout fragment.
//
// ⚠️ Subtilités du compte de racines, côté runtime Vue 3 :
//   • les COMMENTAIRES de premier niveau sont retirés à la compilation : jamais des racines ;
//   • une chaîne v-if / v-else-if / v-else compile en UN SEUL nœud IF : c'est UNE racine, à
//     condition que CHAQUE branche rende au moins un élément ET que la chaîne se TERMINE par
//     un v-else (dans l'AST, la branche finale v-else est celle SANS condition) — une chaîne
//     qui peut finir « toutes conditions fausses » rendrait un placeholder commentaire que
//     <Transition> refuse avec un warning dev ;
//   • c'est précisément pour cela que PatternView est enveloppée dans un <div>
//     inconditionnel (cf. le commentaire d'App.vue) : son historique v-if NU sans v-else
//     (pattern ref(null) jusqu'au await Dexie) n'est plus une racine directe.
// Une vue qui échoue ici se corrige en enveloppant son template dans un <div> nu sans style
// (le flux global est en blocs purs : ce wrapper est structurellement neutre, cf. tokens.css).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, compileTemplate } from '@vue/compiler-sfc'

// Mirroir local des NodeTypes de @vue/compiler-core (non importés ici pour ne pas dépendre
// d'un paquet transitive à plat) : ELEMENT = 1, COMMENT = 3, IF = 9.
const ELEMENT = 1
const COMMENT = 3
const IF = 9

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VIEWS_DIR = path.resolve(__dirname, '../../src/views')
const FILES = fs.readdirSync(VIEWS_DIR).filter((f) => f.endsWith('.vue'))

// Libellé lisible d'un nœud racine pour le message d'échec.
function decrit(noeud) {
  if (noeud.type === ELEMENT) return `<${noeud.tag}>`
  if (noeud.type === IF) return `chaîne v-if (${noeud.branches.length} branche(s))`
  return `nœud de type ${noeud.type}`
}

function racinesNonCommentaires(file) {
  const source = fs.readFileSync(path.join(VIEWS_DIR, file), 'utf-8')
  const { descriptor } = parse(source, { filename: file })
  expect(descriptor.template, `${file} : pas de bloc <template>`).toBeTruthy()
  const { ast } = compileTemplate({
    source: descriptor.template.content,
    filename: file,
    id: file,
  })
  return ast.children.filter((c) => c.type !== COMMENT)
}

// Une racine « Transition-safe » : soit un élément, soit une chaîne v-if/else dont CHAQUE
// branche rend au moins un élément ET qui se termine par un v-else (branche SANS condition
// dans l'AST) — sinon toutes conditions fausses produiraient un placeholder commentaire,
// exactement le défaut que la garde chasse.
function racineValide(kids) {
  if (kids.length !== 1) return false
  const [racine] = kids
  if (racine.type === ELEMENT) return true
  if (racine.type === IF) {
    return (
      racine.branches.every((b) => b.children.some((c) => c.type === ELEMENT)) &&
      racine.branches[racine.branches.length - 1].condition == null
    )
  }
  return false
}

describe('racine unique par vue routée (pré-condition des transitions d’écran)', () => {
  it('src/views contient des vues à balayer (garde vivante, pas un dossier vide)', () => {
    expect(FILES.length).toBeGreaterThan(0)
  })

  it.each(FILES)('%s : une seule racine — élément, ou chaîne v-if/else toutes branches à élément', (file) => {
    const kids = racinesNonCommentaires(file)
    const vus = kids.map(decrit).join(', ')
    expect(racineValide(kids), `${file} : ${kids.length} racine(s) non-commentaire [${vus}] — <Transition> (App.vue) exige UNE racine unique : envelopper le template dans un <div> nu`).toBe(true)
  })
})
