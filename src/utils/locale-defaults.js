// Pré-sélection des unités et de la devise d'après la langue de l'appareil, proposée à
// l'écran de bienvenue. PRÉ-SÉLECTION, pas imposition : les deux champs restent visibles et
// modifiables avant validation.
//
// Le pays compte plus que la langue : l'anglais ne veut pas dire impérial. Les Britanniques
// et les Canadiens tricotent en mètres et en grammes — seuls les États-Unis travaillent en
// yards et en onces. Un pays absent de la table (l'Australie par ex.) retombe simplement sur
// le défaut métrique/euro ci-dessous, comme n'importe quel pays non couvert — ce n'est pas
// une affirmation que ce pays tricote en euros, juste l'absence de règle dédiée pour lui.
import { DEFAULT_CURRENCY } from '@/constants/currencies'

const BY_REGION = {
  US: { unitSystem: 'imperial', currency: 'USD' },
  GB: { unitSystem: 'metric', currency: 'GBP' },
  CH: { unitSystem: 'metric', currency: 'CHF' },
  CA: { unitSystem: 'metric', currency: 'CAD' },
}

export function defaultsForLocale(navigatorLanguage) {
  const tag = String(navigatorLanguage || '').replace('_', '-').toUpperCase()
  const region = tag.split('-')[1]
  return BY_REGION[region] || { unitSystem: 'metric', currency: DEFAULT_CURRENCY }
}
