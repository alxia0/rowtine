// @vitest-environment jsdom
// FieldHelp — bouton d'aide contextuelle d'un champ.
//
// Deux défauts corrigés ici :
//   1. Le bouton portait un glyphe en dur (ⓘ, U+24D8) au lieu de passer par le registre
//      AppIcon (règle du dépôt : « jamais d'emoji ni de glyphe dans l'UI »).
//   2. Son nom accessible (`aria-label`) était l'astuce ELLE-MÊME (`:aria-label="hint"`) —
//      or ce bouton DÉPLIE cette astuce, qui redevient lisible dans le `<p>` en dessous.
//      Une personne au lecteur d'écran entendait donc la même phrase deux fois, sans qu'on
//      lui dise jamais ce que fait le bouton. Le nom accessible doit NOMMER l'action
//      (« Afficher l'aide pour {label} »), pas répéter le contenu qu'elle révèle.
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import FieldHelp from '@/components/FieldHelp.vue'
import AppIcon from '@/components/AppIcon.vue'
import i18n from '@/i18n'

function mountHelp(props = {}) {
  return mount(FieldHelp, {
    props: { label: 'Mailles / 10 cm', hint: 'Ton échantillon mesuré sur 10x10 cm.', ...props },
    global: { plugins: [i18n] },
  })
}

describe('FieldHelp — bouton d’aide contextuelle', () => {
  it('rend l’icône via AppIcon (registre help), sans emoji ni glyphe en dur dans le bouton', () => {
    const w = mountHelp()
    const btn = w.find('.fh__btn')
    expect(btn.exists()).toBe(true)

    const icon = btn.findComponent(AppIcon)
    expect(icon.exists()).toBe(true)
    expect(icon.props('name')).toBe('help')

    // Garde couplée à l'assertion AppIcon ci-dessus, pas autonome : `btn.text()` seul ne
    // prouve rien (un bouton sans texte passerait toujours) — c'est la PAIRE « une icône
    // AppIcon existe » + « aucun glyphe/emoji dans le texte » qui verrouille le remplacement
    // du ⓘ en dur. `\p{Extended_Pictographic}` seul ne suffit pas : ⓘ (U+24D8) n'est pas un
    // pictogramme récent, catégorie Unicode « Symbol, other » (\p{S}) — d'où l'union des
    // deux classes. Volontairement plus étroit qu'« aucun caractère hors ASCII » : un futur
    // libellé accentué (é, à…) dans le bouton ne doit pas faire échouer ce test-ci, seule la
    // règle anti-glyphe/emoji du projet est visée ici.
    const glyphOuEmoji = /\p{Extended_Pictographic}|\p{S}/u
    expect(glyphOuEmoji.test(btn.text())).toBe(false)
  })

  it('le nom accessible nomme l’action pour le champ, il ne répète pas l’astuce', () => {
    const hint = 'Ton échantillon mesuré sur 10×10 cm. Sert de référence pour vérifier ta jauge.'
    const label = 'Mailles / 10 cm'
    const w = mountHelp({ label, hint })
    const btn = w.find('.fh__btn')

    const expected = i18n.global.t('common.showFieldHelp', { label })
    expect(btn.attributes('aria-label')).toBe(expected)
    // L'astuce est désormais réservée au <p> déplié : la répéter comme nom du bouton
    // ferait entendre deux fois la même phrase à un lecteur d'écran.
    expect(btn.attributes('aria-label')).not.toBe(hint)
  })

  it('aria-expanded reflète l’état replié/déplié — sans lui, le nom accessible statique devient trompeur une fois ouvert', async () => {
    // Le nom accessible (« Afficher l'aide pour {label} ») est FIXE, quel que soit l'état.
    // Replié, il est juste. Déplié, le bouton fait l'inverse (il replie) : c'est
    // `aria-expanded` qui porte cette nuance pour un lecteur d'écran, pas le nom lui-même.
    // Sans cette assertion, rien n'empêche que l'attribut disparaisse un jour sans que rien
    // ne tombe — alors que le nom accessible deviendrait alors trompeur à l'état ouvert.
    const w = mountHelp()
    const btn = w.find('.fh__btn')
    expect(btn.attributes('aria-expanded')).toBe('false')

    await btn.trigger('click')
    expect(btn.attributes('aria-expanded')).toBe('true')

    await btn.trigger('click')
    expect(btn.attributes('aria-expanded')).toBe('false')
  })
})
