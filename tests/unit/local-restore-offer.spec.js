// @vitest-environment jsdom
// Unitaire — LocalRestoreOffer.vue. La modale maison qui remplace l'ancien
// `window.confirm` natif de l'offre de restauration LOCALE (données trouvées dans le
// dossier qu'on vient de désigner, cf. restore-on-designate.js) — une fenêtre système
// dont les boutons CANCEL/OK n'étaient jamais traduits. Comme pour
// BackupDecisionPrompt.vue, la visibilité est EXTERNE (le parent monte le composant
// pendant qu'une réponse est attendue) : ici, on teste le composant EN ISOLATION.
//
// Décision produit du 05/09/2026 (« je confirme Perdre les données ») : le
// refus n'est plus un « Plus tard » sans conséquence — le second bouton dit
// « Perdre les données » (`saf.startFresh`, même vocabulaire que le bandeau et les
// Réglages) et mène à un `discard` que le PARENT exécutera (écrasement + décision).
// Ce qui se teste ICI : le corps explicatif (la conséquence, dite avant d'être faite),
// la confirmation PRÉALABLE (ConfirmDialog maison, jamais window.confirm, focus
// initial sur Annuler), et le clavier — Échap emprunte le MÊME chemin que le clic
// (l'ouverture de la confirmation), jamais la destruction directe.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestI18n } from './helpers/i18n-router'

import LocalRestoreOffer from '@/components/LocalRestoreOffer.vue'

const i18n = createTestI18n()

let wrapper
const mountIt = () => {
  wrapper = mount(LocalRestoreOffer, {
    global: { plugins: [i18n] },
    attachTo: document.body, // requis pour le focus initial et le piège de focus
  })
  return wrapper
}

beforeEach(() => {
  document.activeElement?.blur?.()
})

// ConfirmDialog ajoute un écouteur `keydown` SUR `document` quand il est ouvert :
// sans démontage, un dialogue laissé ouvert par un test recevrait les Échap du
// suivant. Propre, et coûte deux lignes.
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

// La confirmation s'ouvre toujours par le même geste : le clic sur « Perdre les
// données » (Échap emprunte ce chemin, testé à part). Ce helper rend les tests
// lisibles sur CE qu'ils prouvent — la confirmation, pas l'ouverture.
const ouvreLaConfirmation = async (w) => {
  await w.find('[data-test="local-restore-decline"]').trigger('click')
  await flushPromises()
}

describe('LocalRestoreOffer', () => {
  it('rend un dialogue : titre, corps explicatif, aria cohérents', () => {
    const w = mountIt()
    const dialog = w.find('[data-test="local-restore-offer"]')
    expect(dialog.exists()).toBe(true)
    expect(dialog.attributes('role')).toBe('dialog')
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.attributes('aria-labelledby')).toBe('lro-title')
    expect(dialog.attributes('aria-describedby')).toBe('lro-body')
    expect(w.find('#lro-title').text()).toBe('Des données Rowtine ont été trouvées dans ce dossier.')
    // Le corps dit CE QUE le refus fera — sans lui, le libellé destructeur flotterait
    // sans conséquence énoncée. 06/09/2026, retour d'usage : plus de
    // « cet appareil » — la formulation doit se lire dans le cas « réinstallation
    // fraîche, on re-désigne le dossier existant », où l'app ne contient encore rien.
    expect(w.find('#lro-body').text()).toBe(
      'Tu peux les reprendre dans l\'app, ou repartir de zéro : les données du dossier seront alors perdues.',
    )
  })

  it('propose exactement deux boutons : « Restaurer » et « Perdre les données » (saf.startFresh)', () => {
    const w = mountIt()
    const accept = w.find('[data-test="local-restore-accept"]')
    const decline = w.find('[data-test="local-restore-decline"]')
    expect(accept.exists()).toBe(true)
    expect(decline.exists()).toBe(true)
    expect(accept.text()).toBe('Restaurer')
    // La MÊME clé que le bandeau et les Réglages : une seule grille de vocabulaire.
    expect(decline.text()).toBe('Perdre les données')
    expect(decline.text()).toBe(i18n.global.t('saf.startFresh'))
    expect(w.findAll('button')).toHaveLength(2)
  })

  it('« Restaurer » émet restore (et rien d\'autre) — l\'action qui récupère le travail', async () => {
    const w = mountIt()
    await w.find('[data-test="local-restore-accept"]').trigger('click')
    expect(w.emitted('restore')).toHaveLength(1)
    expect(w.emitted('discard')).toBeFalsy()
  })

  it('« Perdre les données » ouvre la confirmation maison (texte existant, focus Annuler) et n\'émet RIEN tant que ce n\'est pas confirmé', async () => {
    const w = mountIt()
    await ouvreLaConfirmation(w)
    // Rien ne sort du composant : le parent ne verra qu'un `discard` déjà assumé.
    expect(w.emitted('discard')).toBeFalsy()
    expect(w.emitted('restore')).toBeFalsy()
    // La confirmation est le ConfirmDialog MAISON (jamais window.confirm, doctrine du
    // 31/08), avec le texte existant et le bouton de confirmation en variante danger.
    expect(w.find('[data-test="confirm-ok"]').exists()).toBe(true)
    expect(w.find('[data-test="confirm-cancel"]').exists()).toBe(true)
    expect(w.find('.cfd__msg').text()).toBe(i18n.global.t('saf.startFreshConfirm'))
    expect(w.find('[data-test="confirm-ok"]').text()).toBe('Perdre les données')
    expect(w.find('[data-test="confirm-cancel"]').text()).toBe('Annuler')
    // Focus initial sur l'option SÛRE (Annuler) — comportement par défaut du dialogue.
    expect(document.activeElement?.getAttribute('data-test')).toBe('confirm-cancel')
  })

  it('confirmation assumée : émet discard UNE fois et referme la confirmation', async () => {
    const w = mountIt()
    await ouvreLaConfirmation(w)
    await w.find('[data-test="confirm-ok"]').trigger('click')
    await flushPromises()
    expect(w.emitted('discard')).toHaveLength(1)
    expect(w.emitted('restore')).toBeFalsy()
    expect(w.find('[data-test="confirm-ok"]').exists()).toBe(false)
  })

  it('confirmation annulée : retour à l\'offre, rien n\'est émis', async () => {
    const w = mountIt()
    await ouvreLaConfirmation(w)
    await w.find('[data-test="confirm-cancel"]').trigger('click')
    await flushPromises()
    expect(w.emitted('discard')).toBeFalsy()
    expect(w.emitted('restore')).toBeFalsy()
    // L'offre est toujours le message : on n'est sorti de rien.
    expect(w.find('[data-test="local-restore-offer"]').exists()).toBe(true)
    expect(w.find('[data-test="confirm-ok"]').exists()).toBe(false)
  })

  it('met le focus initial sur « Restaurer »', async () => {
    mountIt()
    await flushPromises()
    expect(document.activeElement?.getAttribute('data-test')).toBe('local-restore-accept')
  })

  it('Échap emprunte le MÊME chemin que le clic : ouvre la confirmation, jamais la destruction', async () => {
    const w = mountIt()
    await w.find('[data-test="local-restore-offer"]').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    // Une touche ne détruit pas seule : elle mène à la confirmation.
    expect(w.emitted('discard')).toBeFalsy()
    expect(w.emitted('restore')).toBeFalsy()
    expect(w.find('[data-test="confirm-ok"]').exists()).toBe(true)
    // Et la sortie sûre reste la sortie : Annuler referme sans rien émettre.
    await w.find('[data-test="confirm-cancel"]').trigger('click')
    await flushPromises()
    expect(w.emitted('discard')).toBeFalsy()
    expect(w.find('[data-test="local-restore-offer"]').exists()).toBe(true)
  })

  it('Tab piège le focus entre les deux boutons (boucle dernier↔premier, composable partagé)', async () => {
    // Depuis le lot « dette juillet » (07/09), le piège est le composable partagé
    // useFocusTrap : il n'agit qu'aux BORNES (Tab sur le dernier → premier, Maj+Tab sur
    // le premier → dernier). Le pas intermédiaire est natif au navigateur — jsdom ne
    // simule pas le Tab natif, donc le test pose le focus là où le navigateur l'aurait
    // mis avant chaque pression de borne.
    const w = mountIt()
    await flushPromises()
    const dialog = w.find('[data-test="local-restore-offer"]')
    const accept = w.find('[data-test="local-restore-accept"]').element
    const decline = w.find('[data-test="local-restore-decline"]').element
    // Le focus initial est sur « Restaurer » (premier focusable).
    expect(document.activeElement).toBe(accept)
    // Sur le DERNIER focusable (« Perdre les données »), Tab reboucle au premier —
    // jamais hors du dialogue.
    decline.focus()
    await dialog.trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(accept)
    // Sur le PREMIER, Maj+Tab repart au dernier.
    await dialog.trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(decline)
  })
})
