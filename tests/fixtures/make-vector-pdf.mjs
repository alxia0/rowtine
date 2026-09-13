// Fixture PDF vectorielle pour les tests d'extraction de régions.
// pdf-lib n'est PAS une dépendance du projet : la fixture `vector-grid.pdf`
// (committée à côté) a été générée une fois avec PyMuPDF (Python/fitz) :
//
//   python3 - <<'PY'
//   import fitz
//   d = fitz.open(); p = d.new_page(width=595, height=842)
//   for i in range(9):  # grille A (haut)
//       y = 120 + i*18; p.draw_line((120, y), (280, y))
//   for j in range(9):
//       x = 120 + j*20; p.draw_line((x, 120), (x, 264))
//   for i in range(9):  # grille B (bas)
//       y = 520 + i*18; p.draw_line((120, y), (280, y))
//   for j in range(9):
//       x = 120 + j*20; p.draw_line((x, 520), (x, 664))
//   d.save('tests/fixtures/vector-grid.pdf')
//   PY
//
// Deux grilles séparées par un grand blanc vertical → sert aussi à tester
// la séparation en régions distinctes.
export const FIXTURE = 'vector-grid.pdf'
