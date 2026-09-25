// @vitest-environment jsdom
// Front (composant) — l'écran de recommandation de taille d'aiguilles/crochet.
// On teste le comportement à travers l'UI réelle (montage + i18n), pas une copie de
// la logique de src/utils/needle-gauge.js (déjà couverte par ses propres tests unitaires,
// cf. tests/unit/needle-gauge.spec.js).
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createTestingPinia } from '@pinia/testing'
import NeedleGaugeView from '@/views/NeedleGaugeView.vue'
import i18n from '@/i18n'
import { makeTk } from './helpers/i18n-router'

const tk = makeTk(i18n)

// Depuis le correctif « le calculateur ignore le réglage » (revue finale lot 2, 26/07),
// NeedleGaugeView lit useSettingsStore() dès le setup : un Pinia actif est désormais requis
// pour monter ce composant, même quand les tests ne s'intéressent pas aux unités.
function mountView() {
  return mount(NeedleGaugeView, {
    global: { plugins: [i18n, createPinia()], stubs: { AppHeader: true, FieldHelp: true } },
  })
}

async function fillLabel(w, needleMm, stitches, rows = '') {
  await w.find('input[placeholder="4"]').setValue(String(needleMm))
  await w.find('input[placeholder="22"]').setValue(String(stitches))
  if (rows) await w.find('input[placeholder="30"]').setValue(String(rows))
}
async function fillTarget(w, stitches, rows = '') {
  await w.find('input[placeholder="20"]').setValue(String(stitches))
  if (rows) await w.find('input[placeholder="28"]').setValue(String(rows))
}
// Bascule repérée par la clé i18n de son libellé.
function clickToggle(w, key) {
  return w.findAll('.toggle__opt').find((b) => b.text() === tk(key)).trigger('click')
}
function clickSearch(w) {
  return w.find('button.btn--primary').trigger('click')
}

describe('NeedleGaugeView', () => {
  it('invite à remplir les champs tant que la recommandation ne peut pas être calculée', () => {
    const w = mountView()
    expect(w.text()).toContain(tk('needleGauge.fillIn'))
  })

  it("n'affiche rien tant que le bouton Calculer n'a pas été cliqué, même champs remplis", async () => {
    const w = mountView()
    await fillLabel(w, 4, 22)
    await fillTarget(w, 20)
    expect(w.text()).not.toContain('4,5 mm')
    expect(w.text()).toContain(tk('needleGauge.fillIn'))
  })

  it('recommande une aiguille plus grosse (tricot) quand la laine tricote plus serré que la cible', async () => {
    const w = mountView()
    await fillLabel(w, 4, 22)
    await fillTarget(w, 20)
    await clickSearch(w)
    expect(w.text()).toContain('4,5 mm')
  })

  it('recommande une aiguille plus fine (tricot) quand la laine tricote plus lâche que la cible', async () => {
    const w = mountView()
    await fillLabel(w, 4, 18)
    await fillTarget(w, 20)
    await clickSearch(w)
    expect(w.text()).toContain('3,5 mm')
  })

  it("indique qu'aucun changement n'est nécessaire quand les mailles sont identiques", async () => {
    const w = mountView()
    await fillLabel(w, 4, 20)
    await fillTarget(w, 20)
    await clickSearch(w)
    expect(w.text()).toContain(tk('needleGauge.sameGauge'))
  })

  it('bascule sur Crochet et applique une table de tailles standards différente de celle du tricot', async () => {
    const knitting = mountView()
    await fillLabel(knitting, 6, 10)
    await fillTarget(knitting, 20)
    await clickSearch(knitting)
    expect(knitting.text()).toContain(tk('needleGauge.resultSmaller', { mm: '3' }))

    const crochet = mountView()
    await clickToggle(crochet, 'technique.crochet')
    await fillLabel(crochet, 6, 10)
    await fillTarget(crochet, 20)
    await clickSearch(crochet)
    expect(crochet.text()).toContain(tk('needleGauge.resultSmaller', { mm: '2,75' }))
  })

  it('bascule cm → pouces et met à jour le libellé du carré affiché', async () => {
    const w = mountView()
    expect(w.text()).toContain(tk('needleGauge.squareCm'))
    await clickToggle(w, 'needleGauge.unitIn')
    expect(w.text()).toContain(tk('needleGauge.squareIn'))
  })

  it('s’ouvre directement en pouces quand le réglage choisi est impérial (revue finale 26/07)', () => {
    // Avant correctif : `unit` valait toujours 'cm' en dur, quel que soit le réglage —
    // une utilisatrice en impérial devait re-basculer à chaque ouverture de l'écran.
    const pinia = createTestingPinia({ createSpy: vi.fn, initialState: { settings: { unitSystem: 'imperial' } } })
    const w = mount(NeedleGaugeView, {
      global: { plugins: [i18n, pinia], stubs: { AppHeader: true, FieldHelp: true } },
    })
    expect(w.text()).toContain(tk('needleGauge.squareIn'))
    expect(w.text()).not.toContain(tk('needleGauge.squareCm'))
  })

  it('signale un écart hors gamme quand le résultat calculé sort des tailles standards', async () => {
    const w = mountView()
    await fillLabel(w, 5, 10)
    await fillTarget(w, 40)
    await clickSearch(w)
    expect(w.text()).toContain(tk('needleGauge.outOfRange'))
  })

  it('signale une divergence de tendance sur les rangs', async () => {
    const w = mountView()
    await fillLabel(w, 4, 22, 26)
    await fillTarget(w, 20, 28)
    await clickSearch(w)
    expect(w.text()).toContain(tk('needleGauge.rowNote'))
  })

  it('affiche toujours le rappel de vérification par échantillon une fois un résultat calculé', async () => {
    const w = mountView()
    await fillLabel(w, 4, 22)
    await fillTarget(w, 20)
    await clickSearch(w)
    expect(w.text()).toContain(tk('needleGauge.caveat'))
  })

  it('invalide le résultat affiché si un champ est modifié après le calcul (ne montre jamais une reco périmée)', async () => {
    const w = mountView()
    await fillLabel(w, 4, 22)
    await fillTarget(w, 20)
    await clickSearch(w)
    expect(w.text()).toContain('4,5 mm')
    await w.find('input[placeholder="20"]').setValue('18')
    expect(w.text()).not.toContain('4,5 mm')
    expect(w.text()).toContain(tk('needleGauge.fillIn'))
  })
})

// La remontée du champ actif au-dessus du clavier virtuel n'est plus un mécanisme par
// écran depuis le 29/07 (cf. src/utils/keyboard-avoidance.js, posé une fois dans
// main.js) : elle est testée là-bas, avec l'écran Aiguilles comme un cas parmi
// d'autres, pas ici. Les 3 tests qui vivaient dans ce fichier (recentrage au focus,
// exclusion des boutons, mesure du VRAI bandeau) ont été repris tels quels dans
// tests/unit/keyboard-avoidance.spec.js.
