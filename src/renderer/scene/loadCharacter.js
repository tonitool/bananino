import { Box3, Group, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const MODEL_URL = './character.glb'

/** World-space height the character is normalised to, whatever the source model measured. */
const TARGET_HEIGHT = 1

/**
 * The source model faces +X. Yawing it a quarter turn puts the face towards the camera,
 * which is where every gaze and reaction below assumes "front" is.
 */
const DEFAULT_YAW = -Math.PI / 2

const readYaw = () => {
  const raw = new URLSearchParams(location.search).get('yaw')
  if (raw === null) return DEFAULT_YAW
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    console.warn(`Ignoring non-numeric yaw override "${raw}".`)
    return DEFAULT_YAW
  }
  return parsed
}

/**
 * Rig layout:
 *   root  — carries position and rotation (hops, gaze, sway)
 *   pivot — carries scale, with its origin at the character's feet so squash and stretch
 *           push down into the floor instead of shrinking towards the middle
 *   model — the mesh, yawed so the face points down +Z
 *
 * The yaw sits on the model rather than the pivot so that pivot space is plain character
 * space: +Z is the front, +Y is up. Costume accessories are placed in that frame.
 */
export const loadCharacter = async (renderer) => {
  const gltf = await new GLTFLoader().loadAsync(MODEL_URL)
  const model = gltf.scene

  model.rotation.y = readYaw()
  normaliseToFeet(model)
  tuneMaterials(model, renderer)

  const pivot = new Group()
  pivot.add(model)

  const costumeSlot = new Group()
  pivot.add(costumeSlot)

  const root = new Group()
  root.add(pivot)

  return { root, pivot, model, costumeSlot, height: TARGET_HEIGHT }
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

const materialsOf = (mesh) =>
  Array.isArray(mesh.material) ? mesh.material : [mesh.material].filter(Boolean)
