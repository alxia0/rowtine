// Fixture PDF vectorielle « multi-grilles » pour prouver la SÉPARATION FINE (phase 2 :
// `splitRegionRaster` dans src/utils/pdf-import/vector-regions.js). Le point clé de
// cette fixture est un « pont » : un trait de liaison vertical relie physiquement les
// deux grilles empilées, si bien que le regroupement par boîtes de tracés
// (`clusterPathBoxes`, phase 1, qui travaille sur la liste d'opérateurs vectoriels)
// les fusionne en UNE SEULE région (le pont enjambe la gouttière). C'est la
// rastérisation + projection de densité d'encre (phase 2) qui rescinde ensuite cette
// région unique en 2 grilles. Obtenir 2 diagrammes en sortie PROUVE donc que le raster
// a bien opéré la séparation (l'operator seul n'en donnait qu'1) — c'est le vrai oracle
// du mécanisme de phase 2. (La séparation X côte-à-côte, elle, reste couverte par le
// test synthétique de `tests/unit/pdf-import-vector-regions.spec.js`.)
//
// pdf-lib n'est PAS une dépendance du projet : la fixture `vector-multigrid.pdf`
// (committée à côté) a été générée une fois avec PyMuPDF (Python/fitz), avec un helper
// `grille(page, x, y, ncols, nrows, step)` qui trace une grille de `ncols`×`nrows`
// cellules (donc ncols+1 lignes verticales et nrows+1 lignes horizontales) de pas
// `step`, ancrée en (x, y) — coordonnées fitz, origine haut-gauche, y vers le bas :
//
//   python3 - <<'PY'
//   import fitz
//   d = fitz.open(); p = d.new_page(width=561, height=808)
//
//   def grille(p, x, y, ncols, nrows, step=14):
//       w, h = ncols * step, nrows * step
//       for i in range(nrows + 1):          # lignes horizontales
//           yy = y + i * step
//           p.draw_line((x, yy), (x + w, yy))
//       for j in range(ncols + 1):          # lignes verticales
//           xx = x + j * step
//           p.draw_line((xx, y), (xx, y + h))
//
//   # Texte (> 50 car/page pour éviter l'heuristique « scanné », cf.
//   # SCANNED_CHARS_PER_PAGE dans utils/pdf-import/index.js). Le titre (plus grand)
//   # devient pattern.name via detectTitle → « Pull test multi-grilles ».
//   p.insert_text((60, 40), "Pull test multi-grilles", fontsize=14, fontname="helv")
//   p.insert_text((60, 60),
//                 "Corps  Rang 1 endroit  Rang 2 envers  Repeter 8 fois pour former le motif",
//                 fontsize=10, fontname="helv")
//
//   # Deux grilles empilées, séparées par une gouttière blanche (fitz y ≈ 246 → 420).
//   grille(p, 90, 120, 20, 9)   # grille du haut  (fitz y 120 → 246)
//   grille(p, 90, 420, 20, 9)   # grille du bas   (fitz y 420 → 546)
//
//   # LE PONT : un trait vertical qui relie physiquement les deux grilles à travers la
//   # gouttière (fitz y 120 → 546, à gauche des grilles en x=80). Sans lui,
//   # `clusterPathBoxes` séparerait déjà les deux grilles (gouttière > gap) et la
//   # phase 2 ne serait pas sollicitée. Avec lui, l'operator fusionne tout en 1 région.
//   p.draw_line((80, 120), (80, 546))
//
//   d.save('tests/fixtures/vector-multigrid.pdf')
//   PY
//
// Vérifié (probe jetable `collectPathBoxes` + `clusterPathBoxes`) sur la fixture réelle :
// 63 tracés → **1 seule région** {x0:80, y0:262, x1:370, y1:688} (coordonnées PDF, y
// vers le haut ; page 808 pt ⇒ pdf_y = 808 − fitz_y). C'est l'état « AVANT » que la
// phase 2 doit rescinder : le test unitaire `tests/unit/pdf-vector-format.spec.js`
// asserte cette fusion en 1 région (sans canvas, via la liste d'opérateurs), et l'e2e
// `tests/e2e/import-pdf-vector.spec.js` asserte les **2** diagrammes en sortie du
// pipeline complet (vrai rendu canvas Chromium — jsdom sous Vitest n'implémente pas
// `getContext('2d')` sans le paquet npm `canvas`, absent du projet, d'où la délégation
// de la preuve raster réelle à l'e2e).
export const FIXTURE = 'vector-multigrid.pdf'
