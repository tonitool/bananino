/** Pixels of slack around the silhouette, so thin parts stay easy to grab. */
const TOLERANCE_PX = 6
const SAMPLE = TOLERANCE_PX * 2 + 1
const OPAQUE_ENOUGH = 24

/**
 * Answers "is the pointer on the character" by reading the alpha the GPU just drew.
 *
 * The previous approach raycast the mesh, which is nearly a million triangles — five rays
 * per cursor sample at 30 Hz meant roughly 150 million triangle tests a second on the main
 * thread, and it made everything stutter. Reading pixels costs the same whatever the model
 * is, and is exact: it tests what is actually on screen, costumes included.
 *
 * Must be called straight after a render, while the drawing buffer still holds the frame.
 */
export const createAlphaHitTester = ({ renderer, canvas }) => {
  const gl = renderer.getContext()
  const pixels = new Uint8Array(SAMPLE * SAMPLE * 4)

  return ({ x, y }) => {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return false
    if (x < -TOLERANCE_PX || y < -TOLERANCE_PX) return false
    if (x > width + TOLERANCE_PX || y > height + TOLERANCE_PX) return false

    const ratio = renderer.getPixelRatio()
    // readPixels has its origin at the bottom left, and works in device pixels.
    const left = Math.round(x * ratio) - TOLERANCE_PX
    const bottom = Math.round((height - y) * ratio) - TOLERANCE_PX

    const clampedLeft = Math.max(0, Math.min(left, Math.round(width * ratio) - SAMPLE))
    const clampedBottom = Math.max(0, Math.min(bottom, Math.round(height * ratio) - SAMPLE))

    gl.readPixels(clampedLeft, clampedBottom, SAMPLE, SAMPLE, gl.RGBA, gl.UNSIGNED_BYTE, pixels)

    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] > OPAQUE_ENOUGH) return true
    }
    return false
  }
}
