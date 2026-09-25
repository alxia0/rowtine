// @vitest-environment jsdom
// PatternForm : le champ échantillon (mailles/rangs) suit le système
// d'unités, exactement comme ProjectEditView (cf. tests/unit/ProjectEditView.spec.js pour
// la garde anti-conversion — PatternForm partage le même v-model direct sans transformation,
// pas de garde dupliquée ici). Ce fichier verrouille seulement le ré-étiquetage.
//
// PatternForm ne charge jamais les réglages lui-même (composant embarqué, pas une vue —
// cf. commentaire dans PatternForm.vue) : on pose donc `settings.unitSystem` directement
// sur le store avant le montage, comme le ferait le garde de route en usage réel.
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import i18n from '@/i18n'
import PatternForm from '@/components/PatternForm.vue'
import { useSettingsStore } from '@/stores/settings'

function mountForm(unitSystem) {
  const pinia = createPinia()
  setActivePinia(pinia)
  if (unitSystem) useSettingsStore(pinia).unitSystem = unitSystem
  return mount(PatternForm, { props: { initial: null, submitLabel: 'Enregistrer' }, global: { plugins: [pinia, i18n] } })
}

describe('PatternForm — échantillon suit le système d’unités (libellé seul)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('mode métrique (défaut) : libellé « Mailles / 10 cm », pas le libellé impérial', () => {
    const w = mountForm('metric')
    expect(w.text()).toContain(i18n.global.t('project.gaugeStitches'))
    expect(w.text()).not.toContain(i18n.global.t('project.gaugeStitchesImperial'))
  })

  it('mode impérial : libellés « Mailles / 4 po » et « Rangs / 4 po », pas les libellés métriques', () => {
    const w = mountForm('imperial')
    expect(w.text()).toContain(i18n.global.t('project.gaugeStitchesImperial'))
    expect(w.text()).toContain(i18n.global.t('project.gaugeRowsImperial'))
    expect(w.text()).not.toContain(i18n.global.t('project.gaugeStitches'))
    expect(w.text()).not.toContain(i18n.global.t('project.gaugeRows'))
  })

  it('mode impérial : l’aide contextuelle du champ mailles déplie le hint impérial', async () => {
    // Le hint n'est plus porté par `aria-label` (nom accessible du bouton, qui ne désigne
    // plus que l'action — cf. FieldHelp.vue) : on vérifie le hint réel là où il apparaît,
    // le <p> déplié après clic.
    const w = mountForm('imperial')
    const hintBtn = w.find('label[for="pat-gs"] .fh__btn')
    expect(hintBtn.exists()).toBe(true)
    await hintBtn.trigger('click')
    const hintP = hintBtn.element.closest('.fh').querySelector('.fh__hint')
    expect(hintP?.textContent).toBe(i18n.global.t('project.gaugeHintImperial'))
  })
})
