import { Box3, Group, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { CHARACTERS, characterId, characterModelUrl } from './characters.js'
import { measureAnchors } from './anchors.js'

/** World-space height every character is normalised to, whatever its source measured. */
const TARGET_HEIGHT = 1

/**
 * `?yaw=` re-aims whichever character is on stage, for eyeballing a model whose own yaw
 * is not yet in characters.js.
 */
const readYawOverride = () => {
  const raw = new URLSearchParams(location.search).get('yaw')
  if (raw === null) return null
  const parsed = Number(raw)
  if (Number.isFinite(parsed)) return parsed
  console.warn(`Ignoring non-numeric yaw override "${raw}".`)
  return null
}

/**
 * Rig layout:
 *   root  — carries position and rotation (hops, gaze, sway)
 *   pivot — carries scale, with its origin at the character's feet so squash and stretch
 *           push down into the floor instead of shrinking towards the middle
 *   model — the mesh, yawed so the face points down +Z
 *
 * The yaw sits on the model rather than the pivot so that pivot space is plain character
 * space: +Z is the front, +Y is up. Costume accessories and props are placed in that
 * frame, which is what lets a different character step into the same rig.
 */
export const createCharacter = (renderer) => {
  const pivot = new Group()

  const costumeSlot = new Group()
  pivot.add(costumeSlot)

  const root = new Group()
  root.add(pivot)

  let model = null
  let current = null
  let generation = 0

  /**
   * Loads a character and puts it in the rig, replacing whoever was there. The rig itself
   * survives: the render loop poses the same objects, and the radio and clock stay
   * parented to the same pivot, so a swap is invisible to everything but the mesh.
   *
   * Returns the anchors measured from the new mesh — a hat measured against the banana
   * would float beside a cat's head — or null if a later load has already claimed the
   * rig. Someone clicking through the characters can easily have two in flight, and the
   * first one asked for is not always the first to arrive.
   */
  const load = async (requested) => {
    const id = characterId(requested)
    const request = (generation += 1)

    const gltf = await new GLTFLoader().loadAsync(characterModelUrl(id))
    const next = gltf.scene

    next.rotation.y = readYawOverride() ?? CHARACTERS[id].yaw
    normaliseToFeet(next)
    tuneMaterials(next, renderer)

    /*
     * Measured before it joins the rig, while its world transform is its own. Inside the
     * rig it inherits the pivot's scale — which is mid-squash whenever the character is
     * hopping — and every anchor would come out stretched by however the character
     * happened to be posed at the moment the swap landed.
     */
    const anchors = measureAnchors(next, { eyeRatio: CHARACTERS[id].eyeRatio })

    if (request !== generation) {
      disposeModel(next)
      return null
    }

    if (model) {
      pivot.remove(model)
      disposeModel(model)
    }
    model = next
    current = id
    pivot.add(model)

    return anchors
  }

  return {
    root,
    pivot,
    costumeSlot,
    height: TARGET_HEIGHT,
    load,
    current: () => current,
  }
}

/** Measured after the yaw is applied, so the box describes the character as it faces us. */
const normaliseToFeet = (model) => {
  model.updateMatrixWorld(true)
  const bounds = new Box3().setFromObject(model)
  const size = bounds.getSize(new Vector3())
  if (size.y <= 0) throw new Error('Character model has no measurable height.')

  model.scale.setScalar(TARGET_HEIGHT / size.y)
  model.updateMatrixWorld(true)

  const scaled = new Box3().setFromObject(model)
  const centre = scaled.getCenter(new Vector3())
  model.position.set(-centre.x, -scaled.min.y, -centre.z)
  model.updateMatrixWorld(true)
}

const tuneMaterials = (model, renderer) => {
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy()

  model.traverse((child) => {
    if (!child.isMesh) return
    child.frustumCulled = false

    for (const material of materialsOf(child)) {
      material.envMapIntensity = 0.9
      for (const map of [material.map, material.normalMap, material.roughnessMap]) {
        if (map) map.anisotropy = maxAnisotropy
      }
      material.needsUpdate = true
    }
  })
}

/**
 * A character is several megabytes of geometry and three 4K textures. Switching back and
 * forth a few times without releasing them fills the GPU with copies nothing draws.
 */
const disposeModel = (model) => {
  model.traverse((child) => {
    if (!child.isMesh) return
    child.geometry?.dispose()
    for (const material of materialsOf(child)) {
      for (const value of Object.values(material)) {
        if (value?.isTexture) value.dispose()
      }
      material.dispose()
    }
  })
}

const materialsOf = (mesh) =>
  Array.isArray(mesh.material) ? mesh.material : [mesh.material].filter(Boolean)
