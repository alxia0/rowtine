// Unitaire — ConfirmDialog : dialogue de confirmation générique (titre + message + 1 ou 2
// boutons). Étendu au P3 pour servir aussi de pop-up « à un seul bouton » (astuce
// d'accueil) : cancelLabel devient optionnel — s'il est omis, un seul bouton (confirmLabel)
// est rendu, il reçoit le focus à l'ouverture, et Échap/clic sur le voile émettent `confirm`
// (il n'y a pas d'« annuler » possible pour une astuce à lire).
//
// Étendu à nouveau (décision produit du 19/08/2026, revue, mot pour mot :
// « un appui à côté doit juste fermer ») : `dismissAction` découple CE QU'ÉMET un appui « à
// côté » (Échap, voile) de la simple présence d'un second bouton. Le bloc « mode à 2 boutons »
// ci-dessous, qui ne passe JAMAIS cette prop, EST le garde-fou de non-régression : si le
// comportement par défaut basculait vers `confirm`, ses tests Échap/voile/focus rougiraient.
import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

let wrapper
// attachTo: document.body — comme onboarding-folder-prompt.spec.js : en jsdom, .focus() /
// document.activeElement sont des no-op sur un élément non attaché au DOM réel.
function mountDialog(props) {
  wrapper = mount(ConfirmDialog, { props, attachTo: document.body })
  return wrapper
}

// Le focus-à-l'ouverture est piloté par un `watch` SANS { immediate: true } (ConfirmDialog) :
// il ne se déclenche que sur une transition false→true, pas sur un montage déjà ouvert. C'est
// exactement le motif d'usage réel (LibraryView monte le dialogue fermé, l'ouvre ensuite) —
// donc on reproduit cette transition ici plutôt que de monter directement `open: true`.
async function mountThenOpen(props) {
  const w = mountDialog({ ...props, open: false })
  await w.setProps({ open: true })
  await w.vm.$nextTick()
  await new Promise((r) => setTimeout(r, 0))
  return w
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('ConfirmDialog — mode à 2 boutons (comportement existant, non régressé)', () => {
  const props = {
    open: true,
    title: 'Supprimer ce patron ?',
    message: '2 projets utilisent ce patron.',
    confirmLabel: 'Supprimer quand même',
    cancelLabel: 'Annuler',
  }

  it('affiche le titre, le message et les 2 boutons', () => {
    const w = mountDialog(props)
    expect(w.find('[role="dialog"]').exists()).toBe(true)
    expect(w.text()).toContain('Supprimer ce patron ?')
    expect(w.text()).toContain('2 projets utilisent ce patron.')
    expect(w.findAll('button').map((b) => b.text())).toEqual(['Annuler', 'Supprimer quand même'])
  })

  it('le focus va sur Annuler (option sûre) à l’ouverture', async () => {
    await mountThenOpen(props)
    expect(document.activeElement?.textContent).toBe('Annuler')
  })

  // Revue (défaut latent) : le watch de focus doit aussi se déclencher quand le composant
  // est monté DÉJÀ ouvert (:open="true" dès le montage), pas seulement sur une transition
  // false→true. Aucun appelant actuel ne fait ça (cf. mountThenOpen ci-dessus), mais
  // ConfirmDialog est partagé — un futur appelant qui monterait déjà-ouvert doit quand
  // même récupérer le focus, sinon clavier/lecteur d'écran perdent l'utilisateur.
  it('le focus va sur Annuler même si le dialogue est monté DÉJÀ ouvert (:open="true" dès le montage)', async () => {
    const w = mountDialog({ ...props, open: true })
    await w.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 0))
    expect(document.activeElement?.textContent).toBe('Annuler')
  })

  it('Échap émet cancel', async () => {
    const w = mountDialog(props)
    await document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('cancel')).toBeTruthy()
    expect(w.emitted('confirm')).toBeFalsy()
  })

  it('cliquer le voile émet cancel', async () => {
    const w = mountDialog(props)
    await w.find('.cfd__scrim').trigger('click')
    expect(w.emitted('cancel')).toBeTruthy()
  })
})

describe('ConfirmDialog — mode à 1 bouton (nouveau, astuce d’accueil P3)', () => {
  const props = {
    open: true,
    title: 'Le sais-tu ?',
    message: "Astuce : balaie l'écran vers la droite pour revenir en arrière.",
    confirmLabel: "C'est compris",
    // cancelLabel volontairement omis
  }

  it('affiche le titre, le message et UN SEUL bouton', () => {
    const w = mountDialog(props)
    expect(w.find('[role="dialog"]').exists()).toBe(true)
    expect(w.text()).toContain('Le sais-tu ?')
    expect(w.text()).toContain("Astuce : balaie l'écran vers la droite pour revenir en arrière.")
    const buttons = w.findAll('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0].text()).toBe("C'est compris")
  })

  it('le focus va sur le seul bouton (« C’est compris ») à l’ouverture', async () => {
    await mountThenOpen(props)
    expect(document.activeElement?.textContent).toBe("C'est compris")
  })

  it('Échap émet confirm (pas de cancel possible sans bouton Annuler)', async () => {
    const w = mountDialog(props)
    await document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('confirm')).toBeTruthy()
    expect(w.emitted('cancel')).toBeFalsy()
  })

  it('cliquer le voile émet confirm', async () => {
    const w = mountDialog(props)
    await w.find('.cfd__scrim').trigger('click')
    expect(w.emitted('confirm')).toBeTruthy()
    expect(w.emitted('cancel')).toBeFalsy()
  })

  it('cliquer le bouton émet confirm', async () => {
    const w = mountDialog(props)
    await w.find('button').trigger('click')
    expect(w.emitted('confirm')).toBeTruthy()
  })
})

describe('ConfirmDialog — variante centrée (correctif « bienvenue centrée », 10/08/2026)', () => {
  // La pop-up de bienvenue du premier lancement doit s'afficher au MILIEU de l'écran, pas
  // collée en bas. `centered` bascule la carte d'une feuille du bas vers une carte centrée
  // aux 4 coins arrondis, sans toucher au comportement par défaut (§2.10 : feuille du bas).
  // L'assertion porte sur les CLASSES qui pilotent le CSS, jamais sur une couleur ou une
  // valeur de style calculée : jsdom ne calcule pas les styles scoped d'un composant Vue.
  const props = {
    open: true,
    title: 'Bienvenue',
    message: 'Tout est prêt.',
    confirmLabel: 'Commencer',
  }

  it('sans la prop `centered`, reste une feuille du bas (classes absentes)', () => {
    const w = mountDialog(props)
    expect(w.find('.cfd').classes()).not.toContain('cfd--centered')
    expect(w.find('.cfd__card').classes()).not.toContain('cfd__card--centered')
  })

  it('avec `centered`, rend la variante centrée', () => {
    const w = mountDialog({ ...props, centered: true })
    expect(w.find('.cfd').classes()).toContain('cfd--centered')
    expect(w.find('.cfd__card').classes()).toContain('cfd__card--centered')
  })
})

describe('ConfirmDialog — dismissAction="confirm" (décision produit, « un appui à côté doit juste fermer », 19/08/2026)', () => {
  // Cas RÉEL : 2 boutons, dont le secondaire NAVIGUE (comme "Comment corriger" de
  // LibraryView.vue) — un appui à côté ne doit jamais déclencher cette navigation.
  const props = {
    open: true,
    title: 'Un patron importé se relit',
    message: "L'app lit ton PDF toute seule.",
    confirmLabel: "C'est compris",
    cancelLabel: 'Comment corriger',
    dismissAction: 'confirm',
  }

  it('le focus va sur le bouton SÛR (« C’est compris »), pas sur le secondaire, à l’ouverture', async () => {
    await mountThenOpen(props)
    expect(document.activeElement?.textContent).toBe("C'est compris")
  })

  it('Échap émet confirm, PAS cancel', async () => {
    const w = mountDialog(props)
    await document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('confirm')).toBeTruthy()
    expect(w.emitted('cancel')).toBeFalsy()
  })

  it('cliquer le voile émet confirm, PAS cancel', async () => {
    const w = mountDialog(props)
    await w.find('.cfd__scrim').trigger('click')
    expect(w.emitted('confirm')).toBeTruthy()
    expect(w.emitted('cancel')).toBeFalsy()
  })

  it('un clic DÉLIBÉRÉ sur le bouton secondaire émet toujours cancel (la navigation reste possible)', async () => {
    // PRÉCONDITION : les deux boutons existent bien — sinon ce test ne prouverait rien sur
    // le bouton secondaire lui-même.
    const w = mountDialog(props)
    expect(w.findAll('button').map((b) => b.text())).toEqual(['Comment corriger', "C'est compris"])

    await w.find('[data-test="confirm-cancel"]').trigger('click')
    expect(w.emitted('cancel')).toBeTruthy()
  })

  it('sans `dismissAction`, un dialogue à 2 boutons standard garde `cancel` (non-régression explicite)', async () => {
    // Répète le garde-fou du bloc « mode à 2 boutons » ci-dessus, ICI, à côté du nouveau
    // comportement — pour qu'une lecture locale du fichier voie tout de suite le contraste
    // entre les deux, sans devoir remonter au début du fichier.
    const w = mountDialog({ ...props, dismissAction: undefined })
    await document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('cancel')).toBeTruthy()
    expect(w.emitted('confirm')).toBeFalsy()
  })
})

describe('ConfirmDialog — piège à focus + restitution au déclencheur (dette audit UX 16/07)', () => {
  // La carte role="dialog" piège Tab (boucle Annuler↔Confirmer) et la fermeture rend le
  // focus au déclencheur — via le composable partagé useFocusTrap, comme toutes les
  // autres surfaces du recensement. Le focus INITIAL reste celui du watch existant
  // (option sûre) : les tests du haut de ce fichier en sont le garde-fou.
  const props = {
    open: true,
    title: 'Supprimer ce patron ?',
    message: '2 projets utilisent ce patron.',
    confirmLabel: 'Supprimer quand même',
    cancelLabel: 'Annuler',
  }

  it('Tab depuis le dernier focusable (Confirmer) revient au premier (Annuler)', async () => {
    const w = mountDialog(props)
    // Laisse le watch de focus-initial TERMINER (nextTick + macrotâche) : posé juste après
    // le montage, le focus du test serait réécrit par sa continuation — le piège testerait
    // du vide (c'est exactement ce qui rendait ce test vert pour de mauvaises raisons).
    await w.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 0))
    const cancel = w.find('[data-test="confirm-cancel"]').element
    const confirm = w.find('[data-test="confirm-ok"]').element
    confirm.focus()
    // Événement émis depuis le bouton focusé, remonté à la carte qui porte @keydown.
    await confirm.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(cancel)
  })

  it('Maj+Tab depuis le premier focusable (Annuler) va au dernier (Confirmer)', async () => {
    const w = mountDialog(props)
    await w.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 0))
    const cancel = w.find('[data-test="confirm-cancel"]').element
    const confirm = w.find('[data-test="confirm-ok"]').element
    cancel.focus()
    await cancel.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    )
    expect(document.activeElement).toBe(confirm)
  })

  it('à la fermeture, le focus revient au bouton déclencheur', async () => {
    const trigger = document.createElement('button')
    trigger.textContent = 'Supprimer'
    document.body.appendChild(trigger)
    try {
      trigger.focus()
      const w = mountDialog({ ...props, open: false })
      await w.setProps({ open: true })
      await w.vm.$nextTick()
      await new Promise((r) => setTimeout(r, 0))
      // Précondition : à l'ouverture, le focus est bien dans le dialogue (option sûre).
      expect(document.activeElement?.textContent).toBe('Annuler')
      await w.setProps({ open: false })
      await w.vm.$nextTick()
      await new Promise((r) => setTimeout(r, 0))
      expect(document.activeElement).toBe(trigger)
    } finally {
      trigger.remove()
    }
  })
})
