// Rowtine — résolution du { kind, id } à synchroniser (patron.md ciblé) à
// l'ouverture du Lecteur (Lot N3, cf. `src/backup/sync-on-open.js`).
//
// Le lien projet→patron est STRUCTUREL (une édition du patron.md ne le modifie
// jamais) : un léger pré-chargement du projet/patron (champs structurels
// uniquement, avant toute synchro) suffit à le résoudre en amont du rendu.
//
//  - contexte bibliothèque (aperçu d'un patron) : le patron.md vit dans son
//    propre dossier `Patrons/<patternId>`.
//  - contexte projet, patron FORKÉ (`pattern.ownerProjectId === project.id`,
//    copy-on-write) : le patron.md vit dans le dossier `Projets/<projectId>`
//    (instance dédiée à ce projet).
//  - contexte projet, patron de BIBLIOTHÈQUE partagé (non forké) : le
//    patron.md vit dans le dossier `Patrons/<patternId>` du patron partagé.
//
// Fonction pure : ne touche ni la DB ni le stockage — l'appelant fournit déjà
// le projet/patron pré-chargés. Renvoie `null` quand il n'y a rien à
// synchroniser (patron introuvable/non lié).
export function resolveOpenSyncTarget({ ctx, project, pattern }) {
  if (ctx !== 'project') {
    return pattern?.id != null ? { kind: 'pattern', id: pattern.id } : null
  }
  if (!project || pattern?.id == null) return null
  if (pattern.ownerProjectId === project.id) return { kind: 'project', id: project.id }
  return { kind: 'pattern', id: pattern.id }
}
