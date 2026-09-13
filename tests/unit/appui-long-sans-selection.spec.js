// Intent 2026-09-06-sensation-native-indices-web : un appui long sur du texte d'interface
// ou de lecture ne doit RIEN déclencher — ni la sélection web (surlignage bleu), ni le menu
// contextuel « Copier le texte » de la WebView Android, qui donnent une impression de page
// web plutôt que d'app native (reproduit sur Huawei LYA-L29, ex. titre de section dans
// l'onglet Sections d'un projet). Corrigé le 08/09 (e79419e1) dans src/styles/tokens.css :
// `user-select: none` + `-webkit-touch-callout: none` sur <html>, ré-autorisés explicitement
// sur les zones de saisie réelles (input, textarea, contenteditable). Ce test verrouille la
// règle dans le temps — une passe de nettoyage CSS pourrait la faire disparaître en silence,
// puisque rien d'autre ne l'exerce (elle ne casse aucun test e2e existant : les seuls tests
// qui touchent à `getSelection`/la sélection visent tous l'intérieur de l'éditeur CodeMirror,
// qui est contenteditable et donc déjà exempté).
//
// Les assertions lisent le CSS source plutôt que le DOM calculé (dans l'esprit de
// selection-color-rule.spec.js) : elles cherchent le bloc de règle par ce qu'il DÉCLARE
// (`-webkit-touch-callout`, `user-select: auto`) plutôt que par la ponctuation exacte du
// sélecteur, pour ne pas rougir sur un simple reformatage Prettier ou l'ajout d'un
// sélecteur supplémentaire à l'exception.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8')

// Le sélecteur d'un bloc `{...}` = le texte entre la fin du bloc précédent et son accolade,
// commentaires CSS retirés (un bloc de règle est presque toujours précédé d'un commentaire
// expliquant le POURQUOI, ici en particulier).
const preludeDe = (bloc) => {
  const idx = tokens.indexOf(bloc)
  const avant = tokens.slice(0, idx)
  const depuisBlocPrecedent = avant.slice(avant.lastIndexOf('}') + 1)
  return depuisBlocPrecedent.replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('appui long : aucune sélection/copie hors des zones de saisie', () => {
  it('désactive la sélection et le menu contextuel long-press, et seulement sur <html>', () => {
    // `-webkit-touch-callout` n'apparaît qu'une fois dans le fichier : il identifie le bloc
    // sans ambiguïté avec le reste des tokens.
    const bloc = tokens.match(/\{[^{}]*-webkit-touch-callout:\s*none[^{}]*\}/s)?.[0]
    expect(bloc, '`-webkit-touch-callout: none` introuvable dans tokens.css').toBeTruthy()
    expect(bloc).toMatch(/user-select:\s*none/)
    expect(bloc).toMatch(/-webkit-user-select:\s*none/)
    expect(preludeDe(bloc).trim()).toBe('html')
  })

  it('rétablit la sélection sur les champs de saisie et le contenteditable', () => {
    const bloc = tokens.match(/\{[^{}]*user-select:\s*auto[^{}]*\}/s)?.[0]
    expect(bloc, "bloc de règle avec `user-select: auto` introuvable").toBeTruthy()
    expect(bloc).toMatch(/-webkit-user-select:\s*auto/)
    const prelude = preludeDe(bloc)
    for (const selecteur of ['input', 'textarea', "[contenteditable='true']", "[contenteditable='']"]) {
      expect(prelude, `sélecteur ${selecteur} absent de l'exception`).toContain(selecteur)
    }
  })

  it('preuve d’exécution : le contentDOM de CodeMirror porte bien contenteditable="true" (donc couvert par l’exception ci-dessus, app comme banc mdedit)', () => {
    // Ne pas re-grepper cm-editor.js pour le mot « contenteditable » : la plupart des
    // occurrences y sont des commentaires (vérifié), ça passerait même si CM cessait de
    // poser l'attribut. La preuve qui engage vraiment est le test comportemental existant.
    const cmEditorKeyboard = readFileSync(
      resolve(process.cwd(), 'tests/unit/cm-editor-keyboard.spec.js'),
      'utf8',
    )
    expect(cmEditorKeyboard).toMatch(
      /contentDOM\.getAttribute\('contenteditable'\)\)\.toBe\('true'\)/,
    )
  })
})
