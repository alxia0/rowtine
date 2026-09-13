// Fixture PDF combinant du texte de patron réel (assez de caractères pour ne PAS être
// classé « scanné » par parsePdfLocally, cf. SCANNED_CHARS_PER_PAGE dans
// utils/pdf-import/index.js) ET deux diagrammes vectoriels (grilles de traits, comme
// `vector-grid.pdf`) séparés par un grand blanc vertical.
//
// Sert au parcours e2e bout-en-bout de l'import offline d'un PDF à diagramme
// vectoriel (import-pdf-vector.spec.js) : `vector-grid.pdf` seul (aucun texte, chars=0)
// est classé « scanné » par l'heuristique et n'atteint donc jamais l'extraction de
// régions vectorielles — d'où cette fixture dédiée, texte + vecteur, pour tester le
// pipeline réel (pdfjs → extractVectorRegions → associateImages) en conditions réalistes.
//
// pdf-lib n'est PAS une dépendance du projet : la fixture `vector-pattern.pdf`
// (committée à côté) a été générée une fois avec PyMuPDF (Python/fitz) :
//
//   python3 - <<'PY'
//   import fitz
//   d = fitz.open(); p = d.new_page(width=595, height=842)
//   # Texte : même structure que « Pull Sabai Test » (déjà éprouvée par le pipeline
//   # complet local) pour garantir un reader.sections non vide.
//   p.insert_text((72, 50), "Pull Vector Test", fontsize=20, fontname="helv")
//   p.insert_text((72, 80), "Corps", fontsize=11, fontname="helv")
//   p.insert_text((72, 98), "Rang 1 : monter 104 (108) 112 m.", fontsize=11, fontname="helv")
//   p.insert_text((72, 114), "Rang 2 : tricoter à l'endroit.", fontsize=11, fontname="helv")
//   p.insert_text((72, 130), "Répéter ce rang 8 (9) 10 fois.", fontsize=11, fontname="helv")
//   # Grille A, loin du texte (marge > gap de clustering des tracés).
//   for i in range(9):
//       y = 200 + i*18; p.draw_line((120, y), (280, y))
//   for j in range(9):
//       x = 120 + j*20; p.draw_line((x, 200), (x, 344))
//   # Grille B, séparée de A par un grand blanc vertical.
//   for i in range(9):
//       y = 500 + i*18; p.draw_line((120, y), (280, y))
//   for j in range(9):
//       x = 120 + j*20; p.draw_line((x, 500), (x, 644))
//   d.save('tests/e2e/fixtures/vector-pattern.pdf')
//   PY
//
// Vérifié manuellement (probe Playwright jetable) : les 2 grilles produisent bien 2
// régions vectorielles distinctes (une ancrée sous une ligne d'instruction → `.stepimgs
// img`, une non ancrée → galerie `.pgal__cell img`).
export const FIXTURE = 'vector-pattern.pdf'
