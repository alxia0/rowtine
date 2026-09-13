// Retour device : la saisie des compteurs (cadence/répétition,
// depuis la barre ET depuis la puce compteur) passait par window.prompt(),
// qui impose le clavier AZERTY complet sur Android. openNumberPrompt() le
// remplace par un mini-dialogue DOM à input inputmode="numeric" (clavier
// chiffres uniquement), même contrat de validation que l'ex-promptInt :
// entier > 0, sinon null (annulé/vide/invalide) — jamais de throw.
import { describe, it, expect, afterEach } from 'vitest'
import { openNumberPrompt } from '@/components/cm/cm-editor'
import { findScrollContainer } from '@/utils/keyboard-avoidance'

function getInput() {
  return document.querySelector('.cm-numprompt__input')
}
function getOkBtn() {
  return document.querySelector('.cm-numprompt__btn--primary')
}
function setValue(input, value) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

afterEach(() => {
  // Filet de sécurité : si un test échoue avant de fermer l'overlay, ne pas
  // laisser fuir un `.cm-numprompt` sur le test suivant.
  document.querySelectorAll('.cm-numprompt').forEach((el) => el.remove())
})

describe('openNumberPrompt', () => {
  it('pose un input inputmode="numeric" (clavier chiffres, pas AZERTY)', async () => {
    const promise = openNumberPrompt('Combien de répétitions (N) ?')
    const input = getInput()
    expect(input).not.toBeNull()
    expect(input.getAttribute('inputmode')).toBe('numeric')
    // Ferme proprement pour ne pas polluer le test suivant.
    getInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await promise
  })

  it('préremplit avec fallback, saisir « 5 » + clic OK résout 5', async () => {
    const promise = openNumberPrompt('Combien de répétitions (N) ?', 3)
    const input = getInput()
    expect(input.value).toBe('3')
    setValue(input, '5')
    getOkBtn().click()
    await expect(promise).resolves.toBe(5)
  })

  // Après revue : auparavant, OK sur une entrée invalide
  // fermait la carte et résolvait `null` — indiscernable d'un Annuler, la
  // travailleuse pouvait croire son nombre posé alors que rien n'avait changé.
  // Même contrat qu'openNumberFormPrompt désormais : refuse de fermer, reporte le
  // focus sur le champ.
  it('champ vide + OK ne ferme pas la carte, refocalise le champ', async () => {
    const promise = openNumberPrompt('Combien de répétitions (N) ?')
    const input = getInput()
    getOkBtn().click()
    expect(document.querySelector('.cm-numprompt')).not.toBeNull()
    expect(document.activeElement).toBe(input)
    // Ferme proprement pour ne pas polluer le test suivant.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await expect(promise).resolves.toBeNull()
  })

  it('valeur non numérique (« abc ») + OK ne ferme pas la carte, refocalise le champ', async () => {
    const promise = openNumberPrompt('Combien de répétitions (N) ?')
    const input = getInput()
    setValue(input, 'abc')
    getOkBtn().click()
    expect(document.querySelector('.cm-numprompt')).not.toBeNull()
    expect(document.activeElement).toBe(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await expect(promise).resolves.toBeNull()
  })

  it('Échap résout null', async () => {
    const promise = openNumberPrompt('Combien de répétitions (N) ?')
    const input = getInput()
    setValue(input, '7')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await expect(promise).resolves.toBeNull()
  })

  it('clic sur Annuler résout null', async () => {
    const promise = openNumberPrompt('Combien de répétitions (N) ?')
    document.querySelector('.cm-numprompt__btn:not(.cm-numprompt__btn--primary)').click()
    await expect(promise).resolves.toBeNull()
  })

  it('ferme l’overlay et retire le listener keydown à la résolution', async () => {
    const promise = openNumberPrompt('Combien de répétitions (N) ?')
    // Valeur valide : OK sur un champ vide ne ferme plus rien depuis la revue
    // du 2026-08-22 (cf. tests dédiés plus haut) — ce test-ci vérifie le
    // nettoyage à la fermeture, pas la validation, Échap ou une valeur valide font
    // aussi bien l'affaire ici.
    setValue(getInput(), '5')
    getOkBtn().click()
    await promise
    expect(document.querySelector('.cm-numprompt')).toBeNull()
  })

  // ⚠️ CRITIQUE DE REVUE (30/07) : ce champ, créé en JavaScript, était hors du
  // recensement du lot « le clavier ne masque aucun champ » (fondé sur un grep des
  // gabarits .vue). Sa carte étant en position fixe SANS défilement interne, le
  // mécanisme d'évitement du clavier ne trouvait aucun conteneur défilant, se repliait
  // sur le document et posait sa marge DERRIÈRE la carte : il était totalement inerte.
  // La carte doit donc défiler, comme ColorPickerDialog et YarnConsumptionDialog
  // (cf. findScrollContainer dans src/utils/keyboard-avoidance.js).
  // ⚠️ CRITIQUE DE REVUE (30/07) : ce champ, créé en JavaScript, était hors du recensement
  // du lot « le clavier ne masque aucun champ » (fondé sur un grep des gabarits .vue). Le
  // dialogue étant en position fixe, si RIEN n'y défile le mécanisme d'évitement du clavier
  // se replie sur le document, pose sa marge DERRIÈRE le dialogue et ne déplace rien : il
  // est inerte.
  //
  // ⚠️ 2e passe : une 1re version de ce test ne lisait que le TEXTE du CSS
  // (`max-height` + `overflow-y` présents dans le bloc `.cm-numprompt__card`). Ça ne
  // prouvait RIEN — ni que ces propriétés élisent ce nœud, ni même qu'il en existe un
  // d'élu. Et le CSS qu'il verrouillait était le mauvais : mesuré sur l'appareil, la carte
  // n'atteint jamais son plafond, donc les 45vh la GONFLAIENT (577 points au lieu de 152,
  // dont 425 de vide sous les boutons) au lieu de créer de la place à défiler. Le
  // défilement vit désormais sur l'ENVELOPPE. Assertion réécrite sur le résultat qui
  // compte : quel conteneur `findScrollContainer` élit-il RÉELLEMENT ?
  it('le conteneur élu pour le champ est l’ENVELOPPE du dialogue, pas le document', async () => {
    const promise = openNumberPrompt('Combien ?')
    const input = getInput()
    const overlay = document.querySelector('.cm-numprompt')

    // jsdom ne calcule aucune mise en page (tout est à 0) : on donne à l'enveloppe les
    // dimensions d'un vrai plein écran, et au champ sa hauteur tactile réelle. Sans ça,
    // `fieldHeight >= clientHeight` (0 >= 0) rejetterait n'importe quel candidat.
    Object.defineProperty(overlay, 'scrollWidth', { value: 600, configurable: true })
    Object.defineProperty(overlay, 'clientWidth', { value: 600, configurable: true })
    Object.defineProperty(overlay, 'clientHeight', { value: 944, configurable: true })
    Object.defineProperty(input, 'offsetHeight', { value: 44, configurable: true })

    expect(findScrollContainer(input)).toBe(overlay)
    expect(findScrollContainer(input)).not.toBe(document.documentElement)

    setValue(input, '5')
    getOkBtn().click()
    await promise
  })

  // Retour terrain : un accent grave non échappé DANS ce gabarit CSS-en-JS
  // (trouvé et corrigé dans le popover voisin, ensureMenuPopoverStyles — cf. son propre
  // commentaire) coupe le template en deux et fait retomber `style.textContent` sur la
  // chaîne littérale "NaN", jamais du CSS. Les deux tests ci-dessous (max-height/
  // overflow-y absents) passeraient alors de façon VACUEUSE : `"NaN".indexOf('.cm-
  // numprompt__card')` vaut -1, `bloc` vaut `''`, et une chaîne vide ne matche jamais
  // `/max-height:/`. Ce test verrouille que le texte injecté est bien du VRAI CSS.
  it('le <style> injecté est du VRAI CSS (pas la chaîne "NaN" — piège accent grave)', async () => {
    const promise = openNumberPrompt('Combien ?')
    const css = document.getElementById('cm-numprompt-style').textContent
    expect(css).toContain('.cm-numprompt {')
    expect(css).toContain('.cm-numprompt__card {')
    expect(css).not.toBe('NaN')
    setValue(getInput(), '5')
    getOkBtn().click()
    await promise
  })

  // Le pendant du test ci-dessus : la CARTE ne doit PAS porter le défilement — c'est elle
  // que les 45vh gonflaient. Vérifié sur le texte du CSS parce que c'est bien une absence
  // de déclaration qu'on veut verrouiller, et qu'une absence ne se lit pas sur le nœud élu.
  it('la CARTE ne porte NI max-height NI overflow-y (sinon les 45vh la gonflent au lieu de la faire défiler)', async () => {
    const promise = openNumberPrompt('Combien ?')
    const css = document.getElementById('cm-numprompt-style').textContent
    const apres = css.slice(css.indexOf('.cm-numprompt__card'))
    const bloc = apres.slice(0, apres.indexOf('}'))
    expect(bloc).not.toMatch(/max-height:/)
    expect(bloc).not.toMatch(/overflow-y:/)
    setValue(getInput(), '5')
    getOkBtn().click()
    await promise
  })

  it('injecte le <style> une seule fois même après plusieurs ouvertures', async () => {
    const p1 = openNumberPrompt('Combien ?')
    setValue(getInput(), '5')
    getOkBtn().click()
    await p1
    const p2 = openNumberPrompt('Combien ?')
    setValue(getInput(), '5')
    getOkBtn().click()
    await p2
    expect(document.querySelectorAll('#cm-numprompt-style').length).toBe(1)
  })

  // Après revue : la carte n'avait ni `role="dialog"` ni
  // libellé associé au champ (pas de `<label for>`/`aria-labelledby`) — un lecteur
  // d'écran qui atteignait le champ n'annonçait jamais la question posée.
  it('la carte porte role="dialog" et le libellé est associé au champ', async () => {
    const promise = openNumberPrompt('Combien de répétitions (N) ?')
    const card = document.querySelector('.cm-numprompt__card')
    const input = getInput()
    const label = document.querySelector('.cm-numprompt__label')
    expect(card.getAttribute('role')).toBe('dialog')
    expect(card.getAttribute('aria-modal')).toBe('true')
    expect(card.getAttribute('aria-labelledby')).toBe(label.id)
    expect(label.tagName).toBe('LABEL')
    expect(label.htmlFor).toBe(input.id)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await promise
  })

  // Le voile ne bloquait le Tab que VISUELLEMENT — sans piège explicite, Tab/Maj+Tab
  // pouvait faire sortir le focus de la carte vers la page derrière (jamais `inert`
  // côté DOM). Boucle entre le champ et le dernier bouton (OK).
  it('Tab depuis le dernier élément (OK) revient au premier (le champ) — piège au Tab', async () => {
    const promise = openNumberPrompt('Combien ?')
    const input = getInput()
    getOkBtn().focus()
    getOkBtn().dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await promise
  })

  it('Maj+Tab depuis le premier élément (le champ) revient au dernier (OK) — piège au Tab', async () => {
    const promise = openNumberPrompt('Combien ?')
    const input = getInput()
    input.focus()
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    )
    expect(document.activeElement).toBe(getOkBtn())
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await promise
  })
})
