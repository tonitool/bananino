import { ACESFilmicToneMapping, SRGBColorSpace, WebGLRenderer } from 'three'

const MAX_PIXEL_RATIO = 2

export const createRenderer = (canvas) => {
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    powerPreference: 'low-power',
  })

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO))
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15

  return renderer
}

export const resizeRenderer = (renderer, camera) => {
  const { clientWidth, clientHeight } = renderer.domElement
  if (clientWidth === 0 || clientHeight === 0) return false

  renderer.setSize(clientWidth, clientHeight, false)
  camera.aspect = clientWidth / clientHeight
  camera.updateProjectionMatrix()
  return true
}
