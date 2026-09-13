import { describe, it, expect } from 'vitest'
import { deduceOrigin, animalFibersIn, canonical, FIBER_ORIGIN } from '@/constants/fiber-origin'

describe('deduceOrigin', () => {
  it('reconnaît une origine unique', () => {
    expect(deduceOrigin(['alpaga']).key).toBe('animale')
    expect(deduceOrigin(['coton']).key).toBe('vegetale')
    expect(deduceOrigin(['acrylique']).key).toBe('synthetique')
  })

  it('reconnaît un mélange de plusieurs origines', () => {
    const r = deduceOrigin(['laine', 'coton'])
    expect(r.key).toBe('melange')
    expect(r.complete).toBe(true)
    expect(r.origins).toEqual(['animale', 'vegetale'])
  })

  it('ignore la casse et les accents', () => {
    // « Mérinos » saisi avec majuscule doit se classer comme « mérinos ».
    expect(deduceOrigin(['Mérinos']).key).toBe('animale')
    expect(deduceOrigin(['MERINOS']).key).toBe('animale')
  })

  it('rend null sur une composition vide — la ligne ne doit pas s’afficher', () => {
    expect(deduceOrigin([]).key).toBeNull()
    expect(deduceOrigin(null).key).toBeNull()
  })

  it('devient incomplet dès qu’UNE SEULE fibre n’est pas classée', () => {
    // « kapok » n'est pas dans le dictionnaire (contrairement à « yak », déjà classé) :
    // c'est bien lui qui doit faire basculer le résultat en incomplet.
    const r = deduceOrigin(['mérinos', 'kapok'])
    expect(r.key).toBe('incomplete')
    expect(r.complete).toBe(false)
  })

  it('couvre les saisies libres fréquentes, pour que « incomplet » reste rare', () => {
    for (const f of ['yak', 'angora', 'chanvre', 'lyocell', 'polyester', 'ramie'])
      expect(deduceOrigin([f]).key, `« ${f} » devrait être classée`).not.toBe('incomplete')
  })

  it('fait gagner la correspondance la PLUS LONGUE, pas la première rencontrée', () => {
    // « soie de bambou » contient à la fois « soie » (4 lettres, animale) et « bambou »
    // (6 lettres, végétale) comme sous-chaînes. La fibre réellement désignée par cette mention
    // d'étiquette est le bambou : c'est « soie de bambou », pas de la soie.
    expect(deduceOrigin(['soie de bambou']).key).toBe('vegetale')
    // Contre-exemple qui ne doit PAS changer : « laine mérinos » reste animale, merinos (7
    // lettres) l'emportant de toute façon sur laine (5 lettres).
    expect(deduceOrigin(['laine mérinos']).key).toBe('animale')
    // « viscose de bambou » est un artificiel cellulosique classé synthétique dans ce
    // dictionnaire (cf. commentaire de FIBER_ORIGIN) : viscose (7 lettres) l'emporte sur
    // bambou (6 lettres).
    expect(deduceOrigin(['viscose de bambou']).key).toBe('synthetique')
  })

  it('découpe une entrée composite pour retrouver TOUTES les fibres qu’elle nomme', () => {
    // Bug de revue : le champ « Autre » de StashView.vue pousse tel quel tout ce qu'une
    // utilisatrice tape en une fois (« 80 % coton, 20 % polyester »), sans le découper. Avant le
    // découpage dans fiber-origin.js, canonical() ne retenait que la correspondance la PLUS
    // LONGUE sur toute la chaîne (« polyester », 9 lettres) et perdait le coton (5 lettres) :
    // le mélange retombait sur une seule origine synthétique au lieu d'un vrai mélange.
    expect(deduceOrigin(['80 % coton, 20 % polyester']).key).toBe('melange')
  })

  it('verrouille la classification des cellulosiques artificiels (viscose, lyocell)', () => {
    // Décision de conception commentée dans le module : viscose/lyocell/tencel/modal/acetate
    // sont des fibres transformées chimiquement, rangées avec les synthétiques et non les
    // végétales. Une assertion sur la VALEUR exacte, pas seulement « n'est pas incomplet »,
    // pour que cette décision tombe si quelqu'un la change par erreur.
    expect(deduceOrigin(['viscose']).key).toBe('synthetique')
    expect(deduceOrigin(['lyocell']).key).toBe('synthetique')
  })

  describe('reconnaît les saisies libres dans les trois langues ajoutées (04 lot i18n)', () => {
    // Un exemple par langue, tel qu'une utilisatrice le taperait réellement dans le champ
    // « Autre » — accents inclus pour DE/ES, l'app doit les gérer via fold().
    it.each([
      ['Baumwolle', 'vegetale'],
      ['cotton', 'vegetale'],
      ['algodón', 'vegetale'],
      ['wool', 'animale'],
      ['Seide', 'animale'],
      ['acrílico', 'synthetique'],
    ])('deduceOrigin([%s]) -> %s', (saisie, origine) => {
      expect(deduceOrigin([saisie]).key).toBe(origine)
    })
  })
})

describe('cohérence du dictionnaire FIBER_ORIGIN', () => {
  // Le test demandé littéralement : pour CHAQUE clé, canonical(clé) doit rendre CETTE CLÉ, pas
  // seulement une clé de même origine. Une clé mal repliée (« Wolle » avec majuscule, un accent
  // oublié) pourrait sinon retomber sur une AUTRE clé de même origine par correspondance de
  // sous-chaîne et faire passer le test à tort — d'où l'égalité sur la clé elle-même, pas sur
  // FIBER_ORIGIN[key]. Comme les clés sont déjà en forme repliée, `canonical()` les retrouve par
  // égalité EXACTE avant même de regarder les sous-chaînes (le court-circuit
  // `if (FIBER_ORIGIN[f]) return f`) : ce test ne peut donc échouer que si une clé n'est PAS
  // correctement repliée — exactement le mécanisme 1 que la consigne demandait de vérifier. Il
  // ne détecte PAS, par construction, une éventuelle captation entre deux clés DIFFÉRENTES :
  // c'est l'objet du test suivant.
  it('chaque clé se retrouve elle-même via canonical() — pas une autre clé', () => {
    for (const key of Object.keys(FIBER_ORIGIN)) {
      expect(canonical(key), `canonical(« ${key} »)`).toBe(key)
    }
  })

  // Le test qui peut réellement échouer sur une captation : pour toute paire de clés (A, B) où
  // A est une sous-chaîne stricte de B, si leurs origines diffèrent, une saisie composite
  // contenant A mais PAS le mot complet B (par ex. un mot composé allemand) risquerait de se
  // faire classer par la mauvaise clé si jamais B ne l'emportait pas. Ici on vérifie surtout
  // que B (le plus long) est toujours bien PLUS long que A, ce qui garantit — vu l'algorithme
  // « la plus longue gagne » de canonical() — que B l'emporte à chaque fois qu'il est présent.
  it('aucune clé plus courte ne capture une clé plus longue d’une AUTRE origine', () => {
    const keys = Object.keys(FIBER_ORIGIN)
    const collisions = []
    for (const short of keys) {
      for (const long of keys) {
        if (short === long) continue
        if (long.includes(short) && short.length < long.length) {
          if (FIBER_ORIGIN[short] !== FIBER_ORIGIN[long]) {
            collisions.push(`« ${short} » (${FIBER_ORIGIN[short]}) ⊂ « ${long} » (${FIBER_ORIGIN[long]})`)
          }
        }
      }
    }
    // Une collision RESTE inoffensive tant que la clé la plus longue (la bonne réponse) est
    // bien la plus longue des deux : « wolle » (animale) ⊂ « baumwolle » (végétale) en est un
    // exemple documenté dans FIBER_ORIGIN — « baumwolle » gagne toujours car plus long.
    // On l'autorise explicitement ici pour ne pas faire échouer ce test sur un cas déjà vérifié
    // et commenté dans le code ; toute NOUVELLE collision doit être examinée avant d'être ajoutée
    // à cette liste blanche.
    const collisionsAttendues = ['« wolle » (animale) ⊂ « baumwolle » (vegetale)']
    expect(collisions).toEqual(collisionsAttendues)
  })

  it('vérifie EN PRATIQUE la collision « wolle »/« baumwolle » plutôt que de la supposer neutre', () => {
    // « wolle » seule (dans un mot composé qui ne contient pas « baumwolle ») doit rester de la
    // laine — le sens réel du mot allemand.
    expect(deduceOrigin(['Schurwolle']).key).toBe('animale')
    // Un composite qui contient les DEUX sous-chaînes (« baumwolle » 9 lettres, « wolle » 5
    // lettres) doit retomber sur la plus longue, donc rester du coton — la règle « la plus
    // longue gagne » de canonical() joue ici en notre faveur.
    expect(deduceOrigin(['Bio-Baumwolle']).key).toBe('vegetale')
  })
})

describe('animalFibersIn — la base de l’avertissement vegan', () => {
  it('rend les fibres animales RECONNUES', () => {
    expect(animalFibersIn(['laine', 'coton'])).toEqual(['laine'])
    expect(animalFibersIn(['mohair', 'soie'])).toEqual(['mohair', 'soie'])
  })

  it('parle même quand une AUTRE fibre est inconnue', () => {
    // Le mérinos est bien là ; l'ignorer parce qu'un « kapok » (non classé) traîne à côté
    // serait passer à côté du seul contrôle du lot.
    expect(animalFibersIn(['mérinos', 'kapok'])).toEqual(['mérinos'])
  })

  it('se tait quand AUCUNE fibre animale n’est reconnue', () => {
    // Accuser sur un mot non reconnu serait faux.
    expect(animalFibersIn(['machinchose'])).toEqual([])
    expect(animalFibersIn(['coton', 'lin'])).toEqual([])
  })

  it('ne se déclenche PAS sur « soie de bambou » — c’est du bambou, pas de la soie', () => {
    // Faux positif vegan trouvé en revue : avant le correctif de correspondance la plus
    // longue, « soie » (sous-chaîne trouvée en premier) faisait accuser cette fibre 100 %
    // végétale d'être animale.
    expect(animalFibersIn(['soie de bambou'])).toEqual([])
  })

  it('trouve la fibre animale dans une entrée composite « fibre/fibre dosage/dosage »', () => {
    // « 80 % laine, 20 % polyamide » (ou son équivalent slash-séparé) est l'étiquette type
    // d'une laine à chaussettes, pas un cas limite. Avant le découpage, canonical() ne
    // retenait que le polyamide (correspondance la plus longue sur toute la chaîne) et cette
    // fonction — la base même de l'avertissement « fibre animale » — restait muette dessus.
    expect(animalFibersIn(['Wolle/Polyamid 80/20'])).toEqual(['Wolle/Polyamid 80/20'])
    expect(animalFibersIn(['laine/polyamide 80/20'])).toEqual(['laine/polyamide 80/20'])
  })
})
