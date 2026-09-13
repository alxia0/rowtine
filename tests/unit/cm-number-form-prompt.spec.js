// Sœur d'openNumberPrompt (cf. cm-number-prompt.spec.js)
// pour PLUSIEURS champs à la fois : Cadence fusionne « Répéter tous les » et
// « fois » dans une SEULE carte (`.cm-numprompt__card`, déjà réutilisée telle
// quelle) au lieu de 2 dialogues séquentiels. Un champ vide/invalide au moment de
// valider ne ferme RIEN, focus posé sur LE premier champ fautif — même contrat
// qu'openNumberPrompt depuis une revue de conception (auparavant, openNumberPrompt
// résolvait `null` et fermait silencieusement sur une
// entrée invalide ; les deux fonctions divergeaient délibérément sur ce point,
// cf. git history de ce commentaire).
import { describe, it, expect, afterEach } from 'vitest'
import { openNumberFormPrompt } from '@/components/cm/cm-editor'

function getInputs() {
  return [...document.querySelectorAll('.cm-numprompt__input')]
}
function getLabels() {
  return [...document.querySelectorAll('.cm-numprompt__label')].map((el) => el.textContent)
}
function getOkBtn() {
  return document.querySelector('.cm-numprompt__btn--primary')
}
function getCancelBtn() {
  return document.querySelector('.cm-numprompt__btn:not(.cm-numprompt__btn--primary)')
}
function pressEnter(el) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
}
function pressEscape(el) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}

afterEach(() => {
  // Filet de sécurité, même patron que cm-number-prompt.spec.js.
  document.querySelectorAll('.cm-numprompt').forEach((el) => el.remove())
})

const FIELDS = [
  { label: 'Tous les combien de rangs (X) ?' },
  { label: 'Combien de fois (N) ?' },
]

describe('openNumberFormPrompt', () => {
  it('pose un champ par entrée de `fields`, dans l’ordre, avec le focus sur le PREMIER', () => {
    const promise = openNumberFormPrompt(FIELDS)
    expect(getLabels()).toEqual(FIELDS.map((f) => f.label))
    expect(getInputs().length).toBe(2)
    expect(document.activeElement).toBe(getInputs()[0])
    pressEscape(getInputs()[0])
    return promise
  })

  it('préremplit chaque champ avec son `fallback`', () => {
    const promise = openNumberFormPrompt([
      { label: 'X', fallback: 2 },
      { label: 'N', fallback: 5 },
    ])
    const [x, n] = getInputs()
    expect(x.value).toBe('2')
    expect(n.value).toBe('5')
    pressEscape(x)
    return promise
  })

  it('les 2 valeurs saisies + un seul clic OK résolvent un TABLEAU, dans l’ordre des champs', async () => {
    const promise = openNumberFormPrompt(FIELDS)
    const [x, n] = getInputs()
    x.value = '2'
    n.value = '5'
    getOkBtn().click()
    await expect(promise).resolves.toEqual([2, 5])
  })

  it('Entrée sur le 1er champ déplace le focus au 2e — ne valide PAS, la carte reste ouverte', async () => {
    const promise = openNumberFormPrompt(FIELDS)
    const [x, n] = getInputs()
    x.value = '2'
    pressEnter(x)
    expect(document.activeElement).toBe(n)
    expect(document.querySelector('.cm-numprompt')).not.toBeNull()
    pressEscape(n)
    await expect(promise).resolves.toBeNull()
  })

  it('Entrée sur le DERNIER champ valide, comme un clic sur OK', async () => {
    const promise = openNumberFormPrompt(FIELDS)
    const [x, n] = getInputs()
    x.value = '2'
    n.value = '5'
    // Focus RÉEL sur `n` (pas seulement sa valeur) : onKeydown lit
    // `document.activeElement`, comme le ferait un vrai geste clavier (Entrée sur le
    // 1er champ y aurait déjà déplacé le focus, cf. test précédent).
    n.focus()
    pressEnter(n)
    await expect(promise).resolves.toEqual([2, 5])
  })

  it('un champ vide au moment de valider ne ferme rien : focus posé sur CE champ, sans message d’erreur', async () => {
    const promise = openNumberFormPrompt(FIELDS)
    const [x, n] = getInputs()
    x.value = '2'
    // `n` reste vide.
    getOkBtn().click()
    expect(document.querySelector('.cm-numprompt')).not.toBeNull()
    expect(document.activeElement).toBe(n)
    expect(document.querySelector('.cm-numprompt__error, [role="alert"]')).toBeNull()
    pressEscape(n)
    await expect(promise).resolves.toBeNull()
  })

  it('un champ non numérique (« abc ») au moment de valider ne ferme rien non plus : focus sur CE champ', async () => {
    const promise = openNumberFormPrompt(FIELDS)
    const [x, n] = getInputs()
    x.value = 'abc'
    n.value = '5'
    getOkBtn().click()
    expect(document.querySelector('.cm-numprompt')).not.toBeNull()
    expect(document.activeElement).toBe(x)
    pressEscape(x)
    await expect(promise).resolves.toBeNull()
  })

  it('le PREMIER champ fautif reçoit le focus si les deux sont invalides', async () => {
    const promise = openNumberFormPrompt(FIELDS)
    const [x] = getInputs()
    getOkBtn().click() // les deux champs sont vides
    expect(document.activeElement).toBe(x)
    pressEscape(x)
    await expect(promise).resolves.toBeNull()
  })

  it('après un 1er OK refusé (champ fautif corrigé), un 2e OK résout bien le tableau', async () => {
    const promise = openNumberFormPrompt(FIELDS)
    const [x, n] = getInputs()
    x.value = '2'
    getOkBtn().click() // `n` vide, refusé
    n.value = '5'
    getOkBtn().click()
    await expect(promise).resolves.toEqual([2, 5])
  })

  it('Échap (sur n’importe quel champ) résout null et ferme', async () => {
    const promise = openNumberFormPrompt(FIELDS)
    const [, n] = getInputs()
    n.focus()
    pressEscape(n)
    await expect(promise).resolves.toBeNull()
    expect(document.querySelector('.cm-numprompt')).toBeNull()
  })

  it('clic sur Annuler résout null', async () => {
    const promise = openNumberFormPrompt(FIELDS)
    getCancelBtn().click()
    await expect(promise).resolves.toBeNull()
  })

  it('un seul bouton « OK » pour toute la carte (pas un par champ)', () => {
    const promise = openNumberFormPrompt(FIELDS)
    expect(document.querySelectorAll('.cm-numprompt__btn--primary').length).toBe(1)
    pressEscape(getInputs()[0])
    return promise
  })

  it('la carte reste en `flex-direction: column` avec `gap: 12px` (empilement vertical)', () => {
    const promise = openNumberFormPrompt(FIELDS)
    const css = document.getElementById('cm-numprompt-style').textContent
    const bloc = css.slice(css.indexOf('.cm-numprompt__card'), css.indexOf('.cm-numprompt__label'))
    expect(bloc).toMatch(/flex-direction:\s*column/)
    expect(bloc).toMatch(/gap:\s*12px/)
    pressEscape(getInputs()[0])
    return promise
  })
})
