// @vitest-environment jsdom
// (lot P2, audit UX 17/07) — case à cocher maison, remplace les 3 cases natives
// du navigateur (CounterForm.vue ×2, ProjectEditView.vue ×1). Contrat :
// - un VRAI <input type="checkbox"> (clavier + lecteurs d'écran), jamais display:none.
// - masqué visuellement au motif 1×1 px + clip-path (repris de LibraryView `.lib-import__input`
//   / LocalPdfImportView `.file-pick__input`) — PAS
//   opacity:0 (Playwright le considérerait « visible », cf. piège déjà documenté).
// - anneau de focus CLAVIER via `:focus-visible` porté sur la case (frère adjacent de l'input) :
//   `:focus-within` (ancien) persistait après un tap tactile (focus gardé sur l'input caché,
//   bug device 19/07) ; `:focus-visible` ne se déclenche qu'au clavier. Pas `:has(:focus-visible)`
//   (absent des WebView Android < Chrome 105) — frère adjacent `+` à la place.
// - coche = icône du registre (@/utils/icons), jamais un glyphe ✓ ni un emoji.
// - cible tactile ≥ 44 px (mesure réelle en e2e, cf. tests/e2e/checkbox.spec.js).
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import AppCheckbox from '@/components/AppCheckbox.vue'

const src = () => readFileSync(resolve(process.cwd(), 'src/components/AppCheckbox.vue'), 'utf8')
// Le bloc <style>, expurgé des commentaires /* ... */ — sinon un commentaire qui
// EXPLIQUE pourquoi éviter `opacity:0`/`:has()` fait matcher le regex à tort (les
// commentaires du composant citent ces motifs justement pour les proscrire).
const styleCss = () => {
  const m = src().match(/<style[^>]*>([\s\S]*?)<\/style>/)
  return (m ? m[1] : '').replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('AppCheckbox', () => {
  it('rend un vrai <input type="checkbox">', () => {
    const w = mount(AppCheckbox, { props: { modelValue: false } })
    const input = w.get('input[type="checkbox"]')
    expect(input.element.tagName).toBe('INPUT')
  })

  it('modelValue=true → input.checked=true', () => {
    const w = mount(AppCheckbox, { props: { modelValue: true } })
    expect(w.get('input').element.checked).toBe(true)
  })

  it('modelValue=false → input.checked=false', () => {
    const w = mount(AppCheckbox, { props: { modelValue: false } })
    expect(w.get('input').element.checked).toBe(false)
  })

  it('coche via l’input émet update:modelValue(true) — compatible v-model', async () => {
    const w = mount(AppCheckbox, { props: { modelValue: false } })
    await w.get('input').setValue(true)
    expect(w.emitted('update:modelValue')[0]).toEqual([true])
  })

  it('décoche via l’input émet update:modelValue(false)', async () => {
    const w = mount(AppCheckbox, { props: { modelValue: true } })
    await w.get('input').setValue(false)
    expect(w.emitted('update:modelValue')[0]).toEqual([false])
  })

  it('le contenu du slot sert de libellé visible', () => {
    const w = mount(AppCheckbox, { props: { modelValue: false }, slots: { default: 'Suivre les augmentations' } })
    expect(w.text()).toContain('Suivre les augmentations')
  })

  it('le <label> englobe l’input (association native : cliquer le texte coche la case)', () => {
    const w = mount(AppCheckbox, { props: { modelValue: false }, slots: { default: 'Texte' } })
    expect(w.get('label').find('input[type="checkbox"]').exists()).toBe(true)
  })

  it('coché : affiche une icône du registre (jamais un glyphe ✓ ni un emoji)', () => {
    const on = mount(AppCheckbox, { props: { modelValue: true } })
    expect(on.find('.app-icon').exists()).toBe(true)
    expect(on.text()).not.toMatch(/✓|☑|✔/u)
  })

  it('décoché : pas d’icône de coche affichée', () => {
    const off = mount(AppCheckbox, { props: { modelValue: false } })
    expect(off.find('.app-icon').exists()).toBe(false)
  })

  it('masquage visuel : motif 1×1 px + clip-path — jamais display:none ni opacity:0', () => {
    const css = styleCss()
    expect(css).toMatch(/\.chk__input\s*\{[^}]*clip-path:\s*inset\(50%\)/s)
    expect(css).toMatch(/\.chk__input\s*\{[^}]*width:\s*1px/s)
    expect(css).not.toMatch(/display:\s*none/)
    // Check that .chk__input specifically doesn't use opacity: 0 for masking (uses clip-path instead)
    expect(css).not.toMatch(/\.chk__input\s*\{[^}]*opacity:\s*0/s)
  })

  it('anneau de focus CLAVIER via :focus-visible (pas :focus-within qui persistait au tap ; pas :has())', () => {
    const css = styleCss()
    expect(css).toMatch(/\.chk__input:focus-visible\s*\+\s*\.chk__box/) // anneau au focus clavier, porté sur la case
    expect(css).not.toMatch(/:focus-within/)                           // plus de :focus-within (anneau résiduel après tap tactile)
    expect(css).not.toMatch(/:has\(/)                                  // toujours pas de :has() (WebView Android < Chrome 105)
  })

  it("disabled=true → l'input natif porte l'attribut disabled", () => {
    const w = mount(AppCheckbox, { props: { modelValue: false, disabled: true } })
    expect(w.get('input').element.disabled).toBe(true)
  })

  it("disabled non fourni (par défaut) → l'input reste actif (rétrocompatibilité)", () => {
    const w = mount(AppCheckbox, { props: { modelValue: false } })
    expect(w.get('input').element.disabled).toBe(false)
  })

  it("disabled=true : classe visuelle dédiée posée sur le <label>, sans :has() ni :focus-within", () => {
    const w = mount(AppCheckbox, { props: { modelValue: false, disabled: true } })
    expect(w.get('label').classes()).toContain('chk--disabled')
    const css = styleCss()
    expect(css).toMatch(/\.chk--disabled\s*\{[^}]*cursor:\s*not-allowed/s)
    expect(css).toMatch(/\.chk--disabled\s+\.chk__box\s*\{[^}]*opacity:\s*0\.5/s)
    expect(css).not.toMatch(/:has\(/)
    expect(css).not.toMatch(/:focus-within/)
  })
})
