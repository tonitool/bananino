/**
 * What the camera can see, and how to place things inside it. Data and arithmetic only —
 * no three.js — so the build scripts and the tests can read the same numbers the renderer
 * frames its scene with.
 */
export const CAMERA = Object.freeze({
  fov: 28,
  near: 0.1,
  far: 50,
  position: [0, 0.66, 3.8],
  lookAt: [0, 0.54, 0],
})

const distanceToSubject = Math.hypot(
  CAMERA.position[0] - CAMERA.lookAt[0],
  CAMERA.position[1] - CAMERA.lookAt[1],
  CAMERA.position[2] - CAMERA.lookAt[2],
)

/**
 * Half the world the canvas shows, at the depth the character stands. Derived rather than
 * written down, so it follows the camera if that is ever re-framed.
 *
 * The canvas is square and the aspect stays 1 (see character.css), so this is both the
 * horizontal and the vertical half-extent: 0.9479, i.e. 1.8958 units across. The same
 * arithmetic is where `--floor: 0.215` in tokens.css comes from — world y=0 sits
 * (0.9479 - 0.54) / 1.8958 of the way up from the bottom edge.
 *
 * `?zoom=` moves the camera and so changes the real extent, but that flag exists to tighten
 * framing for the app icon, where the character stands alone and no prop is on screen.
 */
export const VISIBLE_HALF_EXTENT = distanceToSubject * Math.tan((CAMERA.fov / 2) * (Math.PI / 180))

/**
 * How much of the frame's edge is left alone, so that a prop placed right at the limit is
 * not sliced by the things this arithmetic cannot see:
 *
 *   - the character's pivot, which the props hang off, swelling to about 1.1 during the
 *     arrival overshoot and breathing while idle — that multiplies their distance out;
 *   - perspective, since the props stand a little in front of the character, which draws
 *     them about 5% larger than their world size suggests;
 *   - the rig's roll and gaze, worth a few more pixels either way.
 *
 * 0.16 covers 1.155x of the clamped outer edge, which is the worst of those combined, and
 * is still loose enough that the banana — the character the reaches were tuned around —
 * never reaches the clamp at all.
 */
const PROP_MARGIN = 0.16

/**
 * Where to stand a prop beside the character: as far out as the character's width asks
 * for, or as far out as the frame allows, whichever is less.
 *
 * `reach` is the multiple of the character's half-width the prop would like to sit at, and
 * `halfExtent` is half the prop's own width — because what gets cut off is a prop's edge,
 * not its centre. Without the second term this was a fixed multiple of a measured body
 * width with no reference to the frame at all, which put the radio 15px outside the canvas
 * as soon as a character wider than the banana arrived.
 *
 * Returns a magnitude; the caller decides which side of the character it stands on.
 */
export const standBeside = ({ sideX, reach, halfExtent }) =>
  Math.min(sideX * reach, VISIBLE_HALF_EXTENT - halfExtent - PROP_MARGIN)
