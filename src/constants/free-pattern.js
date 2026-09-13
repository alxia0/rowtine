// « Patron libre vide » — gabarit builtin livré avec l'application, non modifiable,
// sélectionné par défaut à la création d'un projet. Ses trois libellés viennent du jeu
// d'exemples de la langue choisie (src/constants/demo/<langue>.js) : ils étaient en
// français en dur jusqu'au 30/07, y compris pour une utilisatrice allemande.
// Le suivi d'un projet libre se fait via les compteurs de projet (bloc compteurs de
// ProjectDetailView), pas via une étape du reader.
export function buildFreePattern({ name, sectionTitle, stepText }) {
  return {
    name,
    type: 'knitting',
    category: 'other',
    builtin: true,
    sections: [],
    reader: {
      sizeLabels: [],
      sections: [
        {
          id: 'libre',
          kind: 'pelote', // remplace l'emoji '🧶' de l'ancien format
          title: sectionTitle,
          steps: [{ t: stepText, note: true }],
        },
      ],
    },
  }
}
