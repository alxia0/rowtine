// Écran Politique de confidentialité. Exigence légale,
// bloquante pour publier — le test vérifie que le contenu affiché porte bien les
// affirmations substantielles attendues (rien ne sort du téléphone, fonctionnement hors
// ligne, sort de désinstallation), pas seulement que la page se monte sans erreur.
//
// Traduite en anglais, allemand et espagnol (src/content/privacy-
// policy.<langue>.js, résolues par src/content/privacy-policy.js) : le 2e bloc de describe
// ci-dessous vérifie que les trois langues s'affichent bien selon la locale, avec le
// marqueur {app} substitué et la date affichée — mêmes exigences que le français, sans
// dupliquer les assertions de contenu légal détaillées (déjà couvertes côté français,
// le texte est une traduction du même contenu).
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import i18n from '@/i18n'
import AppHeader from '@/components/AppHeader.vue'
import PrivacyPolicyView from '@/views/PrivacyPolicyView.vue'
import { PRIVACY_POLICY_FR, PRIVACY_POLICY_UPDATED } from '@/content/privacy-policy.fr'
import { PRIVACY_POLICY_EN } from '@/content/privacy-policy.en'
import { PRIVACY_POLICY_DE } from '@/content/privacy-policy.de'
import { PRIVACY_POLICY_ES } from '@/content/privacy-policy.es'
import { CONTACT_EMAIL } from '@/constants/app-links'
import { withAppName } from '@/utils/app-name-token'

function mountPrivacy(locale = 'fr') {
  i18n.global.locale.value = locale
  return mount(PrivacyPolicyView, {
    global: { plugins: [i18n], stubs: { AppHeader: true } },
  })
}

const APP_NAME = i18n.global.messages.value.fr.app.name

describe('PrivacyPolicyView', () => {
  it('affiche tous les blocs du contenu (titres et paragraphes), marqueur {app} substitué', () => {
    const wrapper = mountPrivacy()
    for (const block of PRIVACY_POLICY_FR) {
      expect(wrapper.text()).toContain(withAppName(block.text, APP_NAME))
    }
  })

  it("ne laisse jamais échapper le marqueur brut « {app} » à l'écran", () => {
    const wrapper = mountPrivacy()
    expect(wrapper.text()).not.toContain('{app}')
  })

  it('affiche la date de dernière mise à jour', () => {
    const wrapper = mountPrivacy()
    expect(wrapper.text()).toContain(PRIVACY_POLICY_UPDATED)
  })

  it("affirme qu'aucune donnée ne sort du téléphone", () => {
    const wrapper = mountPrivacy()
    expect(wrapper.text()).toMatch(/rien.*sort|aucun.*serveur/i)
  })

  it('explique ce qui se passe à la désinstallation', () => {
    const wrapper = mountPrivacy()
    expect(wrapper.text()).toMatch(/désinstall/i)
  })

  it('nomme la responsable et un moyen de la contacter (bloquant diffusion)', () => {
    const wrapper = mountPrivacy()
    expect(wrapper.text()).toContain('Alexia O.')
    expect(wrapper.text()).toContain(CONTACT_EMAIL)
  })

  it('garde la flèche retour (sous-écran atteint depuis À propos)', () => {
    const wrapper = mountPrivacy()
    expect(wrapper.getComponent(AppHeader).props('back')).toBe(true)
  })
})

describe.each([
  ['anglais', 'en', () => PRIVACY_POLICY_EN],
  ['allemand', 'de', () => PRIVACY_POLICY_DE],
  ['espagnol', 'es', () => PRIVACY_POLICY_ES],
])('PrivacyPolicyView — contenu %s (traduit)', (_label, locale, getPolicy) => {
  it('affiche tous les blocs de la traduction, marqueur {app} substitué', () => {
    const wrapper = mountPrivacy(locale)
    for (const block of getPolicy()) {
      expect(wrapper.text()).toContain(withAppName(block.text, APP_NAME))
    }
    expect(wrapper.text()).not.toContain('{app}')
    // Exigence légale commune aux quatre langues (même nom, même adresse) : responsable
    // tranché le 04/09, adresse = CONTACT_EMAIL (seule porte, sans compte).
    expect(wrapper.text()).toContain('Alexia O.')
    expect(wrapper.text()).toContain(CONTACT_EMAIL)
  })

  it('affiche la date de dernière mise à jour', () => {
    const wrapper = mountPrivacy(locale)
    expect(wrapper.text()).toContain(PRIVACY_POLICY_UPDATED)
  })
})
