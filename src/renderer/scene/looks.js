/**
 * What the buddy is wearing, as opposed to which garments it has on. Data only — no
 * three.js — so the menu, the tests and the renderer all read the same wardrobe.
 *
 * One look paints both the cap and the shirt, and that is the whole idea: picking "Cobalt"
 * gets you a cobalt cap and a cobalt shirt, which reads as an outfit rather than as two
 * unrelated choices. It also makes a collaboration one entry instead of two — a brand
 * gets its colour and its logo on the cap, and a matching shirt, from a single line.
 *
 * `color` is the cloth. `accent` is the second colour a pattern uses, and `brim` overrides
 * the cap's peak and button when a look wants them to contrast. `pattern` names one of the
 * weaves in fabric.js. `logo` names a PNG in assets/shirt/, and `placement` picks which of
 * the shirt's print areas it uses there — see the README in that folder for what a design
 * has to be. A logo goes on both garments: the cap's front, which is where it reads, and
 * the shirt's chest.
 *
 * Ids must match LOOK_MENU in src/main/constants.js; test/looks.test.mjs keeps the two
 * honest.
 */
export const LOOKS = Object.freeze({
  cream: Object.freeze({ label: 'Cream', color: '#f4f4f5' }),
  cobalt: Object.freeze({ label: 'Cobalt', color: '#1d4ed8', brim: '#12328f' }),
  forest: Object.freeze({ label: 'Forest', color: '#166534', brim: '#0d4020' }),
  cherry: Object.freeze({ label: 'Cherry', color: '#be123c', brim: '#8b0d2c' }),
  ink: Object.freeze({ label: 'Ink', color: '#1f2430', brim: '#0d1017' }),

  /*
   * The patterned looks. Each names its second colour, because a pattern with one colour
   * is not a pattern — and the accents are picked against the character's own yellow
   * rather than against the cloth alone.
   */
  breton: Object.freeze({
    label: 'Breton',
    color: '#f4f4f5',
    accent: '#1e3a8a',
    pattern: 'stripe',
  }),
  circus: Object.freeze({
    label: 'Circus',
    color: '#fef2f2',
    accent: '#dc2626',
    pattern: 'panel',
    brim: '#dc2626',
  }),
  spots: Object.freeze({
    label: 'Spots',
    color: '#1f2430',
    accent: '#fbbf24',
    pattern: 'dots',
    brim: '#fbbf24',
  }),
  picnic: Object.freeze({
    label: 'Picnic',
    color: '#fefce8',
    accent: '#dc2626',
    pattern: 'check',
  }),
  varsity: Object.freeze({
    label: 'Varsity',
    color: '#1e3a8a',
    accent: '#f8fafc',
    pattern: 'band',
    brim: '#f8fafc',
  }),
})

export const DEFAULT_LOOK = 'cream'

export const isLookId = (id) => Object.hasOwn(LOOKS, id)

/** Anything unknown — a hand-edited settings file, a look that has been retired — falls back. */
export const lookId = (id) => (isLookId(id) ? id : DEFAULT_LOOK)

export const lookIds = () => Object.keys(LOOKS)

/** The logos a session needs to fetch: one per look that names one. */
export const lookLogoFiles = () => [
  ...new Set(
    Object.values(LOOKS)
      .map((look) => look.logo)
      .filter(Boolean),
  ),
]
