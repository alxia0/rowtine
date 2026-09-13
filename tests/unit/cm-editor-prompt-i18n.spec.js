// Passage multilingue (29/07) — le mini-dialogue de saisie numérique
// (openNumberPrompt, cm-editor.js) codait en dur en français ses 3 messages
// (cadence X, cadence N, répétition N) et son bouton Annuler. Ils passent
// maintenant par opts.labels.prompt (repli FR_PROMPT_LABELS si absent, comme
// le reste de la barre).
//
// Deux chemins d'appel distincts à couvrir (cf. cm-editor.js) :
//   - la puce compteur DANS LE TEXTE (CounterWidget -> editCounterOnLine, via
//     createCounterWidgetPlugin/buildCounterWidgets) ;
//   - la puce compteur DE LA BARRE (`.cm-retag-counter`, wireToolbar) est
//     passée de <select> à puce + popover
//     (openMenuPopover/counterMenuItems), même patron que Section/Aide-mémoire,
//     convertis plus tôt.
// Oublier de câbler l'un des deux laisserait ce texte en dur pour ce chemin
// précis sans faire rougir l'autre — d'où les deux séries de tests ci-dessous.
//
// Cadence n'est plus 2 dialogues séquentiels (X puis N)
// mais UN SEUL formulaire à 2 champs (openNumberFormPrompt), sur LES DEUX chemins :
// les tests « cadence » ci-dessous vérifient que les 2 libellés apparaissent
// ENSEMBLE, dans l'ordre X puis N, pas l'un après l'autre.
//
// Exigence de câblage : rester correct si DEUX éditeurs coexistent
// avec des langues différentes. Un test qui monte/clique/démonte A puis
// monte/clique B ne prouve rien de plus qu'une variable de module (l'ordre
// séquentiel masque la fuite) : les tests « coexistence » gardent A ET B
// vivants en même temps et interviennent en A, B, PUIS À NOUVEAU EN A — ce
// 3e clic est ce qui distinguerait un état de module partagé (qui aurait été
// écrasé par B) d'un closure propre à chaque éditeur.
import { describe, it, expect, afterEach } from 'vitest'
import { createCmEditor } from '@/components/cm/cm-editor'
import fr from '@/i18n/fr.json'

// openNumberPrompt résout via une chaîne de microtâches (await successifs
// dans editCounterOnLine/wireToolbar) qu'un simple `await Promise.resolve()`
// ne garantit pas de vider en une fois. Un tick macrotâche (setTimeout)
// garantit que la queue de microtâches est intégralement vidée avant que le
// test ne reprenne la main (cf. revue).
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function mountHost() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  return host
}

function getDialogLabel() {
  return document.querySelector('.cm-numprompt__label')
}
function getCancelBtn() {
  return document.querySelector('.cm-numprompt__btn:not(.cm-numprompt__btn--primary)')
}
// Cadence : les 2 champs sont affichés ENSEMBLE dans la même carte — ce
// helper lit la liste des libellés, dans l'ordre du DOM (X puis N). La validation
// groupée/navigation clavier d'openNumberFormPrompt (comportement, pas traduction)
// est testée à part, dans tests/unit/cm-number-form-prompt.spec.js.
function getDialogLabels() {
  return [...document.querySelectorAll('.cm-numprompt__label')].map((el) => el.textContent)
}
// Compteur de la barre (puce + popover, remplace le <select>) : clic sur la
// puce (ouvre le popover), clic sur l'item dont le texte est le libellé FR de `kind`
// (`labels.counterRep`/`counterCadence` ne sont PAS overridés par ces tests, qui ne
// passent que `labels.prompt` — même contrat de repli par clé que
// cm-editor-toolbar-reference.spec.js : le popover reste donc en FR même si les
// messages du mini-dialogue, eux, suivent `labels.prompt`).
function chooseCounter(host, kind) {
  host.querySelector('.cm-retag-counter').click()
  const label = kind === 'rep' ? fr.correction.toolbar.counterRep : fr.correction.toolbar.counterCadence
  const item = [...document.querySelectorAll('.cm-menu-popover__item')].find((b) => b.textContent === label)
  expect(item, `item de popover introuvable pour « ${label} »`).toBeTruthy()
  item.click()
}

afterEach(() => {
  // Filet de sécurité : jamais de dialogue/host qui fuite d'un test à l'autre.
  document.querySelectorAll('.cm-numprompt').forEach((el) => el.remove())
  document.querySelectorAll('body > div').forEach((el) => el.remove())
})

const EN_PROMPT = {
  cancel: 'Cancel',
  cadenceEvery: 'Every how many rows (X)?',
  cadenceTimes: 'How many times (N)?',
  repeatTimes: 'How many repeats (N)?',
}

describe('openNumberPrompt — libellés localisés (chemin puce compteur)', () => {
  it('banc tools/mdedit (aucun opts.labels) : repli FR_PROMPT_LABELS, comme aujourd’hui — PROUVÉ par test, pas par lecture', async () => {
    const host = mountHost()
    // Pas de `labels` du tout : exactement le contrat de l'éditeur Markdown de
    // dev (createCmEditor(host, { value, onChange })).
    createCmEditor(host, { value: '- {×3} Rang test\n' })
    host.querySelector('.cm-counter-chip').click()
    await tick()
    expect(getDialogLabel().textContent).toBe(fr.correction.prompt.repeatTimes)
    expect(getCancelBtn().textContent).toBe(fr.common.cancel)
    getCancelBtn().click()
  })

  it('éditeur EN : le message et le bouton Annuler suivent opts.labels.prompt (pas de FR figé)', async () => {
    const host = mountHost()
    createCmEditor(host, { value: '- {×3} Rang test\n', labels: { prompt: EN_PROMPT } })
    host.querySelector('.cm-counter-chip').click()
    await tick()
    expect(getDialogLabel().textContent).toBe(EN_PROMPT.repeatTimes)
    expect(getCancelBtn().textContent).toBe(EN_PROMPT.cancel)
    expect(getDialogLabel().textContent).not.toBe(fr.correction.prompt.repeatTimes)
    getCancelBtn().click()
  })

  it('cadence (formulaire fusionné à 2 champs) : les 2 libellés suivent la langue, ENSEMBLE, dans l’ordre X puis N', async () => {
    const host = mountHost()
    createCmEditor(host, { value: '- {cadence 2×5} Rang test\n', labels: { prompt: EN_PROMPT } })
    host.querySelector('.cm-counter-chip').click()
    await tick()
    expect(getDialogLabels()).toEqual([EN_PROMPT.cadenceEvery, EN_PROMPT.cadenceTimes])
    expect(getCancelBtn().textContent).toBe(EN_PROMPT.cancel)
    getCancelBtn().click() // annule la cadence, pas besoin d'aller au bout du retag ici
  })

  it('deux éditeurs coexistants (FR + EN) : A, puis B, puis À NOUVEAU A — aucune fuite via un état de module partagé', async () => {
    const hostFr = mountHost()
    const hostEn = mountHost()
    createCmEditor(hostFr, { value: '- {×3} Rang FR\n' }) // repli FR (pas de labels)
    createCmEditor(hostEn, { value: '- {×3} Rang EN\n', labels: { prompt: EN_PROMPT } })

    // 1er clic — éditeur FR.
    hostFr.querySelector('.cm-counter-chip').click()
    await tick()
    expect(getDialogLabel().textContent).toBe(fr.correction.prompt.repeatTimes)
    getCancelBtn().click()
    await tick()

    // 2e clic — éditeur EN.
    hostEn.querySelector('.cm-counter-chip').click()
    await tick()
    expect(getDialogLabel().textContent).toBe(EN_PROMPT.repeatTimes)
    getCancelBtn().click()
    await tick()

    // 3e clic — DE NOUVEAU l'éditeur FR : discriminant. Une variable mutable de
    // module aurait été écrasée par la création de l'éditeur EN entre-temps ;
    // un closure par éditeur (retenu ici) garde le FR intact.
    hostFr.querySelector('.cm-counter-chip').click()
    await tick()
    expect(getDialogLabel().textContent).toBe(fr.correction.prompt.repeatTimes)
    getCancelBtn().click()
  })
})

describe('openNumberPrompt — libellés localisés (chemin barre : puce « Compteur » + popover)', () => {
  it('sous-choix « Répétition » : le message et Annuler suivent opts.labels.prompt (wireToolbar, PAS editCounterOnLine)', async () => {
    const host = mountHost()
    createCmEditor(host, { value: 'Un paragraphe simple.\n', labels: { prompt: EN_PROMPT } })
    chooseCounter(host, 'rep')
    await tick()
    expect(getDialogLabel().textContent).toBe(EN_PROMPT.repeatTimes)
    expect(getCancelBtn().textContent).toBe(EN_PROMPT.cancel)
    getCancelBtn().click()
  })

  it('sous-choix « Cadence » : les 2 champs du formulaire suivent opts.labels.prompt, ENSEMBLE (pas 2 dialogues séquentiels)', async () => {
    const host = mountHost()
    createCmEditor(host, { value: 'Un paragraphe simple.\n', labels: { prompt: EN_PROMPT } })
    chooseCounter(host, 'cadence')
    await tick()
    expect(getDialogLabels()).toEqual([EN_PROMPT.cadenceEvery, EN_PROMPT.cadenceTimes])
    expect(getCancelBtn().textContent).toBe(EN_PROMPT.cancel)
    getCancelBtn().click()
  })

  it('repli FR sans labels (banc) sur le chemin barre aussi', async () => {
    const host = mountHost()
    createCmEditor(host, { value: 'Un paragraphe simple.\n' })
    chooseCounter(host, 'rep')
    await tick()
    expect(getDialogLabel().textContent).toBe(fr.correction.prompt.repeatTimes)
    expect(getCancelBtn().textContent).toBe(fr.common.cancel)
    getCancelBtn().click()
  })
})
