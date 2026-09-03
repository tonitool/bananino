import { Group, Mesh, MeshStandardMaterial, SRGBColorSpace, TextureLoader } from 'three'
import { loadObj } from './objModel.js'
import { standBeside } from './frame.js'

const RADIO_URL = './radio.mesh'
const NOTE_URL = './musical-note.mesh'

const RADIO_HEIGHT = 0.34

/**
 * Half the radio's width once it is standing, which decides how close to the frame's edge
 * it may be placed. loadObj scales uniformly to RADIO_HEIGHT, so the model's own aspect
 * (6.83 x 5.18 x 1.79) fixes the width at 0.4485, and the 0.35 turn below trades a little
 * of its depth for a little more width.
 */
const RADIO_HALF_EXTENT = (0.4485 / 2) * Math.cos(0.35) + (0.1176 / 2) * Math.sin(0.35)
const NOTE_HEIGHT = 0.11
const NOTE_COUNT = 3
const NOTE_RISE = 0.4
const NOTE_CYCLE_SECONDS = 2.4

/** Warm palette colours for the notes, which ship without textures of their own. */
const NOTE_COLORS = [0xf2c14e, 0xff9fb0, 0x8fc0e8]

/**
 * The radio's own PBR maps, downscaled from 4096² and with ambient occlusion baked into
 * the colour by `npm run radio-textures`.
 */
const loadRadioMaterial = async () => {
  const loader = new TextureLoader()
  const [map, roughnessMap, metalnessMap] = await Promise.all([
    loader.loadAsync('./radio/color.png'),
    loader.loadAsync('./radio/roughness.png'),
    loader.loadAsync('./radio/metalness.png'),
  ])

  // Colour is authored in sRGB; the other two are data and must stay linear.
  map.colorSpace = SRGBColorSpace
  // flipY is left at its default: that is right for OBJ UVs. Turning it off — correct for
  // glTF — applies the texture upside down and the whole prop looks wrong.

  return new MeshStandardMaterial({
    map,
    roughnessMap,
    metalnessMap,
    roughness: 1,
    metalness: 1,
    transparent: true,
  })
}

/**
 * A little radio beside the character, with notes drifting up out of it while something is
 * playing. Both are optional charm: if either model fails to load the app carries on.
 */
export const loadMusicScene = async ({ anchors }) => {
  const radioMaterial = await loadRadioMaterial()

  const [radio, note] = await Promise.all([
    loadObj({ url: RADIO_URL, targetHeight: RADIO_HEIGHT, material: radioMaterial }),
    loadObj({
      url: NOTE_URL,
      targetHeight: NOTE_HEIGHT,
      material: new MeshStandardMaterial({ transparent: true }),
    }),
  ])

  const root = new Group()
  /*
   * On the floor to the character's left, turned slightly towards it. Re-run on a
   * character swap, since it stands relative to a body whose width changes — and clamped
   * to the frame, because standing it a fixed multiple of that width out is what sliced
   * the radio in half as soon as a character wider than the banana arrived.
   */
  const place = (anchors) =>
    root.position.set(
      -standBeside({ sideX: anchors.sideX, reach: 2.4, halfExtent: RADIO_HALF_EXTENT }),
      0,
      anchors.frontZ * 0.5,
    )
  place(anchors)
  root.rotation.y = 0.35
  root.add(radio.object)

  const noteGeometry = note.meshes[0].geometry
  const noteScale = note.object.scale.x

  const notes = []
  for (let i = 0; i < NOTE_COUNT; i += 1) {
    const mesh = new Mesh(
      noteGeometry,
      new MeshStandardMaterial({
        color: NOTE_COLORS[i % NOTE_COLORS.length],
        roughness: 0.3,
        metalness: 0.5,
        transparent: true,
      }),
    )
    root.add(mesh)
    notes.push({ mesh, phase: i / NOTE_COUNT })
  }

  const materials = [radioMaterial, ...notes.map(({ mesh }) => mesh.material)]

  /** `presence` is eased by the render loop; `clock` drives the drift and the bob. */
  const update = ({ clock, presence }) => {
    root.visible = presence > 0.005
    if (!root.visible) return

    // Arrives by growing up off the floor, so it never pops into existence.
    root.scale.setScalar(0.4 + 0.6 * presence)
    radio.object.position.y = Math.abs(Math.sin(clock * 3.1)) * 0.012
    radioMaterial.opacity = presence

    for (const [index, entry] of notes.entries()) {
      const t = (((clock / NOTE_CYCLE_SECONDS + entry.phase) % 1) + 1) % 1
      const fade = Math.sin(Math.PI * t)

      entry.mesh.position.set(
        RADIO_HEIGHT * 0.3 + Math.sin(t * Math.PI * 2 + index) * 0.05,
        RADIO_HEIGHT * 0.9 + t * NOTE_RISE,
        0.02,
      )
      entry.mesh.rotation.set(0, clock * 1.3 + index, Math.sin(t * Math.PI * 2 + index) * 0.45)
      entry.mesh.scale.setScalar(noteScale * (0.7 + fade * 0.5))
      entry.mesh.material.opacity = fade * presence
    }
  }

  const dispose = () => {
    for (const material of materials) material.dispose()
  }

  return { root, update, dispose, place }
}
