// Détection de la phrase d'aisance (« ease » / jeu de confort du vêtement) dans le bloc
// mesures d'un patron. Câblée bout en bout dans l'app (meta.js l'émet en front-matter,
// parse.js la relit, ReaderView.vue l'affiche) mais jamais alimentée par le moteur PDF —
// codé en dur à '' dans assemble.js. Périmètre : toute section ref != null (le bloc
// « mesures » d'abord, puis les autres blocs référence — cf. detectEaseHint ci-dessous).
// Ces sections sont TOUTES exclues de `work` (readerSections/corps « pas-à-pas ») —
// toute section ref!=null est écartée par `sections.filter((s) => !s.ref && !s.noise)`
// dans assemble.js — mais le bloc 'mesures' n'a PAS d'autre destination : sans ce filet,
// sa phrase de prose est perdue en silence, quel que soit son contenu (palier 8/8,
// « Picnic - Children's Top » #1, découverte
// SYSTÉMIQUE sur tout le corpus). Élargi au-delà de 'mesures' seul le 19/08 : sur Mia
// Cardigan (EN), « Size guide » et sa phrase atterrissent dans la section « Gauge »
// (ref='echantillon'), pas dans « Sizes » (ref='mesures') — MAIS 'echantillon' (comme
// 'fil', 'aiguilles', 'materiel'…) EST rendu ailleurs dans le corps : extractReference()
// (reference.js:1261) déverse VERBATIM toute ligne non consommée d'une section
// ref==='echantillon' dans `reference.gauge`, que refblocks.js rend en bloc
// « ## Échantillon {gauge} ». Sans consommer explicitement la ligne promue
// (cf. consumeEaseHintLine ci-dessous, appelée par assemble.js avant extractReference()),
// elle survit donc DUPLIQUÉE : une fois dans l'en-tête `ease:`, une fois dans ce bloc.
//
// Vocabulaire fermé, MESURÉ sur le corpus réel (campagne 40 patrons + refs `-ideal.md`
// de l'archive locale) — périmètre linguistique du projet FR/EN/ES/DE uniquement, non inventé :
//  - FR « aisance »                     (nahia-sweater-fr : « … une aisance positive
//                                         entre 15 - 30 cm … »)
//  - EN « ease »                        (umber-cloud-sweater-en : « … 30 cm … of
//                                         positive ease. » ; spring-flora-neck-warmer-en)
//  - ES « holgura »                     (cotton-candy-dot-children-s-sweater-es)
//  - DE « Bewegungsspielraum »          (picnic-children-s-top-de — patron déclencheur
//                                         de ce correctif ; hazy-whisper-sweater-de)
//  - DE « Ease »                        (mountaintop-pullover-de : emprunt anglais
//                                         utilisé tel quel : « … positiven Ease von … »)
//  - DE « anliegend »                   (ellie-summer-top-de : « Das Top ist eng
//                                         anliegend. » — aisance QUALITATIVE, sans
//                                         valeur chiffrée ; le prompt de référence
//                                         définit `ease:` comme « phrase d'aisance »,
//                                         pas comme une valeur numérique obligatoire)
// Ancré sur des frontières de mot (`\b`) : ne matche pas une sous-chaîne accidentelle
// (« increase », « decrease », « release », « please » ne contiennent PAS « ease » sur
// une frontière de mot).
const EASE_RE = /\b(?:aisance|holgura|bewegungsspielraum|anliegend|ease)\b/i

// sections : sortie de segmentSections()+reflowLines() (cf. assemble.js), AVANT tout
// appel à extractReference() — on ne dépend PAS de ce qu'extractReference() consomme ou
// non, seulement du texte reflowé. Cherche la première ligne verbatim qui matche le
// vocabulaire : le bloc 'mesures' a priorité, sinon tout autre bloc référence
// (ref != null). Deux passes : le bloc « mesures » d'abord (place canonique de la
// phrase d'aisance), puis les AUTRES blocs référence. PDF réel Mia Cardigan : « Size
// guide » et sa phrase atterrissent dans la section « Gauge » (ref='echantillon'), qui
// absorbe 33 lignes — le balayage restreint à 'mesures' rendait '' alors que la phrase
// était bien là. Les sections de TRAVAIL (ref === null) restent hors du balayage : une
// consigne de rang peut contenir « ease » sans être une phrase d'aisance. EASE_RE
// (vocabulaire FERMÉ, mesuré sur le corpus) reste le seul garde-fou contre les faux
// positifs — il ne doit PAS être élargi en même temps que ce périmètre.
// Renvoie { line, text } (l'objet ligne EXACT trouvé, et son texte) ou null si aucune
// section référence ne porte la phrase. Fonction interne PURE (ne mute rien) : partagée
// par detectEaseHint (lecture seule) et consumeEaseHintLine (qui, elle, marque
// l'objet renvoyé) pour que les deux ne puissent JAMAIS diverger sur « quelle ligne a
// été promue ».
function scanForEaseLine(sections) {
  const scan = (pred) => {
    for (const sec of sections || []) {
      if (!pred(sec)) continue
      for (const line of sec.lines || []) {
        const t = String(line?.text ?? '').trim()
        if (t && EASE_RE.test(t)) return { line, text: t }
      }
    }
    return null
  }
  return scan((s) => s.ref === 'mesures') || scan((s) => s.ref != null && s.ref !== 'mesures')
}

export function detectEaseHint(sections) {
  return scanForEaseLine(sections)?.text || ''
}

// Marque `consumed` sur l'objet ligne EFFECTIVEMENT promu en `ease:` (le même que
// detectEaseHint aurait trouvé, jamais une autre occurrence coïncidente du même texte
// ailleurs) — pour qu'extractReference() (reference.js:1230, `if (line.consumed)
// continue`) la saute et qu'elle ne ressurgisse pas dupliquée dans le corps (bloc
// « ## Échantillon {gauge} » rendu par refblocks.js à partir de reference.gauge, qui
// dépose VERBATIM toute ligne non consommée d'une section ref==='echantillon' —
// reference.js:1261). À appeler sur les sections REFLOWÉES (après reflowLines), AVANT
// extractReference() : reflowLines COPIE chaque objet ligne (`{ ...l }`, cf. reflow.js
// et le commentaire d'assemble.js sur le bug « section fantôme » de la ligne auteur) —
// marquer un objet PRÉ-reflow serait invisible après coup. Ici, `sections` a déjà été
// reflowé au moment de l'appel (cf. assemble.js) et `extractReference()` reçoit ces
// MÊMES objets : pas de piège de copie. Si detectEaseHint ne trouve rien, ne touche
// STRICTEMENT rien (aucune ligne marquée) — même retour ('') que detectEaseHint.
export function consumeEaseHintLine(sections) {
  const found = scanForEaseLine(sections)
  if (found) found.line.consumed = true
  return found?.text || ''
}
