import { Vector3 } from 'three'
import { clamp } from '../animation/easing.js'

const GROUND = new Vector3(0, 0, 0)

/** A contact shadow that loosens as the character rises: the cheapest cue for "floating". */
export const createShadow = (element) => {
  /**
   * Positioned relative to the stage, so the canvas's offset within it has to be added
   * in. Measured rectangles rather than `offsetLeft`, which ignores CSS translate and so
   * reported the canvas half its own width to the right of where it is drawn.
   */
  const anchor = (camera, canvas) => {
    const projected = GROUND.clone().project(camera)
    const canvasRect = canvas.getBoundingClientRect()
    const stageRect = (canvas.offsetParent ?? document.body).getBoundingClientRect()

    const left = canvasRect.left - stageRect.left + ((projected.x + 1) / 2) * canvasRect.width
    const top = canvasRect.top - stageRect.top + ((-projected.y + 1) / 2) * canvasRect.height
    element.style.left = `${left}px`
    element.style.top = `${top}px`
  }

  const update = (liftRatio) => {
    const lift = clamp(liftRatio, 0, 1)
    element.style.setProperty('--shadow-scale', (1 - lift * 0.45).toFixed(3))
    element.style.setProperty('--shadow-alpha', (0.2 - lift * 0.13).toFixed(3))
    element.style.setProperty('--shadow-blur', `${5 + lift * 7}px`)
  }

  return { anchor, update }
}
