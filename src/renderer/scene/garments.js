import { Box3, CanvasTexture, DoubleSide, Group, MeshStandardMaterial, SRGBColorSpace, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DEFAULT_PLACEMENT, PRINT_AREAS, SHIRTS } from './shirts.js'

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
 * The canvas the shirt is painted on. Square for convenience only — a square on this canvas
 * is emphatically not a square on the shirt, which is what `printStretch` is for.
 */
const TEXTURE_SIZE = 1024

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

/**
 * Paints the shirt's surface: the fabric colour, then the logo inside its print area,
 * scaled to fit and centred so it keeps its own proportions once it is on the fabric — the
 * one thing a brand will not forgive. The rack disposes the texture when the shirt comes
 * off.
 */
export const paintShirt = ({ shirt, logo, stretch }) => {
  const canvas = document.createElement('canvas')
  canvas.width = TEXTURE_SIZE
  canvas.height = TEXTURE_SIZE
  const context = canvas.getContext('2d')

  context.fillStyle = shirt.color ?? '#f4f4f5'
  context.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE)

  if (logo) {
    const area = PRINT_AREAS[shirt.placement] ?? PRINT_AREAS[DEFAULT_PLACEMENT]
    /*
     * The print box is square on the fabric, which makes it tall and thin on the canvas:
     * `stretch` is how much further one step of u travels than one step of v, and it has
     * to be undone here or a logo reaches the shirt as a horizontal smear.
     */
    const width = area.size * TEXTURE_SIZE
    const height = width * stretch
    const scale = Math.min(width / logo.width, height / (logo.height * stretch))

    context.drawImage(
      logo,
      area.u * TEXTURE_SIZE - (logo.width * scale) / 2,
      // v runs up the shirt, a canvas runs down.
      (1 - area.v) * TEXTURE_SIZE - (logo.height * scale * stretch) / 2,
      logo.width * scale,
      logo.height * scale * stretch,
    )
  }

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/**
 * How much further one step of `u` travels across the fitted shirt than one step of `v`:
 * `u` wraps the whole circumference, `v` covers the height, and this shirt is far wider
 * around than it is tall. Everything drawn on it has to be stretched by this or it arrives
 * squashed — a square logo came out as a four-to-one streak before this existed.
 */
const printStretch = (fit) => (2 * Math.PI * fit.width) / fit.height

/**
 * One shirt, fitted and painted. `fit` carries the numbers from characters.js, all but the
 * lean as fractions of the character's height: where the hem sits, how tall, how wide and
 * how deep the shirt is, how far forward it stands, and how far back it leans.
 *
 * Width and depth are separate because the shirt's shoulders taper front-to-back the way a
 * person's do and this character's do not taper at all — fitted on one scale, the yoke
 * sinks inside the body and the sleeves read as two loose puffs with a gap between them.
 */
const buildPolo = ({ anchors, fit, polo, shirt, logo }) => {
  const group = new Group()
  const worn = polo.template.clone(true)
  const map = paintShirt({ shirt, logo, stretch: printStretch(fit) })

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
 * Fetches the collaboration logos once at boot, so painting a shirt stays synchronous. A
 * logo that will not load is reported and skipped — the shirt then wears plain, which is a
 * better failure than no shirt.
 */
export const loadShirtLogos = async (files) => {
  const entries = await Promise.all(
    files.map(async (file) => {
      try {
        const image = new Image()
        image.src = `./shirt/${file}`
        await image.decode()
        return [file, image]
      } catch (error) {
        console.warn(`[shirt] logo "${file}" could not be loaded:`, error.message)
        return null
      }
    }),
  )
  return Object.fromEntries(entries.filter(Boolean))
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
            : ({ anchors, fit, polo, logos }) =>
                fit && polo
                  ? buildPolo({ anchors, fit, polo, shirt, logo: logos?.[shirt.logo] ?? null })
                  : null,
      },
    ]),
  ),
)
