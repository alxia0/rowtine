// LES SECTIONS DU GUIDE VISÉES DEPUIS L'APPLICATION (lot du 19/08/2026).
//
// ⚠️ Les identifiants du guide sont POSITIONNELS (`section-0`, `section-1`…), jamais dérivés
// du titre — c'est une décision, expliquée dans `parse-guide-markdown.js` : un identifiant
// tiré du titre a déjà mordu le projet une fois (traduire un titre effaçait la progression
// liée à son identifiant). Un identifiant positionnel a l'immense avantage d'être le même
// dans les quatre langues.
//
// Son défaut : il GLISSE si une section est insérée avant lui — et le rang numéroté dans le
// titre (« 4. ») glisse AVEC lui : le guide renumérote toute sa suite quand une section
// s'insère avant, donc la nouvelle section en position 4 s'appelle aussi « 4. quelque chose ».
// Vérifier seulement le rang serait donc aveugle par construction. C'est pourquoi
// `tests/unit/guide-section-cible.spec.js` vérifie, dans les QUATRE langues, à la fois le rang
// ET qu'un mot propre à la bibliothèque de patrons apparaît dans le titre (une table dédiée,
// un mot par langue — sans cognate commun, l'allemand « Anleitungen » n'a aucun rapport
// visible avec « bibliothèque »). Ajouter ou déplacer une section fera donc rougir ce test
// dans la langue concernée — c'est voulu : il faudra corriger la constante ici.
// ⚠️ MAIS CE N'EST PAS LE SEUL MOTIF DE ROUGE, et corriger ici serait alors une erreur : une
// simple RETRADUCTION du titre, sans le moindre déplacement, fait rougir la même assertion.
// C'est la table des mots-clés du test (`MOT_BIBLIOTHEQUE`) qu'il faut alors mettre à jour —
// la constante ci-dessous reste juste, la cible n'a pas bougé.
export const GUIDE_SECTION_BIBLIOTHEQUE = 'section-4'
