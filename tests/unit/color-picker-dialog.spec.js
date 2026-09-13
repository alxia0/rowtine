import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import ColorPickerDialog from '@/components/ColorPickerDialog.vue'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })
const stubs = { AppIcon: true }
const mountPicker = (props) => mount(ColorPickerDialog, { props, global: { plugins: [i18n], stubs } })

// jsdom donne un rect 0×0 pour tout élément (pas de layout réel) : on stub
// getBoundingClientRect pour simuler un carré 200×200 posé à l'origine.
function stubAreaRect(w, box = { left: 0, top: 0, width: 200, height: 200 }) {
  w.find('.cpick__area').element.getBoundingClientRect = () => ({
    ...box,
    right: box.left + box.width,
    bottom: box.top + box.height,
  })
}

describe('ColorPickerDialog', () => {
  it('fermé : rien n’est rendu', () => {
    expect(mountPicker({ open: false, color: '' }).find('.cpick').exists()).toBe(false)
  })
  it('ouvert : titre, carré, bande de teinte et champ hexa', () => {
    const w = mountPicker({ open: true, color: '' })
    expect(w.text()).toContain(fr.yarn.colorPickerTitle)
    expect(w.find('.cpick__area').exists()).toBe(true)
    expect(w.find('input[type=range]').exists()).toBe(true)
    expect(w.find('.cpick__hex').exists()).toBe(true)
  })
  it('s’initialise sur la couleur courante (le sélecteur rouvre là où on l’a laissé)', () => {
    const w = mountPicker({ open: true, color: 'hsl(240 100% 50%)' })
    expect(w.find('input[type=range]').element.value).toBe('240')
  })
  it('la bande de teinte met à jour l’aperçu', async () => {
    const w = mountPicker({ open: true, color: 'hsl(0 100% 50%)' })
    const hue = w.find('input[type=range]')
    await hue.setValue('120')
    expect(w.find('.cpick__hex').element.value.toLowerCase()).toBe('#00ff00')
  })
  it('saisir un hexa valide déplace le sélecteur', async () => {
    const w = mountPicker({ open: true, color: '' })
    await w.find('.cpick__hex').setValue('#0000ff')
    expect(w.find('input[type=range]').element.value).toBe('240')
  })
  it('Valider émet la couleur au format hsl de l’app (jamais du hex)', async () => {
    const w = mountPicker({ open: true, color: 'hsl(0 100% 50%)' })
    await w.find('.cpick__ok').trigger('click')
    expect(w.emitted('pick')[0][0]).toMatch(/^hsl\(\d+ \d+% \d+%\)$/)
  })
  it('Annuler ferme sans émettre de couleur', async () => {
    const w = mountPicker({ open: true, color: 'hsl(0 100% 50%)' })
    await w.find('.cpick__cancel').trigger('click')
    expect(w.emitted('close')).toBeTruthy()
    expect(w.emitted('pick')).toBeFalsy()
  })
  it('clic sur le scrim ferme sans émettre de couleur', async () => {
    const w = mountPicker({ open: true, color: '' })
    await w.find('.cpick__scrim').trigger('click')
    expect(w.emitted('close')).toBeTruthy()
    expect(w.emitted('pick')).toBeFalsy()
  })

  // Revue round-2 (Important) — le carré saturation × valeur n'avait aucun filet de test :
  // `updateFromPointer` fait `v = 100 - (y/hh)*100` (axe Y inversé, bas du carré = value
  // basse). C'est exactement ce genre d'inversion qui se fait silencieusement retourner.
  describe('updateFromPointer (carré saturation × valeur)', () => {
    // `.trigger('pointerdown', { clientX, clientY })` échoue sous jsdom : clientX/clientY
    // sont des accesseurs lecture-seule sur MouseEvent une fois construit (vue-test-utils
    // essaie de les affecter après coup). Même contournement que chart-fullscreen.spec.js :
    // un vrai PointerEvent construit avec ces coordonnées dans l'init, dispatché directement.
    function tapAt(w, clientX, clientY) {
      const el = w.find('.cpick__area').element
      el.dispatchEvent(new PointerEvent('pointerdown', { clientX, clientY, pointerId: 1, bubbles: true }))
    }

    it('tap en bas-gauche → s et v bas (marqueur en bas-gauche)', async () => {
      const w = mountPicker({ open: true, color: '' })
      stubAreaRect(w)
      tapAt(w, 0, 200)
      await w.vm.$nextTick()
      const marker = w.find('.cpick__marker')
      expect(marker.attributes('style')).toContain('left: 0%')
      expect(marker.attributes('style')).toContain('top: 100%') // v bas → top = 100 - v = 100%
    })

    it('tap en haut-droite → s et v hauts (marqueur en haut-droite)', async () => {
      const w = mountPicker({ open: true, color: '' })
      stubAreaRect(w)
      tapAt(w, 200, 0)
      await w.vm.$nextTick()
      const marker = w.find('.cpick__marker')
      expect(marker.attributes('style')).toContain('left: 100%')
      expect(marker.attributes('style')).toContain('top: 0%') // v haut → top = 100 - v = 0%
    })
  })

  // Ancrage du pop-up en haut du viewport (classe `cpick--kb-open`) pendant la saisie du
  // champ hexa : cf. commentaire du composant. Depuis le 29/07, le DÉFILEMENT lui-même
  // (`scrollIntoView`) n'est plus déclenché ici — c'est le mécanisme global
  // (src/utils/keyboard-avoidance.js) qui s'en charge pour toute l'app, testé séparément
  // dans tests/unit/keyboard-avoidance.spec.js. Ce qui reste testable ICI, c'est l'état
  // `keyboardOpen`/`cpick--kb-open` que ColorPickerDialog gère lui-même.
  describe('ancrage du pop-up pendant la saisie du champ hexa', () => {
    function mountAttached(props) {
      return mount(ColorPickerDialog, {
        props,
        global: { plugins: [i18n], stubs },
        attachTo: document.body,
      })
    }

    it('ancre le pop-up en haut du viewport au focus du champ hexa', async () => {
      const w = mountAttached({ open: true, color: '' })
      const hex = w.find('.cpick__hex')
      hex.element.focus()
      await w.vm.$nextTick()
      expect(w.find('.cpick').classes()).toContain('cpick--kb-open')
      w.unmount()
    })

    it('redescend le pop-up quand le champ hexa perd le focus', async () => {
      const w = mountAttached({ open: true, color: '' })
      const hex = w.find('.cpick__hex')
      hex.element.focus()
      await w.vm.$nextTick()
      expect(w.find('.cpick').classes()).toContain('cpick--kb-open')
      await hex.trigger('blur')
      expect(w.find('.cpick').classes()).not.toContain('cpick--kb-open')
      w.unmount()
    })

    it('à la fermeture du pop-up, l’ancrage haut est remis à zéro (pas de fuite entre deux ouvertures)', async () => {
      const w = mountAttached({ open: true, color: '' })
      const hex = w.find('.cpick__hex')
      hex.element.focus()
      await w.setProps({ open: false })
      await w.setProps({ open: true })
      expect(w.find('.cpick').classes()).not.toContain('cpick--kb-open')
      w.unmount()
    })
  })
})
