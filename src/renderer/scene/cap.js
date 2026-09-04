import {
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  SphereGeometry,
} from 'three'
import { paintFabric, printStretch } from './fabric.js'

/**
 * A cap, and the only thing here that a brand's logo can properly land on.
 *
 * The shirt is a modelled garment, which is why its print is stuck at 37 pixels on a chest
 * that curves away and is half hidden by arms. This is built from primitives instead, and
 * that changes what is possible rather than just how it is made:
 *
 *   - its texture coordinates are assigned here, so a print goes exactly where it is put,
 *     instead of being scattered across a photogrammetry atlas;
 *   - the crown is a material, so a colour or a pattern costs nothing;
 *   - it seats itself from measured anchors like every other hat, so the cat wears it too —
 *     the shirt is cut for a banana and never will fit one.
 *
 * A cap front is also simply a better billboard: it faces the camera, sits at the top of
 * the silhouette where the eye already is, and nothing overlaps it.
 */

/** How wide the crown is against the head it grips. A cap hugs; it does not perch. */
const GRIP = 0.92

/** Crown height as a fraction of its radius. A full hemisphere reads as a helmet. */
const CROWN_RISE = 0.98

/** The peak, as fractions of the crown radius: how far it reaches, how thick, how high. */
const PEAK_REACH = 1.2
const PEAK_THICKNESS = 0.1
const PEAK_LIFT = 0.04

/** How far the peak tips down from horizontal, in radians. Flat reads as a sun visor. */
const PEAK_TILT = 0.34

/** How far the peak's front edge must clear the eyes, as a fraction of the crown radius. */
const BROW_CLEARANCE = 0.12

/**
 * How far round the front the peak sweeps, in radians. A full half turn puts a wing out to
 * either side of the head and reads as a sun hat; a cap's peak is a tongue over the face.
 */
const PEAK_SWEEP = 1.9

/**
 * Where a design goes on the crown: `u` around the cap with 0.5 dead centre front, `v` up
 * from the brim, and 2.2 times wider than tall — the same coordinates the shirt's print
 * areas use, plus the aspect a cap actually needs.
 *
 * This comes out 37 x 17 pixels on screen, which is worth being straight about: it is the
 * same width as the shirt's chest panel and under half the height, so the cap is not the
 * bigger surface. It is the better one. The crown front stands nearly vertical and faces
 * the camera, where the chest curves away and has arms either side of it; it sits at eye
 * level in the silhouette; and it fits both characters, which the shirt never will. A
 * wordmark belongs here and a round mark belongs on the chest.
 *
 * Both numbers were set by rendering a wordmark at several heights: below about 0.4 the
 * peak eats the print, and the panel stops facing the camera above about 0.7.
 */
export const CAP_PRINT = Object.freeze({ u: 0.5, v: 0.48, size: 0.2, aspect: 2.2 })

/** The canvas the crown is painted on. */
const TEXTURE_SIZE = 1024

/**
 * Cylindrical texture coordinates, replacing the sphere's own.
 *
 * A sphere's default UVs bunch hard towards the pole, so a logo placed near the top of the
 * crown would stretch into a fan. Projecting from the axis instead gives the same honest
 * mapping the polo bake produces — u around, v up — so one set of print coordinates and
 * one stretch correction serve both the cap and the shirt.
 */
const projectCylindrical = (geometry) => {
  const position = geometry.attributes.position
  const uv = geometry.attributes.uv
  let top = 0
  for (let i = 0; i < position.count; i += 1) top = Math.max(top, position.getY(i))
  if (top <= 0) return

  for (let i = 0; i < position.count; i += 1) {
    const angle = Math.atan2(position.getX(i), position.getZ(i))
    uv.setXY(i, 0.5 + angle / (Math.PI * 2), position.getY(i) / top)
  }
  uv.needsUpdate = true
}

const cloth = (map, color) =>
  new MeshStandardMaterial({
    map: map ?? null,
    color: map ? 0xffffff : color,
    roughness: 0.66,
    metalness: 0.02,
    // Matching the body's materials, which are pinned to 0.9 rather than the 1.0 default.
    envMapIntensity: 0.9,
  })

/**
 * One cap, seated and painted. `look` is a colour, an optional pattern and an optional
 * logo — see looks.js; the same look paints the shirt, which is what makes the two read as
 * one outfit rather than two separate choices.
 */
export const buildCap = ({ anchors, look, logos }) => {
  const group = new Group()
  const radius = anchors.sideX * GRIP
  const rise = radius * CROWN_RISE

  const crownGeometry = new SphereGeometry(radius, 30, 18, 0, Math.PI * 2, 0, Math.PI / 2)
  // Squashed after the fact rather than by scaling the mesh, so the projected texture
  // coordinates below are computed against the shape that is actually drawn.
  crownGeometry.scale(1, CROWN_RISE, 1)
  projectCylindrical(crownGeometry)

  const map = paintFabric({
    look,
    logo: look.logo ? (logos?.[look.logo] ?? null) : null,
    area: CAP_PRINT,
    stretch: printStretch({ width: radius, height: rise }),
    // Coarser than the shirt's: a cap crown is about forty pixels across, and a weave
    // counted for a chest arrives on it as noise.
    density: 0.34,
    size: TEXTURE_SIZE,
  })

  const crown = new Mesh(crownGeometry, cloth(map, look.color))
  crown.frustumCulled = false
  group.add(crown)

  /*
   * The peak is a half disc: a cylinder of almost no height, swept through half a turn.
   * Theta starts at a quarter turn so the sweep covers the front — three measures it from
   * +Z towards +X, and a cap's peak belongs over the face.
   */
  const peak = new Mesh(
    new CylinderGeometry(
      radius * PEAK_REACH,
      radius * PEAK_REACH,
      radius * PEAK_THICKNESS,
      26,
      1,
      false,
      -PEAK_SWEEP / 2,
      PEAK_SWEEP,
    ),
    cloth(null, look.brim ?? look.color),
  )
  peak.rotation.x = -PEAK_TILT
  peak.position.y = radius * PEAK_LIFT
  peak.frustumCulled = false
  group.add(peak)

  // A button on the crown, the way a real cap closes its panels. Small, but its absence is
  // what makes a procedural cap look like half a ball.
  const button = new Mesh(
    new SphereGeometry(radius * 0.11, 12, 10),
    cloth(null, look.brim ?? look.color),
  )
  button.position.y = rise
  group.add(button)

  /*
   * Seated at whichever is higher: where a band this wide comes to rest on the head, or
   * the lowest it can sit without the peak covering the eyes.
   *
   * Resting height alone is what every other hat uses, and for a cap it is not enough —
   * the peak reaches forward and tips down, so its front edge ends up well below the band
   * that holds it. Seated by rest alone the peak sat across the banana's eyes and left
   * only its mouth showing, and it blindfolded the cat outright, whose head is 64% wider
   * and whose eyes are higher again. A face is the one thing a hat must not take.
   */
  const droop = radius * (PEAK_REACH * Math.sin(PEAK_TILT) - PEAK_LIFT)
  const clears = anchors.eyeY + radius * BROW_CLEARANCE + droop
  group.position.set(0, Math.max(anchors.ringY(radius) - radius * 0.06, clears), 0)
  return group
}

/** Exported for the tests, which check a cap can be painted without a document. */
export const CAP_TEXTURE_SIZE = TEXTURE_SIZE
export { SRGBColorSpace, CanvasTexture }
