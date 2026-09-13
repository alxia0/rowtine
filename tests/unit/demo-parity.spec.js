import { describe, it, expect } from 'vitest'
import { loadDemoContent } from '@/constants/demo'
import { DEMO_SKETCH_BONNET, DEMO_SKETCH_ECHARPE, DEMO_SKETCH_SAC } from '@/constants/demo-visuals'
import { validateReader } from '@/utils/reader'
import { isKind } from '@/utils/section-kinds'

const LANGUES = ['fr', 'en', 'de', 'es']

// Empreinte STRUCTURELLE d'un jeu d'exemples : tout sauf le texte. Deux langues qui
// divergent ici ont un contenu réellement différent, pas seulement traduit — c'est ce
// qu'on veut interdire.
function empreinte(content) {
  return content.patterns.map((p) => ({
    demoId: p.demoId,
    type: p.type,
    category: p.category,
    sizes: p.sizes,
    photos: p.photos.length,
    sizeLabels: p.reader.sizeLabels,
    sections: p.reader.sections.map((s) => ({
      id: s.id,
      kind: s.kind,
      chart: !!s.chart,
      steps: s.steps.map((st) => ({
        note: !!st.note,
        repeat: !!st.repeat,
        chart: !!st.chart,
        counts: (st.c || []).map((x) => (Array.isArray(x) ? x : [x])),
      })),
    })),
  }))
}

describe('parité structurelle des 4 jeux d\'exemples', () => {
  it('les 4 langues sont chargeables', async () => {
    for (const l of LANGUES) await expect(loadDemoContent(l)).resolves.toBeTruthy()
  })

  it('structure identique dans les 4 langues', async () => {
    const ref = empreinte(await loadDemoContent('fr'))
    for (const l of LANGUES.slice(1)) {
      expect(empreinte(await loadDemoContent(l)), `langue ${l}`).toEqual(ref)
    }
  })

  it('aucune phrase laissée telle quelle depuis le français', async () => {
    // Discriminant plus sûr qu'une chasse aux mots-clés (qui ne verrait pas une seule
    // section restée en français au milieu d'un fichier traduit) : une phrase NON
    // traduite est, caractère pour caractère, celle du français. On compare donc toutes
    // les phrases affichables, phrase à phrase.
    //
    // Exception attendue : rien. Aucune phrase de nos exemples n'est identique entre deux
    // langues — même « Tour 1 : » devient « Round 1: » / « Runde 1: » / « Vuelta 1: ».
    const phrases = (content) =>
      content.patterns.flatMap((p) => [
        p.name,
        p.reader.sizeSubLabel || '',
        ...p.reader.sections.flatMap((s) => [s.title, ...s.steps.map((st) => st.t || '')]),
      ]).filter(Boolean)

    const ref = phrases(await loadDemoContent('fr'))
    for (const l of ['en', 'de', 'es']) {
      const autres = phrases(await loadDemoContent(l))
      const identiques = autres.filter((p, i) => p === ref[i])
      expect(identiques, `langue ${l} : phrases restées en français`).toEqual([])
    }
  })

  it('chaque lecteur reste structurellement valide dans chaque langue', async () => {
    for (const l of LANGUES) {
      const { patterns } = await loadDemoContent(l)
      for (const p of patterns) {
        // Même filtrage qu'en tâche C2 : « sizeLabels vide » est attendu pour les deux
        // patrons en taille unique (cf. le commentaire détaillé là-bas).
        const erreurs = validateReader(p.reader).filter((e) => e !== 'sizeLabels vide')
        expect(erreurs, `${l}/${p.demoId}`).toEqual([])
      }
    }
  })

  it('les genres de section restent connus dans chaque langue', async () => {
    for (const l of LANGUES) {
      const { patterns } = await loadDemoContent(l)
      for (const p of patterns) for (const s of p.reader.sections) expect(isKind(s.kind)).toBe(true)
    }
  })

  // L'empreinte structurelle ci-dessus ne compare que le NOMBRE de photos entre langues :
  // permuter DEMO_SKETCH_BONNET et DEMO_SKETCH_SAC dans les quatre fichiers demo/*.js
  // laisserait toute la suite verte, et la bibliothèque montrerait un sac sur la carte
  // « Bonnet Torsade ». Ce test attache chaque photo à SON patron.
  //
  // L'ancrage est `demoId`, l'identifiant STABLE (cf. src/constants/demo/index.js) : le nom
  // affiché est traduit, s'en servir comme clé serait le piège que ce projet s'interdit.
  //
  // On compare par NOM D'EXPORT plutôt qu'en confrontant deux chaînes base64 de ~90 000
  // caractères : la comparaison reste exacte (la table est indexée sur la chaîne ENTIÈRE),
  // mais un échec dit « attendu DEMO_SKETCH_BONNET, reçu DEMO_SKETCH_SAC » au lieu de
  // déverser un diff illisible.
  const NOM_DE_PHOTO = new Map([
    [DEMO_SKETCH_BONNET, 'DEMO_SKETCH_BONNET'],
    [DEMO_SKETCH_ECHARPE, 'DEMO_SKETCH_ECHARPE'],
    [DEMO_SKETCH_SAC, 'DEMO_SKETCH_SAC'],
  ])
  const PHOTO_ATTENDUE = {
    bonnet: 'DEMO_SKETCH_BONNET',
    echarpe: 'DEMO_SKETCH_ECHARPE',
    sac: 'DEMO_SKETCH_SAC',
  }

  it('chaque patron de démonstration porte SA photo, dans les 4 langues', async () => {
    // Trois photos DISTINCTES : sans ça la table ci-dessus s'effondrerait à deux entrées
    // et le test ne discriminerait plus rien.
    expect(NOM_DE_PHOTO.size, 'les trois photos de démonstration doivent différer').toBe(3)

    for (const l of LANGUES) {
      const { patterns } = await loadDemoContent(l)
      const vus = []
      for (const p of patterns) {
        expect(PHOTO_ATTENDUE[p.demoId], `${l} : demoId inconnu « ${p.demoId} »`).toBeDefined()
        expect(NOM_DE_PHOTO.get(p.photos[0]) || '(photo étrangère à demo-visuals)', `${l}/${p.demoId}`).toBe(
          PHOTO_ATTENDUE[p.demoId],
        )
        vus.push(p.demoId)
      }
      // Sans ça, un jeu d'exemples amputé d'un patron passerait la boucle sans rien dire.
      expect(vus.sort(), `langue ${l}`).toEqual(Object.keys(PHOTO_ATTENDUE).sort())
    }
  })

  it('les projets et le patron libre sont renseignés dans chaque langue', async () => {
    for (const l of LANGUES) {
      const { projects, freePattern } = await loadDemoContent(l)
      for (const clé of ['fallbackKnitting', 'fallbackCrochet', 'fallbackNotes']) {
        expect(projects[clé], `${l}.${clé}`).toBeTruthy()
      }
      expect(projects.idea.name).toBeTruthy()
      expect(freePattern.name).toBeTruthy()
      expect(freePattern.sectionTitle).toBeTruthy()
      expect(freePattern.stepText).toBeTruthy()
    }
  })
})
