// Binding du plugin natif RowtineSaf (Android, SAF). Sur le web (dev/test),
// registerPlugin renvoie un proxy dont les appels rejettent « not implemented ».
// Seul plugin de stockage (le plugin MANAGE a été retiré).
import { registerPlugin } from '@capacitor/core'

export const RowtineSaf = registerPlugin('RowtineSaf')
