import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  generatePalette, generateHeatColors, hueGradientCss, bgHex,
  DEFAULT_HUES, defaultHueFor, PRESET_HUES, presetHuesFor, warmAdapted,
} from '@/theme/palette'
import { HEAT_COLORS } from '@/utils/stats-grid'

// Ancienne teinte par défaut unique (avant T2, 31/08) : reste la RÉFÉRENCE de calibration
// des tokens — les valeurs de ROLES/HEAT_ROLES sont dérivées des hex d'origine, mesurés à
// cette teinte. Les assertions "reproduit les hex actuels" ci-dessous restent valables à 44.
const LEGACY_HUE = 44

// --- Copié VERBATIM de tests/e2e/theme-contrast-clair.spec.js (convention du dépôt : cf.
// son commentaire de tête « Copié VERBATIM de tests/e2e/theme-contrast.spec.js ») ---
function luminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function contrast(fg, bg) {
  const [a, b] = [luminance(fg), luminance(bg)]
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}
function parse(rgb) {
  return rgb.match(/[\d.]+/g).map(Number)
}
// --- fin du bloc copié ---

const ON_ACCENT = { light: [255, 255, 255], dark: [42, 30, 8] }
// Fix 08/09 : texte des fonds solides hors accent (sage, danger, mdc-*…), statique par thème.
const ON_SOLID = { light: [255, 255, 255], dark: [42, 30, 8] }
const INK = { light: [58, 46, 40], dark: [242, 233, 220] }

// Bande chaude du mode clair (miroir de palette.js::WARM_BAND) : l'accent y est rendu
// « sombre-adapté » (clair + TEXTE SOMBRE dessus, spec 08/09) — l'on-accent ATTENDU dépend
// donc de la teinte en clair, plus d'une constante par thème.
const WARM_BAND = { min: 40.5, max: 110 }
function expectedOnAccent(hue, theme) {
  if (theme === 'dark') return ON_ACCENT.dark
  return hue >= WARM_BAND.min && hue <= WARM_BAND.max ? ON_ACCENT.dark : ON_ACCENT.light
}

const toHex = (rgb) =>
  '#' + rgb.match(/\d+/g).map((n) => (+n).toString(16).padStart(2, '0')).join('')

const repoRoot = resolve(process.cwd())

// I1 (31/08) : les littéraux statiques de pré-paint (tokens.css + <meta theme-color> de
// index.html) doivent reproduire EXACTEMENT les défauts dynamiques — sinon le premier
// paint CSS montre le fond de l'ancienne teinte 44 et les gardes e2e assertReallyDark/Light
// lisent un écart de fond juste après un rechargement.
describe('pré-paint statique = défaut dynamique (tokens.css, index.html)', () => {
  const css = readFileSync(`${repoRoot}/src/styles/tokens.css`, 'utf8')
  const html = readFileSync(`${repoRoot}/index.html`, 'utf8')

  function assertBlock(blockName, hue, theme, tokens) {
    const blockStart = css.indexOf(blockName)
    expect(blockStart).toBeGreaterThan(-1)
    // Bloc sombre : jusqu'à l'accolade fermante du bloc ; bloc clair : jusqu'au bloc sombre.
    const blockEnd =
      blockName === ':root {'
        ? css.indexOf('@media (prefers-color-scheme: dark)')
        : css.indexOf('}', blockStart)
    const block = css.slice(blockStart, blockEnd)
    for (const [prop, value] of Object.entries(tokens)) {
      // rgb() -> hex ; un dégradé contient plusieurs rgb() -> chaque arrêt en hex
      const expected = value.replace(/rgb\(([\d.]+), ([\d.]+), ([\d.]+)\)/g, (_, r, g, b) =>
        toHex(`rgb(${r}, ${g}, ${b})`),
      )
      expect(block, `${blockName} / ${prop}`).toContain(`${prop}: ${expected}`)
    }
  }

  it(':root (clair) porte les littéraux de generatePalette(230, "light")', () => {
    assertBlock(':root {', 230, 'light', generatePalette(230, 'light'))
  })
  it('les deux blocs sombres portent les littéraux de generatePalette(320, "dark")', () => {
    const dark = generatePalette(320, 'dark')
    const darkBlockCount = css.split("--bg: #151215").length - 1
    expect(darkBlockCount).toBe(2) // media query + data-theme, valeurs strictement identiques
    for (const marker of ["@media (prefers-color-scheme: dark)", ":root[data-theme='dark']"]) {
      assertBlock(marker, 320, 'dark', dark)
    }
  })
  it('index.html pré-peint <meta theme-color> au fond clair par défaut (bgHex(230, "light"))', () => {
    expect(html).toContain(`<meta name="theme-color" content="${bgHex(230, 'light')}">`)
  })
})

describe('generatePalette — contraste WCAG AA sur toute la roue de teintes', () => {
  for (const theme of ['light', 'dark']) {
    it(`${theme} : --on-accent vs --brand >= 4.5:1 tous les 2° (clair : texte sombre dans la bande chaude, blanc ailleurs)`, () => {
      for (let h = 0; h < 360; h += 2) {
        const brand = parse(generatePalette(h, theme)['--brand'])
        expect(contrast(expectedOnAccent(h, theme), brand)).toBeGreaterThanOrEqual(4.5)
      }
    })
    it(`${theme} : --on-accent vs les deux arrêts de --brand-grad >= 4.5:1 tous les 2°`, () => {
      for (let h = 0; h < 360; h += 2) {
        const grad = generatePalette(h, theme)['--brand-grad']
        const stops = grad.match(/rgb\([^)]+\)/g).map(parse)
        expect(stops).toHaveLength(2)
        for (const stop of stops) {
          expect(contrast(expectedOnAccent(h, theme), stop)).toBeGreaterThanOrEqual(4.5)
        }
      }
    })
    it(`${theme} : --brand-deep (texte) vs --bg >= 4.5:1 tous les 2°`, () => {
      for (let h = 0; h < 360; h += 2) {
        const tokens = generatePalette(h, theme)
        expect(contrast(parse(tokens['--brand-deep']), parse(tokens['--bg']))).toBeGreaterThanOrEqual(4.5)
      }
    })
    it(`${theme} : --ink vs --surface/--bg/--page/--tile >= 4.5:1 tous les 5°`, () => {
      for (let h = 0; h < 360; h += 5) {
        const tokens = generatePalette(h, theme)
        for (const role of ['--surface', '--bg', '--page', '--tile']) {
          expect(contrast(INK[theme], parse(tokens[role]))).toBeGreaterThanOrEqual(4.5)
        }
      }
    })
  }
})

describe('generatePalette — bornes et défauts', () => {
  it('normalise une teinte hors [0,360[', () => {
    expect(generatePalette(-10, 'light')['--brand']).toBe(generatePalette(350, 'light')['--brand'])
    expect(generatePalette(360, 'light')['--brand']).toBe(generatePalette(0, 'light')['--brand'])
  })
  it('theme inconnu retombe sur "light"', () => {
    expect(generatePalette(90, 'nope')).toEqual(generatePalette(90, 'light'))
  })
  it('la teinte de référence 44 reproduit EXACTEMENT les hex ORIGINAUX de calibration (avatars d\'avant T2)', () => {
    const light = generatePalette(LEGACY_HUE, 'light')
    const dark = generatePalette(LEGACY_HUE, 'dark')
    // Ces rôles gardent leur L/C/off d'origine (non retouchés pour l'AA, contrairement à
    // brand) : le générateur doit donc reproduire au pixel près les hex d'origine, mesurés
    // à 44 avant T2. Ces valeurs ne sont PLUS celles de tokens.css depuis I1 (31/08) — le
    // CSS statique est ré-ancré aux défauts dynamiques (cf. le test tokens.css ci-dessous)
    // — mais elles restent la preuve que la calibration des rôles n'a pas dérivé.
    expect(light['--bg']).toBe('rgb(250, 246, 238)') // #faf6ee (original)
    expect(light['--surface']).toBe('rgb(236, 228, 213)') // #ece4d5 (original)
    expect(light['--page']).toBe('rgb(237, 228, 212)') // #ede4d4 (original)
    expect(light['--tile']).toBe('rgb(255, 248, 238)') // #fff8ee (original, chromaticité NON réduite)
    expect(dark['--bg']).toBe('rgb(22, 18, 16)') // #161210 (original)
    expect(dark['--brand']).toBe('rgb(232, 173, 76)') // #e8ad4c (original)
  })
  it('la teinte de référence 44 : --brand sombre original (#e8ad4c) ; --brand clair « sombre-adapté » (#ff9c71), le rôle clair AA restant lisible juste sous la bande (40°)', () => {
    // --brand clair original (#ad5a34, L=55,94/C=0,1202) contrastait à 3,93:1 vers H≈190° —
    // sous le seuil AA : le rôle a été assombri/désaturé (L=52/C=0,10, spec 23/08), ce qui
    // donnait 152,84,54 à la teinte de calibration 44. Depuis le 08/09, la bande chaude
    // claire (44 INCLUS) bascule sur le rendu « sombre-adapté » (L/C sombres + texte sombre,
    // cf. describe dédié ci-dessous) : la valeur L 52 ne se lit donc plus à 44 — elle reste
    // ancrée juste sous la bande (40° → 153, 83, 58, blanc à 5,75:1, marge AA conservée).
    expect(generatePalette(LEGACY_HUE, 'dark')['--brand']).toBe('rgb(232, 173, 76)')
    expect(generatePalette(LEGACY_HUE, 'light')['--brand']).toBe('rgb(255, 156, 113)')
    expect(generatePalette(40, 'light')['--brand']).toBe('rgb(153, 83, 58)')
  })
  // T2 (31/08) : teinte par défaut DYNAMIQUE tant qu'aucun choix explicite n'a été fait.
  it('défauts dynamiques : 230 (bleu) en clair, 320 (rose) en sombre', () => {
    expect(DEFAULT_HUES).toEqual({ light: 230, dark: 320 })
    expect(defaultHueFor('light')).toBe(230)
    expect(defaultHueFor('dark')).toBe(320)
    expect(defaultHueFor('system')).toBe(230) // valeur non résolue → retombe sur clair
    expect(defaultHueFor('nimporte')).toBe(230)
  })
  it('PRESET_HUES : deux listes PAR THÈME, exactement celles du spec 08/09 (10 pastilles chacune)', () => {
    expect(PRESET_HUES.light).toEqual([15, 44, 70, 150, 190, 230, 250, 280, 320, 340])
    expect(PRESET_HUES.dark).toEqual([15, 44, 100, 150, 190, 210, 230, 280, 320, 340])
    // Même idiome que defaultHueFor : valeur non résolue → repli sur la liste claire.
    expect(presetHuesFor('light')).toBe(PRESET_HUES.light)
    expect(presetHuesFor('dark')).toBe(PRESET_HUES.dark)
    expect(presetHuesFor('system')).toBe(PRESET_HUES.light)
    expect(presetHuesFor('nimporte')).toBe(PRESET_HUES.light)
  })
  it('PRESET_HUES : >= 6 valeurs par liste, chaque teinte à >= 10° de la teinte de --danger DE SON THÈME (clair H≈30,5°, sombre H≈30,7°)', () => {
    for (const theme of ['light', 'dark']) {
      const hues = presetHuesFor(theme)
      expect(hues.length).toBeGreaterThanOrEqual(6)
      for (const h of hues) {
        if (theme === 'light') {
          const rawLight = Math.abs(h - 30.5)
          expect(Math.min(rawLight, 360 - rawLight)).toBeGreaterThanOrEqual(10)
        } else {
          // décalage du rôle brand sombre (+33°, cf. ROLES.dark.brand.off)
          const shifted = (h + 33) % 360
          const rawDark = Math.abs(shifted - 30.7)
          expect(Math.min(rawDark, 360 - rawDark)).toBeGreaterThanOrEqual(10)
        }
      }
    }
  })
})

describe('generatePalette — bande chaude claire « sombre-adapté » (spec 08/09)', () => {
  // Physique (spec) : en clair, brand vit à L 52 pour tenir >= 4,5:1 avec le texte blanc —
  // à cette luminosité, H 44-65 rend terracotta/brun et H 70-110 moutarde/olive. La bande
  // H ∈ [40,5 ; 110] (bords inclus) emprunte donc le tour du sombre : accent CLAIR (L/C du
  // rôle sombre, off du clair conservé) + texte SOMBRE dessus ; --brand-deep inchangé.
  it('warmAdapted : bords inclus [40,5 ; 110], teinte normalisée, sombre jamais concerné', () => {
    expect(warmAdapted(40.5, 'light')).toBe(true)
    expect(warmAdapted(40.4, 'light')).toBe(false)
    expect(warmAdapted(110, 'light')).toBe(true)
    expect(warmAdapted(110.1, 'light')).toBe(false)
    expect(warmAdapted(400.5, 'light')).toBe(true) // 400,5 ≡ 40,5 (normalisation)
    expect(warmAdapted(-319.5, 'light')).toBe(true) // -319,5 ≡ 40,5 (normalisation)
    expect(warmAdapted(44, 'dark')).toBe(false)
    expect(warmAdapted(110, 'dark')).toBe(false)
  })
  it('dans la bande (44, 70) : brand/grad aux L/C sombres + off clair, on-accent #2a1e08, --brand-rgb suit, --brand-deep clair inchangé', () => {
    const light44 = generatePalette(44, 'light')
    expect(light44['--brand']).toBe('rgb(255, 156, 113)') // #ff9c71 (orange corail, spec)
    expect(light44['--brand-grad']).toBe(
      'linear-gradient(180deg, rgb(255, 175, 129), rgb(255, 156, 113))',
    )
    expect(light44['--brand-rgb']).toBe('255, 156, 113') // suit brand (lavis translucides)
    expect(light44['--on-accent']).toBe('#2a1e08')
    // --on-solid (fonds solides hors accent : sage, danger, mdc-*) NE bascule PAS :
    // blanc statique — c'est tout l'objet du fix 08/09 (2,23:1 de #2a1e08 sur --danger).
    expect(light44['--on-solid']).toBe('#fff')
    expect(light44['--brand-deep']).toBe('rgb(136, 70, 43)') // rôle clair L 47 STRICTEMENT inchangé

    const light70 = generatePalette(70, 'light')
    expect(light70['--brand']).toBe('rgb(238, 169, 81)') // #eea951 (jaune doré, spec)
    expect(light70['--brand-grad']).toBe(
      'linear-gradient(180deg, rgb(250, 187, 103), rgb(238, 169, 81))',
    )
    expect(light70['--on-accent']).toBe('#2a1e08')
    expect(light70['--on-solid']).toBe('#fff')
    expect(light70['--brand-deep']).toBe('rgb(127, 78, 10)')
  })
  it('--on-solid est STATIQUE par thème : jamais de flip, quel que soit le thème ou la teinte', () => {
    for (let h = 0; h < 360; h += 3) {
      expect(generatePalette(h, 'light')['--on-solid']).toBe('#fff')
      expect(generatePalette(h, 'dark')['--on-solid']).toBe('#2a1e08')
    }
    // thème non résolu → repli clair, même idiome que ROLES/ON_ACCENT
    expect(generatePalette(44, 'nimporte')['--on-solid']).toBe('#fff')
  })
  it('sweep : --on-solid vs --brand-deep >= 4.5:1 sur 360° (paire .btn--primary:actif, min mesuré 6,27 clair / 5,78 sombre)', () => {
    for (const theme of ['light', 'dark']) {
      for (let h = 0; h < 360; h += 2) {
        const tokens = generatePalette(h, theme)
        expect(contrast(ON_SOLID[theme], parse(tokens['--brand-deep']))).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
  it('hors bande clair : rendu IDENTIQUE à avant, octet pour octet (ancres exactes 230 et 190)', () => {
    const p230 = generatePalette(230, 'light')
    expect(p230['--brand']).toBe('rgb(14, 115, 151)') // ancre e2e #0e7397
    expect(p230['--brand-deep']).toBe('rgb(0, 101, 134)')
    expect(p230['--brand-grad']).toBe('linear-gradient(180deg, rgb(31, 120, 159), rgb(14, 115, 151))')
    expect(p230['--on-accent']).toBe('#fff')
    expect(p230['--bg']).toBe('rgb(243, 246, 254)') // ancre e2e theme.spec.js (T2)

    const p190 = generatePalette(190, 'light')
    expect(p190['--brand']).toBe('rgb(0, 123, 118)')
    expect(p190['--on-accent']).toBe('#fff')
    // Juste HORS bande : le rendu clair historique (texte blanc sur L 52) reste la règle…
    expect(generatePalette(40, 'light')['--on-accent']).toBe('#fff')
    expect(generatePalette(111, 'light')['--on-accent']).toBe('#fff')
    // …et aucun autre rôle ne bascule jamais (le fond clair ne bouge pas, cf. spec).
    expect(generatePalette(70, 'light')['--bg']).toBe('rgb(247, 247, 239)')
    expect(generatePalette(44, 'light')['--surface']).toBe('rgb(236, 228, 213)') // hex d'origine
  })
  it('sombre : AUCUN flip sur toute la roue — mêmes valeurs dans la bande qu\'avant', () => {
    expect(generatePalette(44, 'dark')['--brand']).toBe('rgb(232, 173, 76)') // #e8ad4c original
    expect(generatePalette(44, 'dark')['--brand-grad']).toBe(
      'linear-gradient(180deg, rgb(242, 192, 99), rgb(232, 173, 76))',
    )
    expect(generatePalette(70, 'dark')['--brand']).toBe('rgb(201, 188, 77)')
    expect(generatePalette(44, 'dark')['--on-accent']).toBe('#2a1e08')
    expect(generatePalette(44, 'dark')['--brand-deep']).toBe('rgb(207, 146, 49)')
  })
  it('sweep AA de la bande claire au pas fin : on-accent sombre vs brand/gradTop >= 4.5:1 (mesuré ≈ 8:1)', () => {
    for (let h = 40.5; h <= 110.001; h += 0.5) {
      const tokens = generatePalette(h, 'light')
      expect(tokens['--on-accent']).toBe('#2a1e08')
      const stops = tokens['--brand-grad'].match(/rgb\([^)]+\)/g).map(parse)
      expect(contrast(ON_ACCENT.dark, parse(tokens['--brand']))).toBeGreaterThanOrEqual(4.5)
      for (const stop of stops) {
        expect(contrast(ON_ACCENT.dark, stop)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
  it('hueGradientCss subit le même flip (partagé via brandRoleFor, non dupliqué)', () => {
    const stops = hueGradientCss('light').match(/rgb\([^)]+\)/g)
    expect(stops).toHaveLength(13) // 0 → 360 tous les 30°
    expect(stops[2]).toBe('rgb(246, 164, 92)') // 60° : doré « sombre-adapté »
    expect(stops[3]).toBe('rgb(218, 181, 72)') // 90° : idem
    expect(stops[8]).toBe('rgb(39, 112, 156)') // 240° : hors bande, inchangé
    // Sombre : aucun arrêt ne bascule jamais.
    const darkStops = hueGradientCss('dark').match(/rgb\([^)]+\)/g)
    expect(darkStops[2]).toBe('rgb(214, 182, 73)') // 60° : rôle sombre pur (off +33°)
  })
})

describe('generatePalette — --brand-rgb (triplet nu, retour terrain 26/08 : bande "rang en cours")', () => {
  it('émet --brand-rgb comme triplet "r, g, b" (pas rgb(...)) sur toute la roue, cohérent avec --brand', () => {
    for (const theme of ['light', 'dark']) {
      for (let h = 0; h < 360; h += 15) {
        const tokens = generatePalette(h, theme)
        expect(tokens['--brand-rgb']).toMatch(/^\d+, \d+, \d+$/)
        expect(`rgb(${tokens['--brand-rgb']})`).toBe(tokens['--brand'])
      }
    }
  })
})

describe('hueGradientCss', () => {
  it('produit un gradient CSS avec au moins 2 arrêts rgb()', () => {
    const css = hueGradientCss('light')
    expect(css).toMatch(/^linear-gradient\(to right, /)
    expect(css.match(/rgb\(/g).length).toBeGreaterThanOrEqual(2)
  })
})

describe('bgHex', () => {
  it('reproduit --bg clair et sombres actuels à la teinte de référence 44', () => {
    expect(bgHex(LEGACY_HUE, 'light')).toBe('#faf6ee')
    expect(bgHex(LEGACY_HUE, 'dark')).toBe('#161210')
  })
  // Les valeurs ci-dessous sont celles que tests/e2e/theme.spec.js attend pour le fond par
  // défaut depuis T2 — l'ancrage unitaire protège la même propriété sans lancer Playwright.
  it('fonds par défaut aux nouvelles teintes dynamiques : #f3f6fe (230 clair), #151215 (320 sombre)', () => {
    expect(bgHex(230, 'light')).toBe('#f3f6fe')
    expect(bgHex(320, 'dark')).toBe('#151215')
  })
})

describe('generateHeatColors — calendrier des stats suit la teinte d\'accent', () => {
  it('la teinte de référence 44 reproduit EXACTEMENT HEAT_COLORS (stats-grid.js), palier 0 compris', () => {
    expect(generateHeatColors(LEGACY_HUE)).toEqual(HEAT_COLORS)
  })
  it('tourne avec la teinte, sans jamais peindre le palier 0', () => {
    for (const theme of ['light', 'dark']) {
      for (const hue of [0, 90, 180, 270, 359]) {
        const colors = generateHeatColors(hue)[theme]
        expect(colors[0]).toBeNull()
        expect(colors.slice(1)).not.toEqual(HEAT_COLORS[theme].slice(1))
        for (const hex of colors.slice(1)) expect(hex).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })
})
