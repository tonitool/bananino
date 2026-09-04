/**
 * The shirt the buddy can wear, and what is printed on it. Data only — no three.js — so
 * the menu, the tests and the renderer all read the same list.
 *
 * The point of the blank polo is collaborations: a brand hands over a logo, and it should
 * land on the chest correctly without anybody editing 3D code. So a collaboration is one
 * entry here plus one file in assets/shirt/, and nothing else.
 */

/**
 * Where a design may be printed, in the shirt's own texture coordinates.
 *
 * `u` runs around the body — 0.5 is dead centre of the chest, 0 and 1 meet at the middle
 * of the back — and `v` runs up the whole shirt from hem (0) to the top of the collar (1).
 * The chest is therefore the bottom four tenths of `v`: above that is shoulder, sleeve and
 * collar. A logo is scaled to fit inside its box and centred, never stretched to fill it.
 *
 * `size` is how far around the shirt the print may reach, and the box it describes is
 * square on the fabric — so a square logo arrives square. It is one number rather than a
 * width and a height because the two are not interchangeable here: the map wraps a whole
 * circumference into `u` and only the shirt's height into `v`, so a box that looks square
 * in texture coordinates is nothing of the kind on the shirt.
 *
 * These two areas are the contract a collaboration is delivered against, so they are
 * deliberately conservative: both sit well clear of the collar, the hem and the sides,
 * where the fabric turns away from the viewer and a design would foreshorten.
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
export const SHIRTS = Object.freeze({
  none: Object.freeze({ label: 'None' }),
  blank: Object.freeze({
    label: 'Blank polo',
    color: '#f4f4f5',
  }),
})

export const isShirtId = (id) => Object.hasOwn(SHIRTS, id)

export const shirtId = (id) => (isShirtId(id) ? id : 'none')

export const shirtIds = () => Object.keys(SHIRTS)

/** The logos a session needs to fetch: one per collaboration that names one. */
export const shirtLogoFiles = () => [
  ...new Set(
    Object.values(SHIRTS)
      .map((shirt) => shirt.logo)
      .filter(Boolean),
  ),
]
