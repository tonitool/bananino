import { DirectionalLight, HemisphereLight, PMREMGenerator } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

const ENV_INTENSITY = 0.65

/**
 * A soft studio setup: image-based lighting for believable PBR response, plus a key and
 * rim light so the silhouette still reads against any desktop wallpaper.
 */
export const addLighting = (scene, renderer) => {
  const pmrem = new PMREMGenerator(renderer)
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04)
  scene.environment = environment.texture
  scene.environmentIntensity = ENV_INTENSITY
  pmrem.dispose()

  const key = new DirectionalLight(0xfff4e2, 2.1)
  key.position.set(1.6, 2.4, 2.2)
  scene.add(key)

  const rim = new DirectionalLight(0xbcd9ff, 1.3)
  rim.position.set(-2.0, 1.2, -1.6)
  scene.add(rim)

  const ambient = new HemisphereLight(0xffffff, 0x424a55, 0.7)
  scene.add(ambient)

  return () => environment.texture.dispose()
}
