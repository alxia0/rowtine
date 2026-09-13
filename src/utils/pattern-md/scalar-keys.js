// Rubriques dont le corps est UN SEUL paragraphe scalaire (gauge/yarn/needles), à
// jonction par saut de ligne en cas de fusion. Module FEUILLE, sans AUCUN import :
// refblocks.js, reference-merge.js et selection-to-reference.js le partagent tous les
// trois, y compris reference-merge.js qui doit rester chargeable par le banc corpus
// (Node) sans dépendre, même transitivement, de '../reader' (via refblocks.js).
// ⚠️ NE PAS confondre avec FREE_TEXT_KEYS de refblocks.js : contenu différent, deux
// usages distincts (cf. commentaire de selection-to-reference.js).
export const SCALAR_TEXT_KEYS = new Set(['gauge', 'yarn', 'needles'])
