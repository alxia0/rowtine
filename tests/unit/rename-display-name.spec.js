// Le nom AFFICHÉ est passé à Rowtine dans les 4 langues le 03/08/2026. À cette date, le
// nom du dossier de sauvegarde était GELÉ à « Tricoche » pour protéger les données déjà
// écrites sur le téléphone de l'utilisatrice — ce test vérifiait alors que les textes du dossier
// gardaient bien « Tricoche » pendant que le reste de l'app basculait sur « Rowtine ».
//
// Ce gel a été levé (décision produit) le 04/08/2026 : il avait pour effet de bord qu'une
// inconnue installant l'app depuis le magasin obtenait un dossier nommé d'après une
// marque morte qu'elle n'a jamais vue. Les deux appareils concernés (le téléphone
// de l'utilisatrice, la tablette d'essai) ont été renommés à la main par `adb`, AVANT toute
// désignation. Le nom de l'app et celui du dossier sont donc désormais LE MÊME MOT :
// la distinction que ce test protégeait n'existe plus.
//
// Le test devient plus simple ET plus strict : plus aucune valeur i18n, dans aucune des
// 4 langues, ne doit contenir « Tricoche » — ce mot n'a plus aucune raison de figurer
// dans un texte affiché. La garde « aucune trace de l'ancien nom » garde toute sa valeur ;
// c'est pourquoi ce fichier n'est pas supprimé.
import { describe, it, expect } from 'vitest'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'
import de from '@/i18n/de.json'
import es from '@/i18n/es.json'

const LOCALES = { fr, en, de, es }

describe('nom affiché : Rowtine partout, plus aucune trace de Tricoche', () => {
  it.each(Object.keys(LOCALES))('app.name vaut Rowtine — %s', (l) => {
    expect(LOCALES[l].app.name).toBe('Rowtine')
  })

  it.each(Object.keys(LOCALES))('aucune valeur i18n ne contient encore « Tricoche » — %s', (l) => {
    const flat = {}
    const walk = (o, p = '') => {
      for (const [k, v] of Object.entries(o)) {
        const key = p ? `${p}.${k}` : k
        if (v && typeof v === 'object') walk(v, key)
        else flat[key] = v
      }
    }
    walk(LOCALES[l])
    const mentions = Object.entries(flat)
      .filter(([, v]) => typeof v === 'string' && v.includes('Tricoche'))
      .map(([k]) => k)
    expect(
      mentions,
      `ces clés portent encore l'ancien nom « Tricoche » : ${mentions.join(', ')}`,
    ).toEqual([])
  })
})
