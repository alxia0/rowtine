// Assemblage de la référence (aide-mémoire) d'un reader depuis une forme PLATE
// { abbr:[{key,def}], gauge, needles, yarn, materials, techniques, sizeTable }.
// Utilisé par l'import local (pdf-import).
// Zéro dépendance : importable sous Node par le banc corpus.
export function buildReference(ref = {}) {
  const abbrList = Array.isArray(ref.abbr) ? ref.abbr.filter((a) => a?.key) : []
  const abbrFull = abbrList.map((a) => [a.key, a.def || ''])
  const abbr = Object.fromEntries(abbrList.map((a) => [a.key, a.def || '']))
  const tabs = []
  const tiles = []

  // Libellés fixes réservés (onglets/tuiles/h3 de vocabulaire, pas contenu du patron) :
  // chaque champ porte, en plus du libellé FR de repli, une clé i18n stable pour
  // localisation À L'AFFICHAGE (voir ReaderSheet.vue/ReaderView.vue). Ce module reste
  // zéro-dépendance : ne PAS importer i18n ici (banc corpus Node).
  const matBlocks = []
  if (ref.gauge) matBlocks.push({ h3: 'Échantillon', h3Key: 'reader.reference.h3.gauge', p: [ref.gauge] })
  if (ref.needles) matBlocks.push({ h3: 'Aiguilles/Crochet', h3Key: 'reader.reference.h3.needles', p: [ref.needles] })
  if (ref.yarn) matBlocks.push({ h3: 'Fil', h3Key: 'reader.reference.h3.yarn', p: [ref.yarn] })
  if (Array.isArray(ref.materials) && ref.materials.length) matBlocks.push({ h3: 'Matériel', h3Key: 'reader.reference.h3.materials', p: ref.materials })
  if (matBlocks.length) {
    tabs.push({ id: 'materiel', label: 'Matériel & échantillon', labelKey: 'reader.reference.materiel.label', blocks: matBlocks })
    tiles.push({ tab: 'materiel', title: 'Matériel & échantillon', titleKey: 'reader.reference.materiel.label', sub: 'Fil, aiguilles, échantillon', subKey: 'reader.reference.materiel.sub' })
  }

  if (Array.isArray(ref.sizeTable) && ref.sizeTable.length) {
    const rows = ref.sizeTable.map((r) => ({ label: r.label, values: r.values || [] }))
    tabs.push({ id: 'tailles', label: 'Tableau des tailles', labelKey: 'reader.reference.tailles.label', blocks: [{ h3: 'Tailles', h3Key: 'reader.reference.h3.sizes', sizeTable: { rows } }] })
    tiles.push({ tab: 'tailles', title: 'Tableau des tailles', titleKey: 'reader.reference.tailles.label', sub: 'Mesures par taille', subKey: 'reader.reference.tailles.sub' })
  }

  // Contenu du patron (langue source) : x.title n'est PAS un libellé réservé → pas de h3Key.
  if (Array.isArray(ref.techniques) && ref.techniques.length) {
    tabs.push({ id: 'tech', label: 'Techniques', labelKey: 'reader.reference.tech.label', blocks: ref.techniques.map((x) => ({ h3: x.title, p: [x.body] })) })
    tiles.push({ tab: 'tech', title: 'Techniques', titleKey: 'reader.reference.tech.label', sub: 'Points & méthodes', subKey: 'reader.reference.tech.sub', feature: true })
  }

  if (abbrFull.length) {
    tabs.push({ id: 'abbr', label: 'Abréviations', labelKey: 'reader.reference.abbr.label', blocks: [{ h3: 'Toutes les abréviations', h3Key: 'reader.reference.h3.allAbbr', abbrFull: true }] })
    tiles.push({ tab: 'abbr', title: 'Abréviations', titleKey: 'reader.reference.abbr.label', sub: 'Le glossaire du patron', subKey: 'reader.reference.abbr.sub' })
  }

  // Bloc « Conseils » : sa PROPRE tuile/onglet (pas rattaché à Matériel &
  // échantillon comme materials), sur le modèle exact de `tech` juste au-dessus —
  // contenu verbatim (pas de titre/corps par entrée, contrairement à techniques).
  // Affiché seulement si non vide (5e tuile, à côté des 4 ci-dessus).
  if (Array.isArray(ref.tips) && ref.tips.length) {
    tabs.push({ id: 'tips', label: 'Conseils', labelKey: 'reader.reference.tips.label', blocks: [{ h3: 'Conseils', h3Key: 'reader.reference.h3.tips', p: ref.tips }] })
    tiles.push({ tab: 'tips', title: 'Conseils', titleKey: 'reader.reference.tips.label', sub: 'Astuces du patron', subKey: 'reader.reference.tips.sub' })
  }

  return { abbr, abbrFull, tiles, tabs }
}
