// @vitest-environment jsdom
// B6 (barre d'outils ENTIÈREMENT localisée) — buildToolbarHtml codait en dur
// en français TOUS les libellés hors menu Section (Étape/Note/Texte,
// sous-choix Compteur, placeholders, 7 libellés d'aide-mémoire, aria-label).
// Même seam que le menu Section : opts.labels, avec repli FR
// obligatoire (l'éditeur Markdown de dev appelle createCmEditor hors i18n).
//
// `sections` reprend la forme RÉELLE de groupedSectionKinds (src/utils/
// section-kinds.js, commit 01d9a10) : [{ family, label, items: [{ value,
// label }] }] — PAS `kinds` (corrigé depuis la version d'origine qui suggérait
// une forme inventée). Depuis, buildToolbarHtml
// ne LIT plus jamais `labels.sections` : Section est devenue une puce (comme
// Étape/Note/Texte) qui ouvre un popover à l'usage (wireToolbar), les
// libellés de kind/famille ne sont donc plus dans le HTML produit par cette
// fonction — ce sont eux qui restent gardés ci-dessous. La traduction du
// contenu du popover Section (kinds/familles groupés) est testée à part,
// via l'éditeur monté, dans cm-editor-section-menu.spec.js.
//
// Le bouton Image (re-balisage manuel) est retiré de la barre — les
// images restent parsées/rendues, seule l'ACTION de re-balisage disparaît (le
// tap sur l'image sélectionne désormais sa ligne pour les flèches monter/
// descendre, cf. cm-editor-image-select.spec.js). `image` n'est donc plus un
// libellé attendu par buildToolbarHtml.
//
// Compteur est passé de <select> à une puce (comme
// Section/Aide-mémoire) : `labels.counter` (l'ex-placeholder du
// <select>, « Compteur… ») n'est plus lu par buildToolbarHtml — seul
// `labels.ariaCounter` (aria-label/title/libellé visible de la puce) l'est
// désormais. `counter`/`counterRep`/`counterCadence` restent dans `EN`
// ci-dessous (contenu du popover, testé à part dans
// cm-editor-counter-menu.spec.js) mais ne sont plus attendus dans le HTML de
// la barre elle-même.
import { describe, it, expect } from 'vitest'
import { buildToolbarHtml } from '@/components/cm/cm-editor.js'

const EN = {
  step: 'Step',
  note: 'Note',
  text: 'Text',
  counter: 'Counter…',
  counterRep: 'Repeat',
  counterCadence: 'Cadence',
  section: 'Section…',
  reference: 'Reference…',
  chart: 'Chart',
  yarn: 'Yarn',
  needles: 'Needles',
  gauge: 'Gauge',
  materials: 'Materials',
  abbreviations: 'Abbreviations',
  measurements: 'Sizes',
  techniques: 'Techniques',
  ariaToolbar: 'Tag the line',
  ariaCounter: 'Counter',
  ariaSection: 'Section',
  ariaReference: 'Reference',
}

describe('buildToolbarHtml(labels)', () => {
  it('rend les libellés fournis, aucun libellé FR figé', () => {
    const html = buildToolbarHtml(EN)
    expect(html).toContain('aria-label="Step"')
    expect(html).toContain('Tag the line')
    // Puces Section/Aide-mémoire puis Compteur : libellé visible
    // traduit, pas seulement aria-label (même exigence que les 3 boutons
    // Étape/Note/Texte, cf. tests plus bas).
    expect(html).toContain('<span class="cm-retag-btn-label">Section</span>')
    expect(html).toContain('<span class="cm-retag-btn-label">Reference</span>')
    expect(html).toContain('<span class="cm-retag-btn-label">Counter</span>')
    expect(html).toContain('aria-label="Counter"')
    expect(html).not.toContain('aria-label="Étape"')
    expect(html).not.toContain('Baliser la ligne')
  })

  it('replie sur le FR sans labels (banc)', () => {
    const html = buildToolbarHtml()
    expect(html).toContain('aria-label="Étape"')
    expect(html).toContain('Baliser la ligne')
    expect(html).toContain('<span class="cm-retag-btn-label">Section</span>')
    expect(html).toContain('<span class="cm-retag-btn-label">Compteur</span>')
    expect(html).toContain('aria-label="Compteur"')
    // « Aide mémoire » (aria-label/title complets) mais libellé VISIBLE raccourci en FR
    // (labels.referenceChip, cf. retagMenuBtn) : mesuré Playwright réel à 360px, le libellé
    // complet enroule sur 2 lignes dans le carré 44px et casse le carré.
    expect(html).toContain('aria-label="Aide mémoire"')
    expect(html).toContain('<span class="cm-retag-btn-label">Mémoire</span>')
    expect(html).not.toContain('<span class="cm-retag-btn-label">Aide mémoire</span>')
  })

  it('ne rend plus le bouton Image (retiré) — EN et repli FR', () => {
    expect(buildToolbarHtml(EN)).not.toContain('data-retag="image"')
    expect(buildToolbarHtml()).not.toContain('data-retag="image"')
  })

  // Retour device : le `title` HTML ne s'affiche jamais
  // au tactile (pas de hover sur Android), donc un libellé porté seulement par
  // aria-label/title n'est en pratique JAMAIS visible sur l'écran — seul un texte
  // dans le DOM (un <span>, ici) l'est. On vérifie donc un libellé VISIBLE distinct
  // de l'aria-label pour chacun des 3 boutons Étape/Note/Texte, en repli FR et en EN.
  it('donne aux 3 boutons Étape/Note/Texte un libellé texte visible (pas seulement aria-label)', () => {
    const html = buildToolbarHtml()
    for (const [type, label] of [['rang', 'Étape'], ['note', 'Note'], ['texte', 'Texte']]) {
      const btnMatch = html.match(new RegExp(`<button[^>]*data-retag="${type}"[^>]*>([\\s\\S]*?)</button>`))
      expect(btnMatch, `bouton ${type} introuvable`).toBeTruthy()
      expect(btnMatch[1]).toContain(`<span class="cm-retag-btn-label">${label}</span>`)
    }
  })

  it('même libellé visible en EN, traduit (pas figé en FR)', () => {
    const html = buildToolbarHtml(EN)
    for (const [type, label] of [['rang', 'Step'], ['note', 'Note'], ['texte', 'Text']]) {
      const btnMatch = html.match(new RegExp(`<button[^>]*data-retag="${type}"[^>]*>([\\s\\S]*?)</button>`))
      expect(btnMatch[1]).toContain(`<span class="cm-retag-btn-label">${label}</span>`)
    }
    expect(html).not.toContain('<span class="cm-retag-btn-label">Étape</span>')
  })
})
