import { Box3, Vector3 } from 'three'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'

/**
 * Loads an OBJ, normalises it to a height in world units, and re-centres it.
 *
 * The supplied models point at textures that were not included, so materials are replaced
 * by the caller with palette colours. Normals are computed when the file has none.
 */
export const loadObj = async ({ url, targetHeight, material }) => {
  const loaded = await new OBJLoader().loadAsync(url)

  const meshes = []
  loaded.traverse((child) => {
    if (child.isMesh) meshes.push(child)
  })
  if (meshes.length === 0) throw new Error(`${url} contains no mesh.`)

  for (const mesh of meshes) {
    if (!mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals()
    mesh.material = material
    mesh.frustumCulled = false
  }

  const bounds = new Box3().setFromObject(loaded)
  const size = bounds.getSize(new Vector3())
  const centre = bounds.getCenter(new Vector3())

  loaded.scale.setScalar(targetHeight / (size.y || 1))
  loaded.position.set(
    -centre.x * loaded.scale.x,
    -bounds.min.y * loaded.scale.y,
    -centre.z * loaded.scale.z,
  )

  return { object: loaded, meshes, size }
}
