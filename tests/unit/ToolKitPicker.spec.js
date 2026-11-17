// @vitest-environment jsdom
// Contenu d'un kit interchangeable : cases de tailles (sans doublon) et de câbles (un objet
// { cm, join } par exemplaire), diamètre de la fixation en choix à segments, émission d'un tableau trié.
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ToolKitPicker from '@/components/ToolKitPicker.vue'
import { CABLE_LENGTHS_CM } from '@/constants/tools'
import { sizesFor } from '@/constants/needle-sizes'
import { createTestI18n } from './helpers/i18n-router'

const i18n = createTestI18n()

function mountPicker(props = {}) {
  return mount(ToolKitPicker, {
    props: { sizes: [], cables: [], ...props },
    global: { plugins: [i18n], stubs: { AppIcon: true } },
  })
}

const sizeBoxes = (w) => w.findAll('[data-test="kit-size"]')
const cableBoxes = (w) => w.findAll('[data-test="kit-cable"]')
const c = (cm, join = null) => ({ cm, join })
const seg = (w, join) => w.find(`[data-test="cable-join"][data-value="${join}"]`)
const boxFor = (w, sel, value) => w.find(`[data-test="${sel}"][data-value="${value}"] input`)

describe('ToolKitPicker', () => {
  it('propose les tailles de tricot à partir de 2 mm et les câbles de la liste fermée', () => {
    const w = mountPicker()
    expect(sizeBoxes(w).map((b) => Number(b.attributes('data-value')))).toEqual(sizesFor('knitting').filter((mm) => mm >= 2))
    expect(cableBoxes(w).map((b) => Number(b.attributes('data-value')))).toEqual(CABLE_LENGTHS_CM)
  })

  it('chaque case de taille porte la taille en mm et son US', () => {
    const w = mountPicker()
    expect(w.find('[data-test="kit-size"][data-value="4"]').text()).toBe('4 mm (US 6)')
    expect(w.find('[data-test="kit-size"][data-value="3.5"]').text()).toBe('3,5 mm (US 4)')
  })

  it('échelle crochet : tailles de crochet à partir de 2 mm, équivalent « 4 mm (G-6) », fines seulement en acier', () => {
    const w = mountPicker({ scale: 'hook' })
    const values = (x) => sizeBoxes(x).map((b) => Number(b.attributes('data-value')))
    expect(values(w)).toEqual(sizesFor('hook').filter((mm) => mm >= 2))
    expect(w.find('[data-test="kit-size"][data-value="4"]').text()).toBe('4 mm (G-6)')
    expect(values(mountPicker({ scale: 'hook', material: 'steel' }))).toEqual(sizesFor('hook'))
  })

  it('sans câbles actifs, aucune case de câble ; les tailles restent', () => {
    const w = mountPicker({ showCables: false })
    expect(cableBoxes(w)).toHaveLength(0)
    expect(sizeBoxes(w).length).toBeGreaterThan(0)
  })

  it('cocher une taille émet le tableau trié', async () => {
    const w = mountPicker({ sizes: [5] })
    await boxFor(w, 'kit-size', 4).setValue(true)
    expect(w.emitted('update:sizes').at(-1)).toEqual([[4, 5]])
  })

  it('décocher une taille la retire', async () => {
    const w = mountPicker({ sizes: [4, 5] })
    expect(boxFor(w, 'kit-size', 4).element.checked).toBe(true)
    await boxFor(w, 'kit-size', 4).setValue(false)
    expect(w.emitted('update:sizes').at(-1)).toEqual([[5]])
  })

  it('cocher une longueur de câble émet le tableau trié', async () => {
    const w = mountPicker({ cables: [100] })
    await boxFor(w, 'kit-cable', 60).setValue(true)
    expect(w.emitted('update:cables').at(-1)).toEqual([[c(60), c(100)]])
    expect(w.find('[data-test="kit-cable"][data-value="60"]').text()).toBe('60 cm')
  })

  it('un compteur « + » ajoute un exemplaire, « − » en retire un, à 1 il décoche', async () => {
    const w = mountPicker({ cables: [20] })
    const pill = () => w.find('[data-test="kit-cable"][data-value="20"]')
    expect(pill().find('[data-test="cable-count"]').text()).toBe('1')
    await pill().find('[data-test="cable-plus"]').trigger('click')
    expect(w.emitted('update:cables').at(-1)).toEqual([[c(20), c(20)]])
    await w.setProps({ cables: [20, 20, 35] })
    await pill().find('[data-test="cable-minus"]').trigger('click')
    expect(w.emitted('update:cables').at(-1)).toEqual([[c(20), c(35)]])
    await w.setProps({ cables: [20, 35] })
    await pill().find('[data-test="cable-minus"]').trigger('click')
    expect(w.emitted('update:cables').at(-1)).toEqual([[c(35)]])
  })

  it('cocher 20 émet [20] et conserve les doublons des autres longueurs', async () => {
    const w = mountPicker({ cables: [35, 35] })
    await boxFor(w, 'kit-cable', 20).setValue(true)
    expect(w.emitted('update:cables').at(-1)).toEqual([[c(20), c(35), c(35)]])
    await boxFor(w, 'kit-cable', 35).setValue(false)
    expect(w.emitted('update:cables').at(-1)).toEqual([[]])
  })

  it('le compteur plafonne à 9 et ses boutons citent la longueur', () => {
    const w = mountPicker({ cables: Array(9).fill(20) })
    const pill = w.find('[data-test="kit-cable"][data-value="20"]')
    expect(pill.find('[data-test="cable-plus"]').element.disabled).toBe(true)
    expect(pill.find('[data-test="cable-plus"]').attributes('aria-label')).toBe(i18n.global.t('tools.form.cableMore', { cm: 20 }))
    expect(pill.find('[data-test="cable-minus"]').attributes('aria-label')).toBe(i18n.global.t('tools.form.cableLess', { cm: 20 }))
    expect(w.find('[data-test="kit-cable"][data-value="35"] [data-test="cable-count"]').exists()).toBe(false)
  })

  it('les boutons « − » et « + » ont pour nom la clé i18n citant la longueur', () => {
    const w = mountPicker({ cables: [35, 55] })
    for (const cm of [35, 55]) {
      const pill = w.find(`[data-test="kit-cable"][data-value="${cm}"]`)
      expect(pill.find('[data-test="cable-minus"]').attributes('aria-label')).toBe(i18n.global.t('tools.form.cableLess', { cm }))
      expect(pill.find('[data-test="cable-plus"]').attributes('aria-label')).toBe(i18n.global.t('tools.form.cableMore', { cm }))
    }
  })

  it('une région role="status" toujours montée annonce la longueur et le nombre', async () => {
    const w = mountPicker({ cables: [20] })
    const live = w.find('[role="status"]')
    expect(live.exists()).toBe(true)
    expect(live.text()).toBe('')
    await w.find('[data-test="kit-cable"][data-value="20"] [data-test="cable-plus"]').trigger('click')
    expect(w.find('[role="status"]').text()).toBe(i18n.global.t('tools.lengthCmCount', { cm: 20, count: 2 }))
    // Seule annonce : le chiffre du compteur n'est pas une seconde région vivante.
    expect(w.find('[data-test="cable-count"]').attributes('aria-live')).toBeUndefined()
  })

  it('« − » depuis 1 redonne le focus à la case de la longueur', async () => {
    const w = mountPicker({ cables: [20] })
    document.body.appendChild(w.element)
    await w.find('[data-test="kit-cable"][data-value="20"] [data-test="cable-minus"]').trigger('click')
    await w.vm.$nextTick()
    expect(document.activeElement).toBe(boxFor(w, 'kit-cable', 20).element)
    w.unmount()
  })

  describe('diamètre de la fixation', () => {
    it('quatre segments toujours affichés, « Non précisé » choisi par défaut, dans un radiogroup nommé', () => {
      const w = mountPicker()
      const group = w.find('[role="radiogroup"]')
      expect(group.exists()).toBe(true)
      expect(group.attributes('aria-label') || group.attributes('aria-labelledby')).toBeTruthy()
      const radios = group.findAll('[role="radio"]')
      expect(radios.map((r) => r.attributes('data-value'))).toEqual(['', 's', 'l', 'mini'])
      expect(radios.map((r) => r.text())).toEqual([i18n.global.t('tools.form.unset'), 'S', 'L', 'Mini'])
      expect(radios.map((r) => r.attributes('aria-checked'))).toEqual(['true', 'false', 'false', 'false'])
    })

    it('les pastilles montrent les câbles du diamètre choisi seulement', async () => {
      const w = mountPicker({ cables: [c(80, 's'), c(80, 'l'), c(100)] })
      const on = () => cableBoxes(w).filter((b) => b.classes('kitpick__pill--on')).map((b) => b.attributes('data-value'))
      expect(seg(w, 's').attributes('aria-checked')).toBe('true')
      expect(on()).toEqual(['80'])
      await seg(w, '').trigger('click')
      expect(on()).toEqual(['100'])
      expect(seg(w, '').attributes('aria-checked')).toBe('true')
      expect(seg(w, 's').attributes('aria-checked')).toBe('false')
    })

    it('cocher 80 cm sous S puis sous L donne deux câbles distincts ; changer de segment garde les autres', async () => {
      const w = mountPicker({ cables: [c(100)] })
      await seg(w, 's').trigger('click')
      await boxFor(w, 'kit-cable', 80).setValue(true)
      const afterS = w.emitted('update:cables').at(-1)[0]
      expect(afterS).toEqual([c(80, 's'), c(100)])
      await w.setProps({ cables: afterS })
      await seg(w, 'l').trigger('click')
      expect(boxFor(w, 'kit-cable', 80).element.checked).toBe(false)
      await boxFor(w, 'kit-cable', 80).setValue(true)
      expect(w.emitted('update:cables').at(-1)).toEqual([[c(80, 's'), c(80, 'l'), c(100)]])
    })

    it('un exemplaire de plus ou de moins ne touche que le diamètre choisi', async () => {
      const w = mountPicker({ cables: [c(80, 's'), c(80, 'l')] })
      await seg(w, 'l').trigger('click')
      await w.find('[data-test="kit-cable"][data-value="80"] [data-test="cable-plus"]').trigger('click')
      expect(w.emitted('update:cables').at(-1)).toEqual([[c(80, 's'), c(80, 'l'), c(80, 'l')]])
      await w.find('[data-test="kit-cable"][data-value="80"] [data-test="cable-minus"]').trigger('click')
      expect(w.emitted('update:cables').at(-1)).toEqual([[c(80, 's')]])
    })

    it('la ligne de résumé liste tout le contenu, diamètres et exemplaires compris', () => {
      const w = mountPicker({ cables: [c(100), c(20, 's'), c(80, 'l'), c(20, 's')] })
      expect(w.find('[data-test="cable-summary"]').text()).toBe('20 cm S ×2, 80 cm L, 100 cm')
      expect(mountPicker().find('[data-test="cable-summary"]').exists()).toBe(false)
    })

    it('accepte en entrée les nombres d\'un kit ancien : ils se lisent sous « Non précisé »', async () => {
      const w = mountPicker({ cables: [80, 80, 100] })
      expect(boxFor(w, 'kit-cable', 80).element.checked).toBe(true)
      expect(w.find('[data-test="kit-cable"][data-value="80"] [data-test="cable-count"]').text()).toBe('2')
      await boxFor(w, 'kit-cable', 60).setValue(true)
      expect(w.emitted('update:cables').at(-1)).toEqual([[c(60), c(80), c(80), c(100)]])
    })

    it('un kit de câbles S s\'ouvre sur le segment S, pastilles cochées', async () => {
      const w = mountPicker({ cables: [c(80, 's'), c(80, 's'), c(100, 'l')] })
      expect(seg(w, 's').attributes('aria-checked')).toBe('true')
      expect(boxFor(w, 'kit-cable', 80).element.checked).toBe(true)
      expect(boxFor(w, 'kit-cable', 100).element.checked).toBe(false)
    })

    it('les câbles qui arrivent après le montage (fiche rouverte) choisissent le segment du premier', async () => {
      const w = mountPicker()
      expect(seg(w, '').attributes('aria-checked')).toBe('true')
      await w.setProps({ cables: [c(60, 'l'), c(80)] })
      expect(seg(w, 'l').attributes('aria-checked')).toBe('true')
      expect(boxFor(w, 'kit-cable', 60).element.checked).toBe(true)
    })

    it('un segment choisi à la main n\'est plus déplacé par un changement de câbles', async () => {
      const w = mountPicker({ cables: [c(80, 's')] })
      await seg(w, 'mini').trigger('click')
      await w.setProps({ cables: [c(80, 's'), c(60, 's')] })
      expect(seg(w, 'mini').attributes('aria-checked')).toBe('true')
    })

    it('au clavier : les flèches déplacent le choix, une seule étape de tabulation', async () => {
      const w = mountPicker()
      expect(w.findAll('[role="radio"]').map((r) => r.attributes('tabindex'))).toEqual(['0', '-1', '-1', '-1'])
      await seg(w, '').trigger('keydown', { key: 'ArrowRight' })
      expect(seg(w, 's').attributes('aria-checked')).toBe('true')
      expect(seg(w, 's').attributes('tabindex')).toBe('0')
      await seg(w, 's').trigger('keydown', { key: 'ArrowLeft' })
      expect(seg(w, '').attributes('aria-checked')).toBe('true')
    })

    it('l\'annonce nomme le diamètre et jamais la clé brute', async () => {
      const w = mountPicker({ cables: [c(20, 's')] })
      await seg(w, 's').trigger('click')
      await w.find('[data-test="kit-cable"][data-value="20"] [data-test="cable-plus"]').trigger('click')
      expect(w.find('[role="status"]').text()).toBe('20 cm S ×2')
    })
  })
})
