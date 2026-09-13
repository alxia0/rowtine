// Cartes exemple ÉPHÉMÈRES des écrans vides (stock laines / bibliothèque) : affichées
// UNIQUEMENT quand la liste réelle est à 0, jamais enregistrées en base, donc ne
// faussent aucun total. Les parties non traduisibles (marque, modèle, nombres) vivent
// ici ; les libellés traduits (badge « Exemple », nom de couleur, nom du patron,
// accroche) passent par i18n dans le composant/vue.
export const EXAMPLE_YARN = {
  brand: 'DROPS',
  model: 'Baby Merino',
  color: 'hsl(205 55% 74%)', // bleu ciel (format palette hsl)
  lengthM: 175,
  grams: 50,
  quantity: 5,
}
export const EXAMPLE_PATTERN = {
  type: 'knitting',
  sizes: ['S', 'M', 'L'],
}
