// Un appui long sur du texte d'interface ou de lecture ne déclenche NI la sélection web NI le
// menu « Copier le texte » de la WebView (impression de page web plutôt que d'app native).
// Règle de src/styles/tokens.css : `user-select: none` + `-webkit-touch-callout: none` sur
// <html>, ré-autorisés sur les zones de saisie réelles. Rien d'autre ne l'exerce (les tests
// de sélection visent l'éditeur, contenteditable donc exempté) : un nettoyage CSS la ferait
// disparaître en silence.
//
// On cherche le bloc de règle par ce qu'il DÉCLARE, pas par la ponctuation exacte du
// sélecteur, pour résister à un reformatage ou à un sélecteur ajouté à l'exception.
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
})
