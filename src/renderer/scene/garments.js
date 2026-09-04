import { Box3, DoubleSide, Group, MeshStandardMaterial, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DEFAULT_PLACEMENT, PRINT_AREAS, SHIRTS } from './shirts.js'
import { paintFabric, printStretch } from './fabric.js'

/**
 * The polo: a modelled shirt, opened at the hem and given usable texture coordinates by
 * scripts/bake-garment.mjs, then fitted to a character and painted here.
 *
 * The fit is a handful of numbers in characters.js rather than anything measured off the
 * body, and deliberately so: the banana is curved, so no axis runs through it, and its
 * torso sits about 0.08 behind the middle of its own bounding box. A garment fitted to a
 * measured surface fought both facts. Numbers tuned against a render is the honest version.
 *
 * The scale is not uniform, in any of the three axes. A tee is tall and narrow; this
 * character is round and squat — which is what a garment made for a body like this would be
 * cut like anyway.
 *
 * The neckline is the shirt's own, and is not placed at all: the modelled neck hole is far
 * narrower than this character's body, so the collar ends up buried inside it and what
 * shows is the yoke running into the body — which is what a neckline looks like.
 */
const POLO_URL = './costumes/polo.glb'

/**
 * How much of the shirt, from the hem up, counts as body rather than sleeve. The bounding
 * box cannot give the body's width — it spans the sleeves, which reach half again as far
 * as the tube they hang from — so the width is read off a band just above the hem.
 */
const HEM_BAND = 0.12

const cloth = (map) =>
  new MeshStandardMaterial({
    map,
    roughness: 0.68,
    metalness: 0.02,
    // Matching the body, whose materials are pinned to 0.9 — a fresh material defaults to
    // 1.0, and a garment lying against the skin is where that difference shows.
    envMapIntensity: 0.9,
    /*
     * Both ends of the shirt are open cuts, so its inside is genuinely visible: up under
     * the hem when the character hops, and through the neck. Front faces alone leave a
     * hole there.
     */
    side: DoubleSide,
  })

/**
 * Loads the shirt once. Kept as a template to clone from, because the rack rebuilds what
 * is worn every time the character changes, and a fetch per rebuild would show.
 */
export const loadPolo = async () => {
  const gltf = await new GLTFLoader().loadAsync(POLO_URL)
  const template = gltf.scene
  template.updateMatrixWorld(true)

  const bounds = new Box3().setFromObject(template)
  const height = bounds.getSize(new Vector3()).y
  if (height <= 0) throw new Error('The polo has no measurable height.')

  template.traverse((child) => {
    if (child.isMesh) child.frustumCulled = false
  })

  return { template, height, bodyRadius: measureBodyRadius({ template, bounds, height }) }
}

/**
 * The half-width of the shirt's body, measured in the same space the bounding box is —
 * which is not the space the vertices are in. Tripo's exporter leaves the whole model
 * under a node scaled to about a fifth, and reading the raw positions instead once put the
 * shirt on at a twentieth of its size, entirely inside the banana. Measuring through the
 * world matrix also means the asset can be re-baked at any scale without a code change.
 */
const measureBodyRadius = ({ template, bounds, height }) => {
  const vertex = new Vector3()
  const centre = bounds.getCenter(new Vector3())
  const ceiling = bounds.min.y + height * HEM_BAND
  let radius = 0

  template.traverse((child) => {
    const positions = child.isMesh ? child.geometry?.attributes?.position : null
    if (!positions) return

    for (let i = 0; i < positions.count; i += 1) {
      vertex.fromBufferAttribute(positions, i).applyMatrix4(child.matrixWorld)
      if (vertex.y > ceiling) continue
      radius = Math.max(radius, Math.hypot(vertex.x - centre.x, vertex.z - centre.z))
    }
  })

  if (radius <= 0) throw new Error('The polo has no measurable body.')
  return radius
}

/** The canvas the shirt is painted on. */


/**
 * One shirt, fitted and painted. `fit` carries the numbers from characters.js, all but the
 * lean as fractions of the character's height: where the hem sits, how tall, how wide and
 * how deep the shirt is, how far forward it stands, and how far back it leans.
 *
 * Width and depth are separate because the shirt's shoulders taper front-to-back the way a
 * person's do and this character's do not taper at all — fitted on one scale, the yoke
 * sinks inside the body and the sleeves read as two loose puffs with a gap between them.
 */
const buildPolo = ({ anchors, fit, polo, look, logo }) => {
  const group = new Group()
  const worn = polo.template.clone(true)
  const map = paintFabric({
    look,
    logo,
    area: PRINT_AREAS[look.placement ?? DEFAULT_PLACEMENT],
    stretch: printStretch(fit),
  })

  worn.traverse((child) => {
    if (child.isMesh) child.material = cloth(map)
  })

  const tall = (fit.height * anchors.height) / polo.height
  const wide = (fit.width * anchors.height) / polo.bodyRadius
  const deep = (fit.depth * anchors.height) / polo.bodyRadius
  worn.scale.set(wide, tall, deep)
  group.add(worn)

  group.position.set(0, fit.hemY * anchors.height, (fit.z ?? 0) * anchors.height)
  /*
   * Tilted back with the torso, and this is what makes a straight tube fit a curved body
   * at all: the banana's front recedes by about 0.14 of its height between hem and
   * shoulder, so an upright shirt either cuts into the belly or gapes at the neck. The
   * rotation is on the group rather than the mesh so it turns about the hem, where a
   * garment actually hangs from.
   */
  group.rotation.x = fit.lean ?? 0
  return group
}

/**
 * The garments registry, in the same shape as COSTUMES so one rack can wear either. Only
 * the polo exists; every collaboration is a different print on the same shirt rather than
 * a different garment, which is the whole point of having one blank shirt.
 *
 * A character without a `shirt` fit — the cat — wears nothing, because a garment cut for a
 * banana is not a garment for a cat.
 */
export const GARMENTS = Object.freeze(
  Object.fromEntries(
    Object.entries(SHIRTS).map(([id, shirt]) => [
      id,
      {
        label: shirt.label,
        build:
          id === 'none'
            ? null
            : ({ anchors, fit, polo, look, logos }) =>
                fit && polo
                  ? buildPolo({
                      anchors,
                      fit,
                      polo,
                      look,
                      logo: look.logo ? (logos?.[look.logo] ?? null) : null,
                    })
                  : null,
      },
    ]),
  ),
)
