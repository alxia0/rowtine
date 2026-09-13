// Générateur EXÉCUTABLE (contrairement à make-vector-pdf.mjs / make-multigrid-pdf.mjs, qui ne
// sont que la doc du script fitz joué UNE FOIS à la main) : `node tests/fixtures/make-vector-title-pdf.mjs`
// écrit RÉELLEMENT les deux PDF ci-dessous, en pilotant PyMuPDF (Python/fitz, dispo sur ce
// poste) via un sous-processus — mêmes primitives de tracé que les fixtures modèles
// (draw_line/draw_rect/insert_text), pdf-lib n'étant pas une dépendance du projet.
//
// 1) vector-title-multigrid.pdf — reprend la géométrie de `vector-multigrid.pdf`
//    (make-multigrid-pdf.mjs, Task pontage phase 2) : 2 grilles vectorielles empilées + un
//    trait de liaison vertical (pont) qui les fusionne en UNE SEULE région dès
//    `clusterPathBoxes` (phase 1 : les opérateurs de tracé ignorent les glyphes, le texte n'y
//    influe donc jamais). La différence est la bande entre les deux grilles : au lieu d'un
//    blanc pur, elle porte une ligne de TITRE (« Diagramme dos »).
//
//    Vérifié par simulation Python fidèle à `computeInkProfile`/`findGutters`/`isGridCell`/
//    `splitRegionGuarded` (src/utils/pdf.js + pdf-import/vector-regions.js), avec les
//    constantes RÉELLES de production (scale=2, gapMin=48px, minLen=80px, inkFloor=1,
//    lineCov=0.5, minLines=4) :
//      - SANS masquage du texte (`maskTextData` désactivé) : l'encre du titre casse
//        le blanc de la bande (44 pt) en deux barres de ~15 pt et ~20 pt, chacune < gapMin
//        (24 pt) → aucune gouttière valide n'y est détectée → la région entière (grille A +
//        bande titre + grille B, 592 px de haut) reste UNE SEULE cellule 'grid' (les colonnes
//        alignées des deux grilles dominent la couverture même incomplète sur la bande) : 1
//        seul crop au lieu de 2, la séparation phase 2 échoue silencieusement.
//      - AVEC masquage (texte peint en blanc avant la projection de densité) : la bande
//        redevient un blanc continu de 44 pt ≥ gapMin → coupure propre → 2 cellules 'grid'
//        distinctes (253 px chacune). C'est ce pontage PAR LE TEXTE que ce fixture éprouve
//        (le pont physique seul, sans titre, est déjà couvert par vector-multigrid.pdf).
//
// 2) vector-legend.pdf — une boîte de LÉGENDE non-grille : un cadre (rectangle) + 2 colonnes
//    de petits symboles (croix) + un libellé texte par symbole. `isGridCell` exige ≥4 lignes
//    ET ≥4 colonnes « pleines » (couvrant ≥50 % de la largeur/hauteur de la boîte) : le cadre
//    n'en fournit que 2+2 (les 4 bords), et les symboles/libellés, localisés, n'atteignent
//    jamais cette couverture → vérifié par la même simulation : rowLines=2, colLines=2 < 4,
//    la boîte reste 'reference', jamais scindée par `splitRegionGuarded` (aucune paire de
//    sous-cellules n'est simultanément grille de part et d'autre d'une gouttière interne).
//
// Run: node tests/fixtures/make-vector-title-pdf.mjs
// Expected: écrit vector-title-multigrid.pdf et vector-legend.pdf dans ce dossier.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT1 = path.join(HERE, 'vector-title-multigrid.pdf')
const OUT2 = path.join(HERE, 'vector-legend.pdf')

const PY = String.raw`
import fitz

def grille(p, x, y, ncols, nrows, step=14):
    w, h = ncols * step, nrows * step
    for i in range(nrows + 1):          # lignes horizontales
        yy = y + i * step
        p.draw_line((x, yy), (x + w, yy))
    for j in range(ncols + 1):          # lignes verticales
        xx = x + j * step
        p.draw_line((xx, y), (xx, y + h))

# --- vector-title-multigrid.pdf ---------------------------------------------------------
d = fitz.open(); p = d.new_page(width=561, height=460)
p.insert_text((60, 40), "Pull titre inter grilles", fontsize=14, fontname="helv")
p.insert_text((60, 60),
              "Corps  Rang 1 endroit  Rang 2 envers  Repeter 8 fois pour former le motif",
              fontsize=10, fontname="helv")
grille(p, 90, 120, 20, 9)                 # grille du haut (fitz y 120 -> 246)
p.insert_text((90, 268), "Diagramme dos", fontsize=10, fontname="helv")  # titre dans la bande
grille(p, 90, 290, 20, 9)                 # grille du bas  (fitz y 290 -> 416)
p.draw_line((80, 120), (80, 416))         # pont : relie physiquement les deux grilles (fusion phase 1)
d.save(r"__OUT1__")

# --- vector-legend.pdf --------------------------------------------------------------------
d2 = fitz.open(); p2 = d2.new_page(width=300, height=380)
p2.insert_text((30, 30), "Legende symboles", fontsize=14, fontname="helv")
p2.insert_text((30, 55),
               "Legende du diagramme  1 maille endroit  2 mailles envers  Repeter le motif selon indication",
               fontsize=10, fontname="helv")
p2.draw_rect(fitz.Rect(30, 90, 270, 340))   # cadre de la légende (2 lignes + 2 colonnes pleines seulement)
labels = ["endroit", "envers", "jete", "diminution", "torsade", "surjet"]
cols = [55, 170]                            # 2 colonnes de symboles
for cx in cols:
    for ri in range(6):
        cy = 120 + ri * 40
        p2.draw_line((cx - 4, cy - 4), (cx + 4, cy + 4))  # symbole = petite croix (2 traits courts)
        p2.draw_line((cx - 4, cy + 4), (cx + 4, cy - 4))
        p2.insert_text((cx + 12, cy + 3), labels[ri], fontsize=8, fontname="helv")
d2.save(r"__OUT2__")
`

const script = PY.replace('__OUT1__', OUT1).replace('__OUT2__', OUT2)

execFileSync('python3', ['-c', script], { stdio: 'inherit' })
console.log(`écrit : ${OUT1}`)
console.log(`écrit : ${OUT2}`)
