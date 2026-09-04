/**
 * The shirt: whether it is on, and where a design may be printed on it. What it is made
 * of — colour, pattern, logo — comes from the look in looks.js, which dresses the cap at
 * the same time so the two read as one outfit.
 *
 * Data only, no three.js, so the menu, the tests and the renderer all read the same list.
 */

export const PRINT_AREAS = Object.freeze({
  /**
   * The classic polo position, over the wearer's left chest — about 23px on screen, so a
   * simple mark and nothing else. A logo with two elements in it will not survive here.
   */
  'left-chest': Object.freeze({ u: 0.57, v: 0.33, size: 0.1 }),
  /**
   * The chest panel, and the one to use for an actual logo: about 39px on screen, which
   * is where a design stops being a smudge and starts being recognisable.
   *
   * These sizes were set by rendering a design at each of them rather than by taste. At
   * 0.10 a bold star came out as a dark blob and a finely-drawn wordmark was invisible;
   * at 0.22 the print ran off the front of the shirt into the hem and the collar.
   */
  centre: Object.freeze({ u: 0.5, v: 0.3, size: 0.16 }),
})

export const DEFAULT_PLACEMENT = 'left-chest'

/**
 * Every shirt available. `none` is bare; `blank` is the plain polo with nothing printed on
 * it. A collaboration adds an entry beside them:
 *
 *   acme: { label: 'Acme', color: '#1d4ed8', logo: 'acme.png', placement: 'centre' }
 *
 * `color` is the fabric. `logo` names a PNG in assets/shirt/ — transparent background,
 * square-ish, at least 512px on its long edge — and `placement` picks one of the print
 * areas above. Ids must match SHIRT_MENU in src/main/constants.js; test/garments.test.mjs
 * keeps the two honest.
 */
/**
 * Whether the shirt is on. It used to carry a colour and a logo per entry, which meant a
 * collaboration was two entries — one for the shirt and one for the hat — describing the
 * same brand twice. The look does that job now.
 */
export const SHIRTS = Object.freeze({
  none: Object.freeze({ label: 'None' }),
  polo: Object.freeze({ label: 'Polo' }),
})

export const isShirtId = (id) => Object.hasOwn(SHIRTS, id)

export const shirtId = (id) => (isShirtId(id) ? id : 'none')

export const shirtIds = () => Object.keys(SHIRTS)
