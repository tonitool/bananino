import { PerspectiveCamera, Scene } from 'three'

/** `?zoom=` pulls the camera in or out — used to tighten framing when rendering the icon. */
const readZoom = () => {
  const parsed = Number(new URLSearchParams(location.search).get('zoom'))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

const CAMERA = Object.freeze({
  fov: 28,
  near: 0.1,
  far: 50,
  position: [0, 0.66, 3.80],
  lookAt: [0, 0.54, 0],
})

export const createScene = () => {
  const scene = new Scene()
  const camera = new PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far)
  const [x, y, z] = CAMERA.position
  const zoom = readZoom()
  camera.position.set(x, CAMERA.lookAt[1] + (y - CAMERA.lookAt[1]) * zoom, z * zoom)
  camera.lookAt(...CAMERA.lookAt)
  scene.add(camera)
  return { scene, camera }
}
