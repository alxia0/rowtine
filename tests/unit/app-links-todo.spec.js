// Rappel actif à l'origine : ni l'adresse de contact ni le domaine du site n'étaient connus
// au 02/08 (piège n°6). `src/constants/app-links.js` les
// laissait délibérément vides pour que l'écran À propos ne rende pas de bloc vide à
// l'utilisatrice. Les DEUX valeurs sont désormais renseignées (contact le 05/08, site le
// 12/08) : ce fichier documente comment chacune y est arrivée.
//
// `it.fails` : chaque test ci-dessous restait VERT tant que sa valeur restait vide (l'échec
// de l'assertion `not.toBe('')` était attendu). Le jour où l'une des deux valeurs a été
// renseignée, l'assertion se mettait à RÉUSSIR — et `it.fails` transformait alors ce succès en
// ÉCHEC du test, ce qui forçait à revenir ici et à remplacer l'assertion par une vraie
// vérification de format (adresse mail, URL http(s)) plutôt que de simplement supprimer le
// rappel. Sans ce mécanisme, un oubli serait resté invisible jusqu'à la publication.
import { describe, it, expect } from 'vitest'
import { CONTACT_EMAIL, WEBSITE_URLS } from '@/constants/app-links'

// 05/08/2026 — l'adresse de contact est ARRIVÉE (`contact@rowtine.app`, fournie en interne).
// Le mécanisme décrit ci-dessus a fonctionné comme prévu : l'`it.fails` est passé au rouge le
// jour où la valeur a cessé d'être vide, ce qui a forcé à revenir ici. Conformément à ce qui
// était annoncé, le rappel n'est pas supprimé mais REMPLACÉ par une vraie vérification de
// format — une adresse mal formée (espace, accolade de gabarit non substituée, virgule à la
// place du point) produirait un lien `mailto:` que le téléphone n'ouvrirait pas, et rien
// d'autre dans la suite ne regarde cette valeur.
describe('emplacements à renseigner AVANT toute diffusion sur les stores', () => {
  it("l'adresse de contact est renseignée et bien formée", () => {
    expect(CONTACT_EMAIL).not.toBe('')
    // Volontairement strict plutôt qu'exhaustif : on ne cherche pas à valider la RFC 5322,
    // seulement à interdire ce qui casserait un `mailto:` (espace, chevrons, virgule) et à
    // exiger un domaine avec extension.
    expect(CONTACT_EMAIL).toMatch(/^[^\s<>,@]+@[^\s<>,@]+\.[a-z]{2,}$/i)
  })

  // 12/08/2026 — le domaine du SITE est ARRIVÉ (exigence « lien guide site »). Le
  // mécanisme décrit ci-dessus a fonctionné comme prévu : lancer la suite juste après avoir
  // renseigné le domaine dans app-links.js a fait passer cet `it.fails` au rouge
  // (« Error: Expect test to fail », l'assertion `not.toBe('')` s'étant mise à réussir).
  // Conformément à ce qui était annoncé, le rappel n'est pas supprimé mais REMPLACÉ par une
  // vraie vérification de format.
  //
  // Le même jour, `WEBSITE_URL` (une seule adresse) est devenue `WEBSITE_URLS` (une table par
  // langue) : le site redirigeait selon la langue du NAVIGATEUR plutôt que celle de l'app
  // (exigence « adresse du site suit la langue de l'app »). Ce rappel balaie donc
  // maintenant les 4 langues plutôt qu'une valeur unique — une seule qui redeviendrait vide
  // ferait rougir la première assertion de son tour de boucle, une valeur mal formée
  // (schéma manquant, `http://` non sécurisé) ferait rougir la seconde. Les adresses EXACTES
  // sont vérifiées ailleurs (tests/unit/app-links.spec.js, à chaînes littérales) : ce test-ci
  // ne fait que garantir qu'aucune des 4 ne redevient vide ou mal formée.
  it('le domaine du site est renseigné pour les 4 langues, et chacune est une URL https://', () => {
    for (const locale of ['fr', 'en', 'de', 'es']) {
      expect(WEBSITE_URLS[locale]).not.toBe('')
      expect(WEBSITE_URLS[locale]).toMatch(/^https:\/\//)
    }
  })
})
