import { describe, it, expect } from 'vitest'
import { associateImages } from '@/utils/pdf-import/associate'

// Page 0 : deux lignes de texte, y décroissant vers le bas de page.
const linesByPage = [
  [
    { text: 'Rép. les rangs 2-3, encore 10 fois.', y: 500 },
    { text: 'Monter 96 mailles.', y: 700 },
  ],
]

const sections = [
  {
    id: 's1',
    steps: [
      { t: 'Monter {{0}} mailles.', c: [[96]] },
      { t: 'Rép. les rangs 2-3, encore 10 fois.', c: [] },
    ],
  },
]

const img = (o) => ({ src: 'data:image/png;base64,AAA', page: 1, x: 40, y: 470, w: 300, h: 200, ...o })

describe('associateImages', () => {
  it('ancre l’image à la ligne juste au-dessus et la relie au bon step', () => {
    const { sections: out, gallery } = associateImages(sections, [img()], linesByPage)
    // image (y_top=470) → ligne la plus proche AU-DESSUS = "Rép..." (y=500)
    expect(out[0].steps[1].imgs).toEqual(['data:image/png;base64,AAA'])
    expect(out[0].steps[0].imgs).toBeUndefined()
    // reliée ⇒ absente de la galerie
    expect(gallery).toEqual([])
  })

  it('matching insensible aux accents et aux marqueurs {{i}}', () => {
    const secs = [{ id: 's', steps: [{ t: 'Tricoter {{0}} m. à l’endroit', c: [[10]] }] }]
    const pages = [[{ text: 'Tricoter 10 m. a l endroit', y: 600 }]]
    const { sections: out, gallery } = associateImages(secs, [img({ y: 560 })], pages)
    expect(out[0].steps[0].imgs).toHaveLength(1)
    expect(gallery).toHaveLength(0)
  })

  it('sans ligne d’ancrage sûre → image en galerie, aucun imgs', () => {
    // image très haut (y_top=1200), aucune ligne au-dessus dans la limite → galerie
    const { sections: out, gallery } = associateImages(sections, [img({ y: 1200 })], linesByPage)
    expect(out[0].steps.every((s) => !s.imgs)).toBe(true)
    expect(gallery).toEqual([{ src: 'data:image/png;base64,AAA', page: 1, w: 300, h: 200 }])
  })

  it('ligne sans step correspondant → galerie', () => {
    const pages = [[{ text: 'Texte sans équivalent dans le reader', y: 500 }]]
    const { sections: out, gallery } = associateImages(sections, [img()], pages)
    expect(out[0].steps.every((s) => !s.imgs)).toBe(true)
    expect(gallery).toHaveLength(1)
  })

  it('plusieurs images sous une même ligne s’empilent dans imgs', () => {
    const imgs = [img({ src: 'data:image/png;base64,A' }), img({ src: 'data:image/png;base64,B', x: 200 })]
    const { sections: out } = associateImages(sections, imgs, linesByPage)
    expect(out[0].steps[1].imgs).toEqual(['data:image/png;base64,A', 'data:image/png;base64,B'])
  })

  it('entrées vides → sections copiées, galerie vide', () => {
    const { sections: out, gallery } = associateImages(sections, [], [])
    expect(gallery).toEqual([])
    expect(out).toHaveLength(1)
    expect(out).not.toBe(sections)
  })

  // Couverture affichée : la page 1 y est déjà visible, ses images ne vont pas dans le fil.
  it('coverShown : une image de page 1 ancrable reste en galerie', () => {
    const { sections: out, gallery } = associateImages(sections, [img()], linesByPage, { coverShown: true })
    expect(out[0].steps.every((s) => !s.imgs)).toBe(true)
    expect(gallery).toHaveLength(1)
  })

  // Couverture rognée : seules les images de page 1 visibles dans le cadre restent hors du fil.
  it('coverBox : une image dans le cadre reste en galerie, une image hors cadre suit le fil', () => {
    const inside = associateImages(sections, [img()], linesByPage, { coverBox: { x0: 0, y0: 200, x1: 400, y1: 500 } })
    expect(inside.gallery).toHaveLength(1)
    const outside = associateImages(sections, [img()], linesByPage, { coverBox: { x0: 0, y0: 600, x1: 400, y1: 800 } })
    expect(outside.sections[0].steps[1].imgs).toHaveLength(1)
  })
})

// Plusieurs rangs correspondent à la ligne d'ancrage : choisir celui que le texte
// au-dessus de l'image prolonge, puis celui de la section active, sinon le premier.
describe('associateImages : choix parmi plusieurs rangs qui correspondent', () => {
  const X = 'data:image/png;base64,X'
  const attachedAt = (out) =>
    out.flatMap((s) => s.steps.map((st, k) => (st.imgs ? `${s.title}#${k}` : null))).filter(Boolean)

  it('repli chiffres neutralisés : le rang dont les lignes précédentes font partie (margrethe p3)', () => {
    const pages = [
      [
        { text: 'LE HAUT DU PANTALON', y: 429 },
        { text: 'Tour 1 : Monter 184 (200) 216 (232) ml et relier avec une mc.', y: 414 },
        { text: 'Tour 2-5 : Réaliser 2 ml, 183 (199) 215 (231) br, terminer avec une mc.', y: 401 },
        { text: 'Tour 6-29 : Réaliser 2 ml, 35 (39) 43 (47) br, crocheter le point fantaisie (voir la section', y: 387 },
        { text: '« POINT FANTAISIE »). Réaliser 72 (80) 88 (96) br et crocheter le point fantaisie. Crocheter 36', y: 374 },
        { text: '(40) 44 (48) br. Terminer avec une mc.', y: 360 },
      ],
    ]
    const secs = [
      {
        title: 'LE HAUT DU PANTALON',
        steps: [
          { t: 'Tour 1 : Monter {{0}} ml et relier avec une mc.' },
          { t: 'Tour 2-5 : Réaliser 2 ml, {{0}} br, terminer avec une mc.' },
          {
            t: 'Tour 6-29 : Réaliser 2 ml, {{0}} br, crocheter le point fantaisie (voir la section « POINT FANTAISIE »). Réaliser {{1}} br et crocheter le point fantaisie. Crocheter {{2}} br. Terminer avec une mc.',
          },
        ],
      },
    ]
    const { sections: out } = associateImages(secs, [img({ src: X, y: 341.5 })], pages)
    expect(attachedAt(out)).toEqual(['LE HAUT DU PANTALON#2'])
  })

  it('correspondance stricte : le rang de la section active que le texte prolonge (Love for Squares p5)', () => {
    const pages = [
      [
        { text: 'CARRÉ UNI', y: 220 },
        { text: 'Tour 1 (END) : avec 01, faire un cercle magique. En travaillant dans le cercle : 1 ms', y: 162 },
        { text: 'superposée, 2 br, 2 ml, *3 br, 2 ml* rép de * à * 2 fois, mc jusqu’en haut de la ms', y: 149 },
        { text: 'superposée. Tourner de manière à ce que le fil tombe du côté ENV.', y: 135 },
      ],
      [
        { text: 'CARRÉ À DEUX COULEURS', y: 619 },
        { text: 'Tour 2 (ENV) : mc dans l’esp de 2 ml dans l’angle, 1 ml, mc jusqu’en haut de la ms', y: 352 },
        { text: 'superposée. Tourner de manière à ce que fil tombe du côté devant (END),', y: 338 },
      ],
    ]
    const secs = [
      {
        title: 'CARRÉ UNI',
        steps: [
          {
            t: 'Tour 1 (END) : avec 01, faire un cercle magique. En travaillant dans le cercle : 1 ms superposée, 2 br, 2 ml, *3 br, 2 ml* rép de * à * 2 fois, mc jusqu’en haut de la ms superposée. Tourner de manière à ce que le fil tombe du côté ENV.',
          },
        ],
      },
      {
        title: 'CARRÉ À DEUX COULEURS',
        steps: [
          {
            t: 'Tour 2 (ENV) : mc dans l’esp de 2 ml dans l’angle, 1 ml, mc jusqu’en haut de la ms superposée. Tourner de manière à ce que fil tombe du côté devant (END),',
          },
        ],
      },
    ]
    const { sections: out } = associateImages(secs, [img({ src: X, page: 2, y: 334 })], pages)
    expect(attachedAt(out)).toEqual(['CARRÉ À DEUX COULEURS#0'])
  })

  it('correspondance stricte : les chiffres comptent dans la continuité (Hurricane p6)', () => {
    const r9 = '9. Crochet 1 dc cluster. 10. Ch 1. The next cluster is made in the ch-space shown by the needle.'
    const r26 = '26. Crochet 1 dc cluster. 27. Ch 1. The next cluster is made in the ch-space shown by the needle'
    const secs = [{ title: 'Instructions', steps: [{ t: r9 }, { t: r26 }] }]
    const pages = [
      [
        { text: '26. Crochet 1 dc cluster. 27. Ch 1. The next cluster is made in the ch-space', y: 370 },
        { text: 'shown by the needle', y: 356 },
      ],
    ]
    const { sections: out } = associateImages(secs, [img({ src: X, y: 339 })], pages)
    expect(attachedAt(out)).toEqual(['Instructions#1'])
  })

  it('texte identique dans deux sections : la section active départage', () => {
    const line = 'Répéter les rangs 1 à 10 encore une fois.'
    const secs = [
      { title: 'DOS', steps: [{ t: line }] },
      { title: 'DEVANT', steps: [{ t: line }] },
    ]
    const pages = [[{ text: 'DOS', y: 800 }, { text: line, y: 700 }, { text: 'DEVANT', y: 400 }, { text: line, y: 300 }]]
    const { sections: out } = associateImages(secs, [img({ src: X, y: 280 })], pages)
    expect(attachedAt(out)).toEqual(['DEVANT#0'])
  })

  it('sans titre localisé ni texte discriminant : le premier rang en ordre du document', () => {
    const line = 'Répéter les rangs 1 à 10 encore une fois.'
    const secs = [
      { title: 'DOS', steps: [{ t: line }] },
      { title: 'DEVANT', steps: [{ t: line }] },
    ]
    const { sections: out } = associateImages(secs, [img({ src: X, y: 280 })], [[{ text: line, y: 300 }]])
    expect(attachedAt(out)).toEqual(['DOS#0'])
  })
})

// Passe 3 : une image que le texte juste au-dessus ne rattache pas va sous l'étape qui la précède en ordre de lecture.
describe('associateImages : placement par position de lecture', () => {
  const A = 'data:image/png;base64,A'
  const B = 'data:image/png;base64,B'
  const attachedAt = (out) =>
    out.flatMap((s, si) => s.steps.map((st, k) => (st.imgs ? `${s.title ?? si}#${k}:${st.imgs.length}` : null))).filter(Boolean)
  const filler = (n, top) => Array.from({ length: n }, (_, i) => ({ text: `Ligne de remplissage du glossaire ${i}`, y: top - i * 8 }))

  it('image en haut de page : sous l’étape qui finit la page précédente, section sans titre comprise', () => {
    const secs = [{ id: 's', steps: [{ t: 'Monter {{0}} mailles et tricoter en côtes.' }, { t: 'Rabattre toutes les mailles souplement.' }] }]
    const pages = [
      [{ text: 'Couverture', y: 800 }],
      [{ text: 'Monter 80 mailles et tricoter en côtes.', y: 200 }],
      [{ text: 'Rabattre toutes les mailles souplement.', y: 300 }],
    ]
    const { sections: out, gallery } = associateImages(secs, [img({ src: A, page: 3, y: 780 })], pages)
    expect(attachedAt(out)).toEqual(['0#0:1'])
    expect(gallery).toEqual([])
  })

  it('page photo sans texte : la remontée franchit la page', () => {
    const secs = [{ title: 'DOS', steps: [{ t: 'Tricoter le dos en jersey sur 40 cm.' }] }]
    const pages = [[{ text: 'Couverture', y: 800 }], [{ text: 'DOS', y: 800 }, { text: 'Tricoter le dos en jersey sur 40 cm.', y: 700 }], []]
    const { sections: out } = associateImages(secs, [img({ src: A, page: 3, y: 700 })], pages)
    expect(attachedAt(out)).toEqual(['DOS#0:1'])
  })

  it('image sous un titre de section : première étape texte de la section, diagramme sauté', () => {
    const secs = [
      { title: 'DOS', steps: [{ t: 'Monter les mailles du dos.' }] },
      { title: 'MANCHES', steps: [{ chart: true }, { t: 'Tricoter {{0}} cm en jersey.' }] },
    ]
    const pages = [
      [{ text: 'DOS', y: 800 }, { text: 'Monter les mailles du dos.', y: 700 }],
      [{ text: 'MANCHES', y: 800 }, { text: 'Tricoter 20 cm en jersey.', y: 400 }],
    ]
    const { sections: out } = associateImages(secs, [img({ src: A, page: 2, y: 760 })], pages)
    expect(attachedAt(out)).toEqual(['MANCHES#1:1'])
  })

  it('titre d’une section faite seulement de diagrammes : on continue de remonter', () => {
    const secs = [
      { title: 'DOS', steps: [{ t: 'Monter les mailles du dos.' }] },
      { title: 'DIAGRAMME', steps: [{ chart: true }] },
    ]
    const pages = [
      [{ text: 'DOS', y: 800 }, { text: 'Monter les mailles du dos.', y: 700 }],
      [{ text: 'DIAGRAMME', y: 800 }],
    ]
    const { sections: out } = associateImages(secs, [img({ src: A, page: 2, y: 760 })], pages)
    expect(attachedAt(out)).toEqual(['DOS#0:1'])
  })

  it('image de la page 1 non rattachée par le texte : reste en galerie (déjà dans la couverture)', () => {
    const secs = [{ title: 'DOS', steps: [{ t: 'Monter les mailles du dos.' }] }]
    const pages = [[{ text: 'Monter les mailles du dos.', y: 700 }]]
    const { sections: out, gallery } = associateImages(secs, [img({ src: A, page: 1, y: 400 })], pages)
    expect(attachedAt(out)).toEqual([])
    expect(gallery).toHaveLength(1)
  })

  it('plus de 80 lignes sans étape reconnue : l’image reste en galerie', () => {
    const secs = [{ title: 'DOS', steps: [{ t: 'Monter les mailles du dos.' }] }]
    const pages = [[{ text: 'Couverture', y: 800 }], [{ text: 'Monter les mailles du dos.', y: 900 }, ...filler(85, 890)]]
    const { sections: out, gallery } = associateImages(secs, [img({ src: A, page: 2, y: 100 })], pages)
    expect(attachedAt(out)).toEqual([])
    expect(gallery).toHaveLength(1)
  })

  it('suite de diagramme sur la page suivante sans texte reconnu : même étape que l’image précédente', () => {
    const secs = [{ title: 'DIAGRAMME A', steps: [{ t: 'Suivre le diagramme A sur toutes les mailles.' }] }]
    const pages = [
      [{ text: 'Couverture', y: 800 }],
      [{ text: 'DIAGRAMME A', y: 800 }, { text: 'Suivre le diagramme A sur toutes les mailles.', y: 780 }],
      filler(85, 800),
    ]
    const imgs = [img({ src: A, page: 2, y: 600 }), img({ src: B, page: 3, y: 50 })]
    const { sections: out, gallery } = associateImages(secs, imgs, pages)
    expect(out[0].steps[0].imgs).toEqual([A, B])
    expect(gallery).toEqual([])
  })

  // Une image rattachée par la passe 1 alimente aussi la série de la page suivante.
  it('image rattachée par la passe 1, puis une image que la passe 3 ne place pas : même étape', () => {
    const secs = [{ title: 'DOS', steps: [{ t: 'Monter les mailles du dos.' }] }]
    const pages = [
      [{ text: 'Couverture', y: 800 }],
      [{ text: 'DOS', y: 800 }, { text: 'Monter les mailles du dos.', y: 700 }],
      filler(85, 890),
    ]
    const imgs = [img({ src: A, page: 2, y: 680 }), img({ src: B, page: 3, y: 100 })]
    const { sections: out, gallery } = associateImages(secs, imgs, pages)
    expect(attachedAt(out)).toEqual(['DOS#0:2'])
    expect(gallery).toEqual([])
  })

  // Un saut de page en arrière ne doit pas prolonger la série d'une image déjà placée plus loin.
  it('image plus loin dans le document puis image sur une page antérieure : la seconde ne prolonge pas la série', () => {
    const secs = [{ title: 'DOS', steps: [{ t: 'Tricoter le dos en jersey sur 40 cm.' }] }]
    const pages = [
      [{ text: 'Couverture', y: 800 }],
      filler(85, 800),
      [{ text: 'DOS', y: 800 }, { text: 'Tricoter le dos en jersey sur 40 cm.', y: 700 }],
      [{ text: 'Rabattre.', y: 300 }],
    ]
    const imgs = [img({ src: A, page: 4, y: 780 }), img({ src: B, page: 2, y: 100 })]
    const { sections: out, gallery } = associateImages(secs, imgs, pages)
    expect(attachedAt(out)).toEqual(['DOS#0:1'])
    expect(gallery).toEqual([{ src: B, page: 2, w: 300, h: 200 }])
  })

  // Deux rangs qui finissent par la même formule : la continuité des lignes au-dessus départage.
  it('deux rangs qui finissent pareil : la continuité des lignes au-dessus départage, pas le premier du document', () => {
    const secs = [
      {
        title: 'CARRÉ',
        steps: [
          { t: 'Tour 1 : faire 3 mailles chainette terminer par 1 ms tourner' },
          { t: 'Tour 2 : faire 5 brides doubles terminer par 1 ms tourner' },
        ],
      },
    ]
    const pages = [
      [{ text: 'Couverture', y: 800 }],
      [
        { text: 'CARRÉ', y: 800 },
        { text: 'faire 5 brides doubles', y: 700 },
        { text: 'terminer par 1 ms tourner', y: 690 },
        { text: 'Note hors sujet, sans rapport avec un rang.', y: 200 },
      ],
    ]
    const { sections: out } = associateImages(secs, [img({ src: A, page: 2, y: 190 })], pages)
    expect(attachedAt(out)).toEqual(['CARRÉ#1:1'])
  })

  // Un titre de section ne se confond pas avec un autre qui ne diffère que par un chiffre.
  it('deux sections dont le titre ne diffère que par un chiffre : la ligne exacte désigne la bonne', () => {
    const secs = [
      { title: 'MOTIF 1', steps: [{ t: 'Suivre le premier motif.' }] },
      { title: 'MOTIF 2', steps: [{ t: 'Suivre le second motif.' }] },
    ]
    const pages = [
      [{ text: 'Couverture', y: 800 }],
      [
        { text: 'MOTIF 1', y: 800 },
        { text: 'Suivre le premier motif.', y: 700 },
        { text: 'MOTIF 2', y: 600 },
      ],
    ]
    const { sections: out } = associateImages(secs, [img({ src: A, page: 2, y: 590 })], pages)
    expect(attachedAt(out)).toEqual(['MOTIF 2#0:1'])
  })

  // Les passes 1 et 2 gardent toujours la priorité sur la passe 3, même si celle-ci désignerait une autre étape.
  it('passes 1 et 2 gardent la priorité sur la position de lecture, même si celle-ci désignerait une autre étape', () => {
    const secs = [{ title: 'DOS', steps: [{ t: 'Monter les mailles du dos.' }, { t: 'Rabattre les mailles restantes.' }] }]
    const pages = [
      [{ text: 'Couverture', y: 800 }],
      [
        { text: 'DOS', y: 800 },
        { text: 'Rabattre les mailles restantes.', y: 750 },
        { text: 'Bas de colonne gauche, sans rapport.', y: 500 },
        { text: 'Monter les mailles du dos.', y: 685 },
      ],
    ]
    const { sections: out } = associateImages(secs, [img({ src: A, page: 2, y: 680 })], pages)
    expect(attachedAt(out)).toEqual(['DOS#0:1'])
  })

  // PLACE_MAX_LINES (80) est une frontière stricte : trouvée à 80 lignes, hors limite à 81.
  it('étape reconnue exactement 80 lignes plus haut : trouvée', () => {
    const secs = [{ title: 'DOS', steps: [{ t: 'Monter les mailles du dos.' }] }]
    const pages = [[{ text: 'Couverture', y: 800 }], [{ text: 'Monter les mailles du dos.', y: 900 }, ...filler(79, 890)]]
    const { sections: out, gallery } = associateImages(secs, [img({ src: A, page: 2, y: 100 })], pages)
    expect(attachedAt(out)).toEqual(['DOS#0:1'])
    expect(gallery).toEqual([])
  })

  it('étape reconnue 81 lignes plus haut : hors limite, reste en galerie', () => {
    const secs = [{ title: 'DOS', steps: [{ t: 'Monter les mailles du dos.' }] }]
    const pages = [[{ text: 'Couverture', y: 800 }], [{ text: 'Monter les mailles du dos.', y: 900 }, ...filler(80, 890)]]
    const { sections: out, gallery } = associateImages(secs, [img({ src: A, page: 2, y: 100 })], pages)
    expect(attachedAt(out)).toEqual([])
    expect(gallery).toHaveLength(1)
  })

  // Une image dont la page dépasse le document ne doit pas être placée par la passe 3, galerie.
  it('image sur une page au-delà du document : pas de placement par position, galerie', () => {
    const secs = [{ title: 'DOS', steps: [{ t: 'Monter les mailles du dos.' }] }]
    const pages = [[{ text: 'Couverture', y: 800 }], [{ text: 'DOS', y: 800 }, { text: 'Monter les mailles du dos.', y: 700 }]]
    const { sections: out, gallery } = associateImages(secs, [img({ src: A, page: 9, y: 400 })], pages)
    expect(attachedAt(out)).toEqual([])
    expect(gallery).toHaveLength(1)
  })

  it('image répétée (logo, en-tête) : pas de placement par position, reste en galerie', () => {
    const secs = [{ title: 'DOS', steps: [{ t: 'Monter les mailles du dos.' }] }]
    const pages = [[{ text: 'Couverture', y: 800 }], [{ text: 'Monter les mailles du dos.', y: 700 }]]
    const { sections: out, gallery } = associateImages(secs, [img({ src: A, page: 2, y: 400, repeated: true })], pages)
    expect(out[0].steps[0].imgs).toBeUndefined()
    expect(gallery).toEqual([{ src: A, page: 2, w: 300, h: 200 }])
  })

  it('région vectorielle qui recouvre une photo de la page : reste en galerie, la photo est placée', () => {
    const secs = [{ title: 'DOS', steps: [{ t: 'Monter les mailles du dos.' }] }]
    // ligne loin au-dessus (> 140 pt) : la passe 1 ne s'applique pas, seule la passe 3 joue
    const pages = [[{ text: 'Couverture', y: 800 }], [{ text: 'Monter les mailles du dos.', y: 900 }]]
    const photo = img({ src: A, page: 2, x: 80, y: 560, w: 200, h: 136 })
    // cadre + légendes autour de la photo : boîte (points) qui l'englobe
    const region = img({ src: B, page: 2, x: 70, y: 580, w: 400, h: 200, kind: 'reference' })
    const { sections: out, gallery } = associateImages(secs, [photo, region], pages)
    expect(out[0].steps[0].imgs).toEqual([A])
    expect(gallery.map((g) => g.src)).toEqual([B])
  })

  it('région vectorielle sans photo sous elle (schéma de mesures) : placée normalement', () => {
    const secs = [{ title: 'DOS', steps: [{ t: 'Monter les mailles du dos.' }] }]
    // ligne loin au-dessus (> 140 pt) : la passe 1 ne s'applique pas, seule la passe 3 joue
    const pages = [[{ text: 'Couverture', y: 800 }], [{ text: 'Monter les mailles du dos.', y: 900 }]]
    const photo = img({ src: A, page: 2, x: 80, y: 300, w: 200, h: 136 })
    const region = img({ src: B, page: 2, x: 70, y: 600, w: 400, h: 200, kind: 'reference' })
    const { sections: out } = associateImages(secs, [photo, region], pages)
    expect(out[0].steps[0].imgs).toEqual([A, B])
  })

  it('image répétée juste sous une ligne qui correspond : la passe 1 ne l’ancre pas non plus', () => {
    const secs = [{ title: 'DOS', steps: [{ t: 'Monter les mailles du dos.' }] }]
    const pages = [[{ text: 'Couverture', y: 800 }], [{ text: 'Monter les mailles du dos.', y: 420 }]]
    const { sections: out, gallery } = associateImages(secs, [img({ src: A, page: 2, y: 400, repeated: true })], pages)
    expect(out[0].steps[0].imgs).toBeUndefined()
    expect(gallery.map((g) => g.src)).toEqual([A])
  })

  it('région posée sur une photo juste sous une ligne qui correspond : la passe 1 ne l’ancre pas, la photo si', () => {
    const secs = [{ title: 'DOS', steps: [{ t: 'Monter les mailles du dos.' }] }]
    const pages = [[{ text: 'Couverture', y: 800 }], [{ text: 'Monter les mailles du dos.', y: 600 }]]
    const photo = img({ src: A, page: 2, x: 80, y: 560, w: 200, h: 136 })
    const region = img({ src: B, page: 2, x: 70, y: 580, w: 400, h: 200, kind: 'reference' })
    const { sections: out, gallery } = associateImages(secs, [photo, region], pages)
    expect(out[0].steps[0].imgs).toEqual([A])
    expect(gallery.map((g) => g.src)).toEqual([B])
  })
})
