// Unitaire — le COMPORTEMENT PROPRE de l'astuce de navigation (drapeau, affichage,
// acquittement), indépendant de l'écran qui la monte. Le placement (Bibliothèque, Stock,
// fiche projet — jamais la fiche patron, décision produit du 19/08/2026) est prouvé à
// part, dans first-detail-tip-wiring.spec.js et first-detail-tip-bandeau-import.spec.js ;
// le composant, lui, porte toute la logique, les vues qui l'accueillent ne font que le
// poser.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db, setSetting, getSetting } from '@/db/db'
import i18n from '@/i18n'
import fr from '@/i18n/fr.json'

import FirstDetailTip from '@/components/FirstDetailTip.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

const wrappers = []
function doMount() {
  const w = mount(FirstDetailTip, { global: { plugins: [createPinia(), i18n] }, attachTo: document.body })
  wrappers.push(w)
  return w
}
async function settle() {
  for (let i = 0; i < 4; i++) {
    await flushPromises()
    await new Promise((r) => setTimeout(r))
  }
  await flushPromises()
}

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})
afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
})

describe("l'astuce de navigation (comportement propre, indépendant de l'écran)", () => {
  it("s'affiche quand elle n'a jamais été vue, avec les deux gestes", async () => {
    const w = doMount()
    await settle()
    const dlg = w.findComponent(ConfirmDialog)
    expect(dlg.props('open')).toBe(true)
    expect(dlg.props('title')).toBe(fr.onboarding.tipTitle)
    expect(dlg.props('message')).toBe(fr.onboarding.swipeHint)
    expect(dlg.props('confirmLabel')).toBe(fr.common.gotIt)
    // Les deux gestes sont bien là, pas seulement le premier.
    expect(dlg.props('message')).toContain('vers la droite')
    expect(dlg.props('message')).toContain('de droite à gauche')
    // Correctif « bienvenue centrée » (10/08/2026) : SEULE la pop-up de bienvenue de
    // l'accueil se centre. L'astuce de navigation reste une feuille du bas, à l'identique —
    // sa position n'a pas été remise en cause.
    expect(dlg.props('centered')).toBeFalsy()
  })

  it('ne s\'affiche pas si elle a déjà été vue', async () => {
    await setSetting('swipeHintSeen', true)
    const w = doMount()
    await settle()
    expect(w.findComponent(ConfirmDialog).props('open')).toBe(false)
  })

  it('écrit EN BASE qu\'elle a été vue quand on l\'acquitte', async () => {
    const w = doMount()
    await settle()
    await w.findComponent(ConfirmDialog).vm.$emit('confirm')
    await settle()
    expect(await getSetting('swipeHintSeen')).toBe(true)
    expect(w.findComponent(ConfirmDialog).props('open')).toBe(false)
  })

  it('ne revient pas au prochain écran qui la porte', async () => {
    const w1 = doMount()
    await settle()
    await w1.findComponent(ConfirmDialog).vm.$emit('confirm')
    await settle()

    // Deuxième écran porteur (Bibliothèque, Stock ou fiche projet, cf. l'en-tête de ce
    // fichier) : nouveau montage du composant, base déjà marquée.
    const w2 = doMount()
    await settle()
    expect(w2.findComponent(ConfirmDialog).props('open')).toBe(false)
  })

  // Correctif revue finale (10/08/2026) : l'astuce enseigne le geste « balaie vers la
  // droite pour revenir en arrière », que `useSwipeBack` écoute PARTOUT sans garde de
  // modale. Si l'utilisatrice l'essaie aussitôt, le retour quitte la fiche AVANT tout
  // acquittement — le comportement le plus probable au premier essai réel. Le drapeau
  // doit donc être posé dès l'AFFICHAGE, pas seulement au clic sur « C'est compris ».
  it("un démontage SANS acquittement (balayage retour) marque quand même le drapeau, et l'écran porteur suivant ne remontre pas l'astuce", async () => {
    const w1 = doMount()
    await settle()
    expect(w1.findComponent(ConfirmDialog).props('open')).toBe(true)

    // Démontage sans jamais émettre `confirm` : simule le balayage retour qui quitte
    // l'écran avant que l'utilisatrice n'ait cliqué le bouton.
    w1.unmount()
    wrappers.splice(wrappers.indexOf(w1), 1) // déjà démonté : éviter le double unmount en afterEach

    expect(await getSetting('swipeHintSeen')).toBe(true)

    // Écran porteur suivant : nouveau montage, l'astuce ne revient pas.
    const w2 = doMount()
    await settle()
    expect(w2.findComponent(ConfirmDialog).props('open')).toBe(false)
  })
})
