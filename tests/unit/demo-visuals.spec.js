import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEMO_SKETCH_BONNET, DEMO_SKETCH_ECHARPE, DEMO_SKETCH_SAC } from '@/constants/demo-visuals'
// Importé en NAMESPACE, et pas par ses trois noms : la garde de poids plus bas doit peser
// tout ce que le module généré embarque, y compris un export qu'on y ajouterait demain.
import * as demoPhotos from '@/generated/demo-photos'

const CHART = resolve(process.cwd(), 'public/demo/torsade-chart.svg')

describe('diagramme de démonstration', () => {
  it('existe', () => {
    expect(existsSync(CHART)).toBe(true)
  })

  it('remplit exactement le cadre : 8 colonnes × 24 rangs de 20 points, sans marge', () => {
    // Le calage du rideau et du zoom suppose une grille qui occupe tout le cadre. Une
    // marge d'un seul point décale toutes les lignes surlignées.
    const svg = readFileSync(CHART, 'utf8')
    expect(svg).toContain('viewBox="0 0 160 480"')
  })

  it('le dessin touche réellement les quatre bords : pas de <g transform> qui déplace ou réduit le contenu', () => {
    // Le viewBox seul ne suffit pas : un <g transform="translate(4,4) scale(0.95)"> autour
    // du contenu introduit une marge de 4 points ET réduit le dessin de 5 % en laissant le
    // viewBox intact — la ligne ci-dessus resterait verte tout en décalant chaque rang
    // surligné sur l'appareil de l'utilisatrice. On vérifie donc le CONTENU, pas seulement
    // l'en-tête : présence des 4 traits de bordure exactement sur les coordonnées extrêmes,
    // et absence de tout transform= dans le fichier.
    const svg = readFileSync(CHART, 'utf8')
    expect(svg).not.toMatch(/transform=/)
    expect(svg).toContain('x1="0" y1="0" x2="0" y2="480"') // bordure verticale gauche, x=0
    expect(svg).toContain('x1="160" y1="0" x2="160" y2="480"') // bordure verticale droite, x=160
    expect(svg).toContain('x1="0" y1="0" x2="160" y2="0"') // bordure horizontale haute, y=0
    expect(svg).toContain('x1="0" y1="480" x2="160" y2="480"') // bordure horizontale basse, y=480
  })
})

describe('photos de démonstration', () => {
  const PHOTOS = [
    ['bonnet', DEMO_SKETCH_BONNET],
    ['echarpe', DEMO_SKETCH_ECHARPE],
    ['sac', DEMO_SKETCH_SAC],
  ]

  for (const [name, src] of PHOTOS) {
    it(`${name} : data URL WebP affichable dans une <img>`, () => {
      // La FORME compte autant que le contenu : ces chaînes partent dans `photos[0]` de la
      // fiche patron, donc dans les sauvegardes et l'export .zip. Un chemin de fichier y
      // survivrait à l'écriture et deviendrait une image cassée à la restauration sur un
      // autre appareil — c'est arrivé trois fois sur ce projet.
      expect(src.startsWith('data:image/webp;base64,')).toBe(true)
      // Une data-URL tronquée commence bien mais n'affiche rien : on exige un corps réel.
      expect(src.length).toBeGreaterThan(10_000)
    })
  }

  it('tout ce que le module généré embarque pèse ensemble moins de 320 Ko', () => {
    // GARDE DE L'APK. Les photos des vrais patrons ont été retirées le 30/07 parce
    // qu'elles pesaient 989 Ko ; celles-ci en pèsent 275 (mesuré, base64 compris). Le
    // plafond laisse ~16 % de marge et interdit qu'on y revienne sans s'en apercevoir :
    // ces octets sont dans l'APK de chaque utilisatrice, qu'elle ouvre les exemples ou non.
    //
    // La garde pèse TOUS LES EXPORTS de @/generated/demo-photos, et non la somme des trois
    // DEMO_SKETCH_* de demo-visuals.js (revue finale du 12/08) : ceux-ci ne sont que des
    // ré-exports. Une quatrième photo ajoutée au module généré et consommée directement
    // échappait au plafond — la garde bornait les ré-exports, pas ce qui part vraiment
    // dans l'APK. Elle est désormais solidaire du fichier réellement embarqué.
    const embarque = Object.values(demoPhotos).filter((v) => typeof v === 'string')
    // Un module devenu vide (ou dont les exports auraient changé de forme) rendrait la
    // somme nulle et la garde vacuously verte : on exige d'abord qu'il y ait quelque chose
    // à peser, et au moins les trois photos connues.
    expect(embarque.length).toBeGreaterThanOrEqual(3)
    const total = embarque.reduce((n, src) => n + src.length, 0)
    expect(total).toBeLessThan(320 * 1024)
  })
})
