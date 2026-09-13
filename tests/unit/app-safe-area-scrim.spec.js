// Garde de la bande opaque de la barre de statut.
//
// Contexte : le modèle de défilement de l'app est le document. Sur les écrans sans en-tête
// collant opaque (fiche projet .phdr, fiche patron .phdr, onboarding), le contenu qui
// défile se peignait dans la bande `0 … --sa-top`, par-dessus l'heure / la batterie /
// l'encoche (Pixel 7, Android 17, WebView bord à bord). Le correctif est UNE bande fixe
// dans App.vue, frère de <RouterView> : `position: fixed`, `height: var(--sa-top)` (donc
// nulle sur web/e2e), `background: var(--bg)` opaque, sous les menus/voiles/dialogues mais
// au-dessus du contenu et des en-têtes collants.
//
// Ce test BALAIE la source de App.vue (commentaires retirés) pour qu'un futur remaniement
// qui retirerait la bande, la rendrait non opaque, la sortirait du viewport ou la ferait
// remonter au-dessus des dialogues plein écran soit arrêté à l'écriture — pas sur
// l'appareil de l'utilisatrice. Le rendu réel (hauteur mesurée, ordre de peinture) reste du
// ressort d'une vérif à l'œil sur appareil : ici on épingle le contrat CSS.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function sansCommentaires(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\s)\/\/[^\n]*/g, ' ')
}

const src = sansCommentaires(readFileSync(resolve('src/App.vue'), 'utf8'))

describe('bande opaque de la barre de statut — App.vue', () => {
  it('monte la bande dans le template, hors de la <Transition> de route', () => {
    // Tolérant à l'ordre des attributs : un <div> qui porte les deux, class et aria-hidden.
    const tag = src.match(/<div\s[^>]*class="sa-scrim"[^>]*>/)
    expect(tag, 'balise <div class="sa-scrim"> absente').toBeTruthy()
    expect(tag[0]).toMatch(/aria-hidden="true"/)
    // Elle doit être AVANT <RouterView> (frère, pas enfant du <component> transitionné) :
    // sinon elle serait démontée/remontée à chaque navigation.
    expect(src.indexOf('class="sa-scrim"')).toBeLessThan(src.indexOf('<RouterView'))
  })

  it('couvre la bande du haut, fixe et pleine largeur', () => {
    // Une SEULE règle .sa-scrim : une seconde occurrence plus bas dans le <style>
    // gagnerait sur l'appareil et les assertions ci-dessous (qui ne lisent que la 1re)
    // resteraient vertes — exactement le mode d'échec que cette garde vise.
    expect(src.match(/\.sa-scrim\s*\{/g), 'plusieurs règles .sa-scrim').toHaveLength(1)
    const rule = src.match(/\.sa-scrim\s*\{([^}]*)\}/)
    expect(rule, 'règle .sa-scrim absente').toBeTruthy()
    const body = rule[1]
    expect(body).toMatch(/position:\s*fixed/)
    expect(body).toMatch(/top:\s*0/)
    expect(body).toMatch(/left:\s*0/)
    expect(body).toMatch(/right:\s*0/)
    // Hauteur = l'inset natif exactement : 0 sur web (env() → 0px), la barre sur appareil.
    expect(body).toMatch(/height:\s*var\(--sa-top\)/)
  })

  it('est opaque et thème-aware (même fond que les en-têtes)', () => {
    const body = src.match(/\.sa-scrim\s*\{([^}]*)\}/)[1]
    expect(body).toMatch(/background:\s*var\(--bg\)/)
    // Aucune transparence : ni rgba/hsla à alpha, ni opacity < 1, ni "transparent".
    expect(body).not.toMatch(/opacity\s*:/)
    expect(body).not.toMatch(/transparent/)
  })

  it('ne mange ni tap ni scroll, et se peint entre les en-têtes collants et les voiles', () => {
    const body = src.match(/\.sa-scrim\s*\{([^}]*)\}/)[1]
    expect(body).toMatch(/pointer-events:\s*none/)
    const z = Number(body.match(/z-index:\s*(\d+)/)?.[1])
    // > en-têtes collants (.hdr = 40, .rhdr = 30) ; < menus/voiles (50), feuilles et
    // dialogues plein écran (80-85, dont le voile doit assombrir TOUTE la hauteur sans
    // liseré), SnackBar (100) et NavProgress (2000).
    expect(z).toBeGreaterThan(40)
    expect(z).toBeLessThan(50)
  })
})
