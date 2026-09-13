// Unitaire — taille "au repos" d'une photo dans la visionneuse (correctif du 09/08/2026).
//
// Fonction pure, sans DOM : jsdom ne décode aucune image (naturalWidth/Height restent à 0) et
// ne calcule aucune mise en page réelle (clientWidth/Height ne reflètent rien) — impossible de
// prouver ICI que la visionneuse affiche vraiment une petite photo sans l'agrandir sur un
// appareil réel. Ce test prouve seulement que LA FORMULE est correcte ; le reste (chargement
// de l'image, mesure du viewport) reste à vérifier sur appareil.
import { describe, it, expect } from 'vitest'
import { fitWithinBox, shouldRotatePanorama, PANORAMA_MIN_RATIO } from '@/utils/photo-fit'

describe('fitWithinBox — la base "zoom 100 %" ne dépasse jamais la taille naturelle', () => {
  it('petite image dans un grand viewport : taille naturelle inchangée (pas d\'agrandissement)', () => {
    expect(fitWithinBox(100, 50, 1000, 800)).toEqual({ w: 100, h: 50 })
  })

  it('grande image dans un petit viewport : réduite en conservant les proportions (comme contain)', () => {
    // image 2000x1000 (ratio 2:1) dans un viewport 500x500 → contrainte par la largeur
    expect(fitWithinBox(2000, 1000, 500, 500)).toEqual({ w: 500, h: 250 })
  })

  it('image plus haute que large, viewport contraint par la hauteur', () => {
    // image 400x1000 (portrait) dans un viewport 600x300 → contrainte par la hauteur
    const r = fitWithinBox(400, 1000, 600, 300)
    expect(r.h).toBe(300)
    expect(r.w).toBeCloseTo(120, 5) // 400 * (300/1000)
  })

  it('dimension manquante (image pas encore chargée, ou viewport pas mesurable) : null', () => {
    expect(fitWithinBox(0, 0, 500, 500)).toBeNull()
    expect(fitWithinBox(100, 100, 0, 0)).toBeNull()
    expect(fitWithinBox(null, 100, 500, 500)).toBeNull()
  })
})

// Critère de présentation pivotée (12/08/2026). Table de vérité de la fonction pure : la
// justification du seuil et des trois clauses est dans src/utils/photo-fit.js.
//
// Viewport de référence de ce fichier : 361 × 819, l'ordre de grandeur d'un téléphone tenu
// verticalement. Les dimensions EXACTES de l'appareil n'importent pas ici — c'est le rapport
// portrait qui est en jeu, et le rendu réel est mesuré par tests/e2e/guide-panorama.spec.js, qui
// relit le viewport en direct plutôt que de le coder en dur.
const VP_PORTRAIT = [361, 819]
const VP_PAYSAGE = [819, 361]

describe('shouldRotatePanorama — QUI est pivoté', () => {
  it('LE cas visé : le panorama de l’année du guide (1920 × 305) dans un viewport portrait', () => {
    expect(shouldRotatePanorama(1920, 305, ...VP_PORTRAIT)).toBe(true)
  })

  it('et la rotation lui fait vraiment gagner de la place (≈ 1,8× en taille linéaire)', () => {
    // Ce n'est pas une redite du test précédent : il mesure le GAIN, seule raison d'être de la
    // fonctionnalité. Debout, le panorama est plafonné par la largeur (361 px de large, 57 px de
    // haut : la bande illisible constatée sur appareil) ; pivoté, il dispose des 819 px de
    // hauteur, soit 819 × 130 — il occupe TOUTE la hauteur de l'écran.
    const droit = fitWithinBox(1920, 305, ...VP_PORTRAIT)
    const pivote = fitWithinBox(1920, 305, VP_PORTRAIT[1], VP_PORTRAIT[0])
    expect(droit.h).toBeCloseTo(57.3, 1) // la bande de quelques millimètres
    expect(pivote.w).toBeCloseTo(819, 1) // toute la hauteur de l'écran
    expect(pivote.w / droit.w).toBeGreaterThan(1.8)
  })
})

describe('shouldRotatePanorama — QUI ne bouge pas (rien ne change pour les autres images)', () => {
  it('une photo 4:3 (rapport 1,33) : inchangée', () => {
    expect(shouldRotatePanorama(4032, 3024, ...VP_PORTRAIT)).toBe(false)
  })

  it('une capture 16:9 (rapport 1,78) : inchangée', () => {
    expect(shouldRotatePanorama(1920, 1080, ...VP_PORTRAIT)).toBe(false)
  })

  it('la plus large image NON panoramique du guide (1440 × 876, rapport 1,64) : inchangée', () => {
    // Mesure du 12/08 sur les 200 fichiers de src/content/guide/images*/ : c'est l'image la plus
    // large après le panorama de l'année. Si une capture plus large que 3,0 entrait un jour dans
    // le guide, elle serait pivotée — c'est voulu, mais ce test dit où est la frontière.
    expect(shouldRotatePanorama(1440, 876, ...VP_PORTRAIT)).toBe(false)
  })

  it('un croquis carré : inchangé', () => {
    expect(shouldRotatePanorama(800, 800, ...VP_PORTRAIT)).toBe(false)
  })

  it('une photo en hauteur (480 × 888, le format des captures de téléphone du guide) : inchangée', () => {
    expect(shouldRotatePanorama(480, 888, ...VP_PORTRAIT)).toBe(false)
  })

  it('une image de rapport 2,0 : inchangée — le seuil doit rester au-dessus de 2,0', () => {
    // Plancher indépendant de la mesure des images : tests/unit/photo-lightbox-zoom.spec.js
    // place une image 2000 × 1000 dans un viewport portrait et attend la taille NON pivotée.
    // Tout seuil ≤ 2,0 rendrait ce test-là faux.
    expect(PANORAMA_MIN_RATIO).toBeGreaterThan(2)
    expect(shouldRotatePanorama(2000, 1000, 300, 800)).toBe(false)
  })
})

describe('shouldRotatePanorama — l’orientation du viewport compte autant que l’image', () => {
  it('LE MÊME panorama dans un viewport PAYSAGE : inchangé (il s’y affiche déjà bien)', () => {
    // Le pendant exact du premier test : mêmes dimensions d'image, viewport tourné. Les deux
    // ensemble sont ce qui prouve que l'orientation du viewport est bien lue.
    expect(shouldRotatePanorama(1920, 305, ...VP_PAYSAGE)).toBe(false)
  })

  it('viewport exactement carré : inchangé (aucune orientation à privilégier)', () => {
    expect(shouldRotatePanorama(1920, 305, 700, 700)).toBe(false)
  })
})

describe('shouldRotatePanorama — pas de rotation si l’image tient déjà en entier', () => {
  it('une bandelette 300 × 100 (rapport 3,0) qui tient déjà en entier : inchangée', () => {
    // Fréquent parmi les images extraites d'un PDF de patron (basse résolution). Elle passe le
    // seuil de rapport ET l'orientation, mais `fitWithinBox` ne l'agrandit jamais : elle est
    // rendue à sa taille naturelle dans les deux sens. La pivoter ne gagnerait pas un pixel.
    expect(shouldRotatePanorama(300, 100, ...VP_PORTRAIT)).toBe(false)
  })

  it('la même bandelette, plus grande que le viewport : pivotée, car là il y a un gain', () => {
    // Contre-épreuve indispensable : mêmes proportions (rapport 3,0), mais résolution suffisante
    // pour être plafonnée par la largeur du viewport. Sans elle, la troisième clause pourrait
    // être durcie en « refuser tout ce qui est petit » sans qu'aucun test ne rougisse.
    expect(shouldRotatePanorama(3000, 1000, ...VP_PORTRAIT)).toBe(true)
  })
})

describe('shouldRotatePanorama — dimension manquante', () => {
  it('image pas encore décodée ou viewport pas mesurable : jamais de rotation', () => {
    expect(shouldRotatePanorama(0, 0, ...VP_PORTRAIT)).toBe(false)
    expect(shouldRotatePanorama(1920, 305, 0, 0)).toBe(false)
    expect(shouldRotatePanorama(null, 305, ...VP_PORTRAIT)).toBe(false)
  })
})
