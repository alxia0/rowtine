// Champs à texte libre de l'onglet Matériel & échantillon. Routage PAR CLÉ I18N STABLE
// (h3Key, posée par buildReference et jamais renommée) en priorité — c'est elle qui fait
// foi, pas le libellé affiché. Repli sur les libellés littéraux — ANCIEN ET NOUVEAU — pour
// les blocs sans h3Key : patrons déjà enregistrés en IndexedDB avant un renommage de
// libellé, et données de démo (sample-pattern-readers.js) qui n'en portent aucun.
// Avant ce routage par h3Key, le champ needles était retrouvé par égalité littérale sur
// 'Aiguilles & matériel' : renommer ce libellé (repli FR dans reader-reference.js) faisait
// disparaître le contenu à la sérialisation MD (perte de données, cf. pattern-md-roundtrip
// .spec.js). Le même piège existe pour gauge/yarn/materials si leur libellé change un jour
// — d'où le même schéma appliqué aux 4 champs, pas seulement à needles.
const MATERIEL_FIELDS = [
  { field: 'gauge', h3Key: 'reader.reference.h3.gauge', labels: ['Échantillon'] },
  { field: 'needles', h3Key: 'reader.reference.h3.needles', labels: ['Aiguilles & matériel', 'Aiguilles', 'Aiguilles/Crochet'] },
  { field: 'yarn', h3Key: 'reader.reference.h3.yarn', labels: ['Fil'] },
  { field: 'materials', h3Key: 'reader.reference.h3.materials', labels: ['Matériel'] },
]

function materielField(b) {
  return MATERIEL_FIELDS.find((f) => b.h3Key === f.h3Key || f.labels.includes(b.h3))?.field || null
}

// Inverse de buildReference : forme construite {abbr, abbrFull, tabs, tiles} →
// forme plate {abbr[], gauge, needles, yarn, materials[], tips[], techniques[], sizeTable[]}.
// L'aller-retour se vérifie sur la forme plate ; les tabs/tiles sont dérivés.
export function referenceToFlat(reference) {
  const flat = { abbr: [], gauge: '', needles: '', yarn: '', materials: [], tips: [], techniques: [], sizeTable: [] }
  for (const tab of reference?.tabs || []) {
    if (tab.id === 'materiel') {
      for (const b of tab.blocks || []) {
        const field = materielField(b)
        if (field === 'materials') flat.materials = [...(b.p || [])]
        else if (field) flat[field] = (b.p || []).join('\n')
      }
    } else if (tab.id === 'tailles') {
      const rows = tab.blocks?.[0]?.sizeTable?.rows || []
      flat.sizeTable = rows.map((r) => ({ label: r.label, values: [...(r.values || [])] }))
    } else if (tab.id === 'tech') {
      flat.techniques = (tab.blocks || []).map((b) => ({ title: b.h3, body: (b.p || []).join('\n') }))
    // Onglet Conseils, sur le modèle de 'tech' juste au-dessus : son PROPRE
    // onglet (pas rattaché à 'materiel'), contenu verbatim (comme materials).
    } else if (tab.id === 'tips') {
      flat.tips = [...(tab.blocks?.[0]?.p || [])]
    }
  }
  flat.abbr = (reference?.abbrFull || []).map(([key, def]) => ({ key, def }))
  return flat
}
