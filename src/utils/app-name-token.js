// Substitue le marqueur `{app}` par le nom réel de l'app dans un texte long qui vit HORS des
// clés i18n (src/content/*.js — politique de confidentialité, journal des nouveautés). Ces
// fichiers ne peuvent pas appeler `t('app.name')` eux-mêmes (contenu statique importé tel
// quel, sans accès à vue-i18n) : ils portent le marqueur, un composant Vue fait la
// substitution à l'affichage, avec le nom lu depuis la même source unique que partout
// ailleurs (piège n°6 du plan : le nom n'est pas définitif, pas une occurrence en dur de
// plus).
export function withAppName(text, appName) {
  return text.replaceAll('{app}', appName)
}
