// Registre d'icônes-ligne « maison » de Rowtine.
// Un seul langage de trait : fill=none, stroke=currentColor, épaisseur 1,7, bouts
// arrondis (spec actée sur Accueil/Réglages, étendue partout via <AppIcon>).
// Chaque entrée : { body, vb?, sw? }. viewBox par icône (défaut '0 0 24 24') — permet
// de coller des tracés d'origines différentes sans rescale. Rendu par AppIcon.vue.
//
// Remplace : les emoji couleur (📖 👁 📷 🧵 ✨ ⚠ …) et les glyphes police (✎ ✕ ★ ☰ ▦
// ✓ ▲ ▼ ‹ › ↳) qui cassaient la matière Bento/Clay et faisaient « IA / cheap ».
// Les icônes de section vivent ici sous leur `kind` sémantique (cf. section-kinds.js).

export const ICONS = {
  // ─── Chrome (interface) ──────────────────────────────────────────────────
  close: { body: '<path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"/>' },
  help: { body: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.4 2.4 0 1 1 3.6 2.2c-1 .6-1.5 1.1-1.5 2.3"/><path d="M12 17h.01"/>' },
  edit: {
    body:
      '<path d="M5 19.5 5.7 15 16.5 4.2a1.8 1.8 0 0 1 2.6 0l.7.7a1.8 1.8 0 0 1 0 2.6L9 18.3z"/>' +
      '<path d="M15.4 5.3l3.3 3.3"/>',
  },
  check: { body: '<path d="M5 12.6 9.6 17.2 19 6.4"/>' },
  eye: {
    body:
      '<path d="M2.6 12S6.2 5.8 12 5.8 21.4 12 21.4 12 17.8 18.2 12 18.2 2.6 12 2.6 12z"/>' +
      '<circle cx="12" cy="12" r="2.6"/>',
  },
  book: {
    body:
      '<path d="M12 6.6C10 5.2 6.6 4.9 4.2 5.4v13c2.4-.5 5.8-.2 7.8 1.2 2-1.4 5.4-1.7 7.8-1.2v-13c-2.4-.5-5.8-.2-7.8 1.2z"/>' +
      '<path d="M12 6.6v13"/>',
  },
  camera: {
    body:
      '<rect x="3.2" y="7" width="17.6" height="12.4" rx="2.4"/>' +
      '<path d="M8.4 7 9.7 4.9h4.6L15.6 7"/><circle cx="12" cy="13.4" r="3.2"/>',
  },
  chart: {
    body:
      '<rect x="4.5" y="4.5" width="15" height="15" rx="1.8"/>' +
      '<path d="M4.5 9.5h15M4.5 14.5h15M9.5 4.5v15M14.5 4.5v15"/>',
  },
  ai: {
    body:
      '<path d="M5 19 13.5 10.5"/>' +
      '<path d="M16.5 4l.85 2.15L19.5 7l-2.15.85L16.5 10l-.85-2.15L13.5 7l2.15-.85z" fill="currentColor" stroke="none"/>' +
      '<path d="M7.5 5.2l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z" fill="currentColor" stroke="none"/>',
  },
  warning: { body: '<path d="M12 4.2 21 19.2H3z"/><path d="M12 10v4.2"/><circle cx="12" cy="16.8" r=".2" stroke-width="1.6"/>' },
  star: { body: '<path d="M12 4.2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 9.9l5.4-.8z"/>' },
  starFilled: {
    body: '<path d="M12 4.2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 9.9l5.4-.8z" fill="currentColor"/>',
  },
  list: { body: '<path d="M4.5 7h15M4.5 12h15M4.5 17h15"/>' },
  // Menu « actions » (kebab) : trois points verticaux pleins, motif standard.
  kebab: {
    body:
      '<circle cx="12" cy="5.5" r="1.6" fill="currentColor" stroke="none"/>' +
      '<circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>' +
      '<circle cx="12" cy="18.5" r="1.6" fill="currentColor" stroke="none"/>',
  },
  grid: {
    body:
      '<rect x="4.2" y="4.2" width="6.4" height="6.4" rx="1.4"/><rect x="13.4" y="4.2" width="6.4" height="6.4" rx="1.4"/>' +
      '<rect x="4.2" y="13.4" width="6.4" height="6.4" rx="1.4"/><rect x="13.4" y="13.4" width="6.4" height="6.4" rx="1.4"/>',
  },
  chevronRight: { body: '<path d="M9 5l7 7-7 7"/>' },
  chevronLeft: { body: '<path d="M15 5l-7 7 7 7"/>' },
  chevronUp: { body: '<path d="M5 15l7-7 7 7"/>' },
  chevronDown: { body: '<path d="M5 9l7 7 7-7"/>' },
  resume: { body: '<path d="M7 5.5v6a2 2 0 0 0 2 2h8"/><path d="M14 10.5l3.5 3-3.5 3"/>' },
  // `arrowLeft` remplace ↤ dans le sens de lecture d'un diagramme (21/08/2026) : ce
  // caractère n'est dans AUCUNE police embarquée et tombait en glyphe de repli système.
  // Seul cas des six où le glyphe portait du SENS — la direction se montre, elle ne se
  // dit pas. Les cinq autres sont devenus des mots ou ont simplement disparu.
  arrowLeft: { body: '<path d="M19.5 12H5.5"/><path d="M11.5 6l-6 6 6 6"/>' },
  plus: { body: '<path d="M12 5v14M5 12h14"/>' },
  minus: { body: '<path d="M5 12h14"/>' },
  clock: { body: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>' },
  play: { body: '<path d="M8 5.4v13.2l11-6.6z"/>' },
  pause: { body: '<rect x="7.6" y="5.5" width="3.1" height="13" rx="1"/><rect x="13.3" y="5.5" width="3.1" height="13" rx="1"/>' },
  expand: { body: '<path d="M9 4.5H4.5V9M15 4.5h4.5V9M9 19.5H4.5V15M15 19.5h4.5V15"/>' },
  zoomIn: { body: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l4.5 4.5M8 10.5h5M10.5 8v5"/>' },
  zoomOut: { body: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l4.5 4.5M8 10.5h5"/>' },
  calibrate: { body: '<path d="M4.5 6h15M4.5 18h15M12 9v6M9.8 11.2 12 9l2.2 2.2M9.8 15.8 12 18l2.2-2.2"/>' },
  dragVertical: { body: '<path d="M12 3.5v17M8.5 7 12 3.5 15.5 7M8.5 17 12 20.5 15.5 17"/>' },
  dragHorizontal: { body: '<path d="M3.5 12h17M7 8.5 3.5 12 7 15.5M17 8.5 20.5 12 17 15.5"/>' },
  // Croix à 4 flèches (une par branche) — bouton-mode « Déplacer » de l'assistant de
  // calage radial (glisser n'importe où sur l'image une fois ce mode actif).
  move: { body: '<path d="M12 3.5v17M3.5 12h17M8.5 7 12 3.5 15.5 7M8.5 17 12 20.5 15.5 17M7 8.5 3.5 12 7 15.5M17 8.5 20.5 12 17 15.5"/>' },
  flipHorizontal: { body: '<path d="M4 8h14m0 0-3.5-3.5M18 8l-3.5 3.5M20 16H6m0 0 3.5-3.5M6 16l3.5 3.5"/>' },
  import: {
    body:
      '<path d="M12 4v10"/><path d="M8 10.2 12 14l4-3.8"/>' +
      '<path d="M5 16.5v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"/>',
  },
  // Repère « quitte l'app » (lot du 12/08) : case ouverte en bas-gauche + flèche qui en sort
  // en haut-droite — distincte de `expand` (quatre coins qui s'écartent = plein écran/zoom,
  // sémantique « agrandir SUR PLACE », déjà pris par ReaderChart/ReaderView). Motif standard
  // du web (« external link ») qui ne recopie aucun logo ni marque.
  externalLink: {
    body:
      '<path d="M9 5H6.8A1.8 1.8 0 0 0 5 6.8v10.4A1.8 1.8 0 0 0 6.8 19h10.4a1.8 1.8 0 0 0 1.8-1.8V15"/>' +
      '<path d="M13.5 4.5h6v6"/><path d="M19.2 4.8 10.5 13.5"/>',
  },
  // Partage vers une appli du système (mail, messagerie…) : trois nœuds reliés, motif
  // standard du web (« share »), distinct d'`externalLink` (ouvrir ailleurs, pas diffuser).
  share: {
    body:
      '<circle cx="18" cy="5.5" r="2.2"/><circle cx="6" cy="12" r="2.2"/><circle cx="18" cy="18.5" r="2.2"/>' +
      '<path d="M8 10.6l8-4.4M8 13.4l8 4.4"/>',
  },
  // ─── Barre de l'éditeur de patrons (P4) ──────────────────────────────────
  // Étape = case à cocher (rang à suivre).
  checkbox: { body: '<rect x="4" y="4" width="16" height="16" rx="3.2"/><path d="M8 12.2 11 15.2 16.4 9"/>' },
  // Compteur = marques de comptage (4 barres barrées) — distinct de `close` (croix = supprimer).
  counter: { body: '<path d="M6 6v12M10 6v12M14 6v12"/><path d="M4.5 16.5 15.5 7.5"/>' },
  // Note = mémo à coin corné.
  note: { body: '<path d="M5.5 5h13v9.5L14 19H5.5z"/><path d="M18.5 14.5H14V19"/><path d="M8 10h6M8 13h4"/>' },
  // Texte = un grand T.
  text: { body: '<path d="M6 6.5h12"/><path d="M12 6.5V18"/>' },
  // Image = cadre + soleil + relief.
  image: { body: '<rect x="4" y="5" width="16" height="14" rx="2.2"/><circle cx="9" cy="10" r="1.6"/><path d="M5 17.5 10 12l3.2 3 3-2.4L20 16.5"/>' },

  // ─── Tuiles d'aide-mémoire (par tile.tab) ────────────────────────────────
  'tab-materiel': {
    body:
      '<path d="M4.5 9h15l-1.3 9.1a1 1 0 0 1-1 .9H6.8a1 1 0 0 1-1-.9z"/>' +
      '<path d="M4 9h16M9.2 9 10.6 5M14.8 9 13.4 5"/>',
  },
  'tab-tailles': {
    body: '<path d="M4.5 14.4 14.4 4.5l5.1 5.1-9.9 9.9z"/><path d="M8 8l1.7 1.7M10.7 5.3l1.7 1.7M5.3 10.7l1.7 1.7"/>',
  },
  'tab-tech': {
    body: '<circle cx="12" cy="12" r="8"/><path d="M15.2 8.8 12.8 14.4 8.8 15.2 11.2 9.6z"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
  },
  'tab-abbr': { body: '<path d="M4 17 7 7.5 10 17M5 13.6h4"/><path d="M13.5 9h6M13.5 13h6M13.5 17h4"/>' },
  // Tuile Conseils (ampoule, renvois vers des vidéos de technique).
  'tab-tips': {
    body:
      '<path d="M12 4.8a5.2 5.2 0 0 0-3 9.4c.6.5 1 1.1 1 1.8v.6h4v-.6c0-.7.4-1.3 1-1.8a5.2 5.2 0 0 0-3-9.4z"/>' +
      '<path d="M10.3 19.4h3.4M10.8 21h2.4"/>',
  },
  'tab-sections': {
    body: '<rect x="4.5" y="5" width="15" height="4" rx="1.2"/><rect x="4.5" y="11" width="15" height="4" rx="1.2"/><path d="M4.5 18.5h9"/>',
  },

  // ─── Sections — Vêtement ─────────────────────────────────────────────────
  corps: { body: '<path d="M8 5.2 6 6.6 4.6 9l2.4 1.4V19.5h10V10.4L19.4 9 18 6.6l-2-1.4-2 1.2-2-1.2z"/>' },
  manche: { body: '<path d="M8.5 5h4.2l1.1 6.2-1.4 8.3H8.6L7.3 11.2z"/><path d="M8.6 8.6h3.8"/>' },
  encolure: { body: '<path d="M6 5.6C7.6 10 9.6 12.4 12 12.4S16.4 10 18 5.6"/><path d="M6 5.6 7.8 4.6M18 5.6 16.2 4.6"/>' },
  bordure: { body: '<path d="M6.5 5.5v13M10 5.5v13M14 5.5v13M17.5 5.5v13"/>' },
  accessoires: {
    body:
      '<path d="M5 15c0-4.1 3.1-7.4 7-7.4s7 3.3 7 7.4"/>' +
      '<path d="M4.2 15h15.6a1 1 0 0 1 1 1v1.2a1 1 0 0 1-1 1H4.2a1 1 0 0 1-1-1V16a1 1 0 0 1 1-1z"/>' +
      '<path d="M12 7.6V5.6"/><circle cx="12" cy="4.7" r="1"/>',
  },

  // ─── Sections — Amigurumi ────────────────────────────────────────────────
  tete: {
    body:
      '<circle cx="12" cy="12" r="7.3"/><circle cx="9.6" cy="11" r=".95" fill="currentColor" stroke="none"/>' +
      '<circle cx="14.4" cy="11" r=".95" fill="currentColor" stroke="none"/><path d="M10.1 14.4c1.1 1 2.7 1 3.8 0"/>',
  },
  corpsrond: { body: '<path d="M12 5.2c3.5 0 6 3.6 6 7.6 0 3.7-2.4 6.5-6 6.5s-6-2.8-6-6.5c0-4 2.5-7.6 6-7.6z"/>' },
  membre: { body: '<rect x="9" y="5.4" width="6" height="11.2" rx="3"/><circle cx="12" cy="13.8" r="1.5" fill="currentColor" stroke="none"/>' },
  oreille: {
    body:
      '<path d="M9.5 19c-2-3-3-7.2-2.3-10.7C7.5 6 8.4 5 9.4 5.3c1.2.4 1.6 2.1 1.3 4.3' +
      'M14.5 19c2-3 3-7.2 2.3-10.7C16.5 6 15.6 5 14.6 5.3c-1.2.4-1.6 2.1-1.3 4.3"/>',
  },
  museau: {
    body: '<ellipse cx="12" cy="13.5" rx="6" ry="4.8"/><circle cx="12" cy="12.4" r="1.5" fill="currentColor" stroke="none"/><path d="M12 13.9v1.9"/>',
  },
  queue: { body: '<path d="M16.6 5.4C10 6.4 6 11 5.4 18.6c7.6-.6 12.2-4.6 13.2-13.2z"/><path d="M9 15c2-1 4-3 5.2-5.6"/>' },

  // ─── Sections — Motifs & technique ───────────────────────────────────────
  motif: { body: '<path d="M5 12c0-2.5 2-4.5 4.5-4.5S14 9.5 14 12s2 4.5 4.5 4.5"/><path d="M5 12c0 2.5 2 4.5 4.5 4.5"/>' },
  dentelle: {
    body:
      '<circle cx="7.6" cy="8" r="1.15"/><circle cx="12" cy="8" r="1.15"/><circle cx="16.4" cy="8" r="1.15"/>' +
      '<circle cx="9.8" cy="11.6" r="1.15"/><circle cx="14.2" cy="11.6" r="1.15"/>' +
      '<path d="M4.6 15.4a1.85 1.85 0 0 0 3.7 0 1.85 1.85 0 0 0 3.7 0 1.85 1.85 0 0 0 3.7 0 1.85 1.85 0 0 0 3.7 0"/>',
  },
  echantillon: { body: '<rect x="5" y="5" width="14" height="14" rx="1.6"/><path d="M5 9.6h2M5 14.4h2M9.6 5v2M14.4 5v2"/>' },
  diagramme: {
    body:
      '<rect x="4.5" y="4.5" width="15" height="15" rx="1.8"/>' +
      '<path d="M4.5 9.5h15M4.5 14.5h15M9.5 4.5v15M14.5 4.5v15"/>' +
      '<rect x="9.5" y="9.5" width="5" height="5" fill="currentColor" stroke="none" opacity=".18"/>',
  },
  boutonniere: {
    body:
      '<circle cx="12" cy="12" r="7"/><circle cx="10" cy="10" r=".95" fill="currentColor" stroke="none"/>' +
      '<circle cx="14" cy="10" r=".95" fill="currentColor" stroke="none"/><circle cx="10" cy="14" r=".95" fill="currentColor" stroke="none"/>' +
      '<circle cx="14" cy="14" r=".95" fill="currentColor" stroke="none"/>',
  },

  // ─── Outils (Accueil) & divers boutons — viewBox 18x18 d'origine ─────────
  // Widget compteur (rect + flèche haut) — distinct de `counter` (marques de
  // comptage) : gardé sous `counter2`, `counter` étant déjà pris.
  counter2: { vb: '0 0 18 18', body: '<rect x="2.5" y="2.5" width="13" height="13" rx="3"/><path d="M9 5.5v7M6 8l3-2.5L12 8"/>' },
  calculator: { vb: '0 0 18 18', body: '<rect x="2.5" y="2.5" width="13" height="13" rx="3"/><path d="M5.5 6h7M5.5 9h2M9 9h3.5M5.5 12h2M9 12h3.5"/>' },
  needleGauge: {
    vb: '0 0 18 18',
    body:
      '<path d="M3.5 14.5 12 6"/><circle cx="13" cy="5" r="1.1" fill="currentColor" stroke="none"/>' +
      '<path d="M6 16 14.5 7.5"/><circle cx="15.5" cy="6.5" r="1.1" fill="currentColor" stroke="none"/>',
  },
  trash: { vb: '0 0 18 18', body: '<path d="M3.5 5h11M7 5V3.5h4V5M5 5l.7 9h6.6L13 5"/>' },
  kofiCup: {
    vb: '0 0 18 18',
    body:
      '<path d="M3.5 7h9v3a3 3 0 0 1-3 3H6.5a3 3 0 0 1-3-3V7Z"/>' +
      '<path d="M12.5 8H14a1.5 1.5 0 0 1 0 3h-1.5"/><path d="M6 3.5V5M9 3.5V5"/>',
  },

  // ─── Sections — Accessoire (patron) ──────────────────────────────────────
  fond: { body: '<path d="M5 9.5a7 7 0 0 0 14 0"/><path d="M5 9.5V16M19 9.5V16"/>' },
  rabat: {
    body:
      '<rect x="5" y="10" width="14" height="9" rx="1.6"/>' +
      '<path d="M5 10.6 12 15.4 19 10.6"/>',
  },
  poignee: {
    body:
      '<path d="M8.4 10V7.6a3.6 3.6 0 0 1 7.2 0V10"/>' +
      '<rect x="5.6" y="10" width="12.8" height="9" rx="1.6"/>',
  },
  bandouliere: {
    body:
      '<rect x="8.4" y="13.6" width="8" height="6.4" rx="1.3"/>' +
      '<path d="M6 4.6 16.6 13.6"/>',
  },
  anse: {
    body:
      '<rect x="4.6" y="6.6" width="10.4" height="12.8" rx="1.8"/>' +
      '<path d="M15 10a3.4 3.4 0 0 1 0 5.6"/>',
  },
  doublure: {
    body:
      '<rect x="4.6" y="4.6" width="12" height="15" rx="2"/>' +
      '<rect x="7.4" y="7.4" width="12" height="15" rx="2"/>',
  },
  poche: {
    body:
      '<path d="M5.4 8.6 7.8 5.4h8.4l2.4 3.2"/>' +
      '<rect x="5.4" y="8.6" width="13.2" height="10.4" rx="1.5"/>',
  },

  // ─── Sections — Transversal ──────────────────────────────────────────────
  finitions: {
    body:
      '<path d="M5 19 15.5 8.5"/><ellipse cx="16.7" cy="7.3" rx="1.5" ry="2.4" transform="rotate(45 16.7 7.3)"/>' +
      '<path d="M6.2 17.8c-1.4 1-1.9 2.4-.9 3.2"/>',
  },
  // Bulle de conseil + deux lignes de texte (un arbitrage : rubriques de
  // service/conseils — distincte de `note`, la page cornée des notes de rang).
  infos: {
    body:
      '<path d="M4.6 6.2a1.8 1.8 0 0 1 1.8-1.8h11.2a1.8 1.8 0 0 1 1.8 1.8v8a1.8 1.8 0 0 1-1.8 1.8h-5.6l-4.2 3.6v-3.6h-.4a1.8 1.8 0 0 1-1.8-1.8z"/>' +
      '<path d="M8.6 8.8h6.8M8.6 11.9h4.4"/>',
  },
  autre: { body: '<path d="M4.6 11.7 11.2 5.1h5.9a1.8 1.8 0 0 1 1.8 1.8V13l-6.6 6.6a1.6 1.6 0 0 1-2.3 0L4.6 14a1.6 1.6 0 0 1 0-2.3z"/><circle cx="15" cy="9" r="1.15"/>' },
  pelote: {
    body:
      '<circle cx="12" cy="12" r="7.3"/>' +
      '<path d="M6.2 9.2c3.4 1.6 8.6 4.6 11.4 6.4M8.2 5.4c1.4 3 4.6 8.8 6.2 11.6M17.6 8.3c-2 2.6-6.6 7.2-9.8 9.2"/>',
  },

  // ─── Engagements d'une laine (lot du 05/08/2026) ─────────────────────────
  // Dessinées pour ce lot : n'imitent AUCUN logo officiel — OEKO-TEX, GOTS, PETA et
  // Woolmark sont des marques déposées, et ces icônes désignent les engagements,
  // pas les organismes.
  labelVegan: {
    // Une feuille : le végétal, donc l'absence de matière animale. Tracé écarté —
    // la version « lentille symétrique » (deux arcs en miroir) devient un losange à 16 px,
    // contrôlé visuellement (script d'aperçu). Ici un seul lobe très asymétrique (un bord
    // presque droit, l'autre très bombé) + une courte tige : ça garde une silhouette
    // reconnaissable même réduite, et lisible en feuille en grand.
    body: '<path d="M18 6C8 3 3 9 7 18 11 19 17 15 18 6"/><path d="M7 18l-1.5 2.5"/>',
  },
  labelRecycle: {
    // Deux flèches qui bouclent.
    body: '<path d="M5 10a7 7 0 0111-4"/><path d="M19 14a7 7 0 01-11 4"/><path d="M13 4v3h3"/><path d="M11 20v-3H8"/>',
  },
  labelEthique: {
    // Un cœur : l'engagement envers les animaux et les personnes.
    body: '<path d="M12 20s-7-4.4-7-9.2A3.7 3.7 0 0112 8.4a3.7 3.7 0 017 2.4C19 15.6 12 20 12 20z"/>',
  },
  labelMouton: {
    // Un mouton : le sans-mulesing concerne les moutons mérinos. Tracé écarté —
    // le corps « nuage » à trois bosses fusionnait avec la tête à 16 px (contrôlé
    // visuellement). Ici un corps ovale simple + une tête ronde nettement détachée sur le
    // côté + deux pattes espacées : silhouette « animal à 4 pattes » qui tient à 16 px.
    body: '<ellipse cx="9.5" cy="12.5" rx="6" ry="4.3"/><circle cx="17.5" cy="9.5" r="2.4"/><path d="M7 16.5v3M12.5 16.5v3"/>',
  },

  // ─── Gabarits du badge de partage (onglet Stats du projet, 2026-09-16) ───
  badgeVertical: { body: '<rect x="6" y="3" width="12" height="18" rx="2"/><line x1="8" y1="14" x2="16" y2="14"/>' },
  badgeHorizontal: { body: '<rect x="3" y="6" width="18" height="12" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/>' },
  badgeMinimal: { body: '<rect x="4" y="4" width="16" height="16" rx="2"/><line x1="8" y1="12" x2="16" y2="12"/>' },
  badgeDouble: { body: '<rect x="3" y="5" width="8" height="14" rx="1.5"/><rect x="13" y="5" width="8" height="14" rx="1.5"/>' },

  // ─── Ratios de recadrage (pop-up « Choisir une photo » du badge, 2026-09-17) ───
  ratioSquare: { body: '<rect x="4" y="4" width="16" height="16" rx="1.5"/>' },
  ratioHorizontal: { body: '<rect x="2" y="6" width="20" height="12" rx="1.5"/>' },
  ratioVertical: { body: '<rect x="6" y="2" width="12" height="20" rx="1.5"/>' },
}

// Nom d'icône présent au registre ? (fallback géré par AppIcon → 'pelote').
export function hasIcon(name) {
  return Object.prototype.hasOwnProperty.call(ICONS, name)
}
