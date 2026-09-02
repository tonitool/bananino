/**
 * A pose delta. Offsets and rotations add together, scales multiply, so any number of
 * animation layers can be composed without one clobbering another.
 */
export const IDENTITY = Object.freeze({
  offsetX: 0,
  offsetY: 0,
  tiltX: 0,
  turnY: 0,
  rollZ: 0,
  scaleX: 1,
  scaleY: 1,
  scaleZ: 1,
})

export const compose = (a, b) => ({
  offsetX: a.offsetX + b.offsetX,
  offsetY: a.offsetY + b.offsetY,
  tiltX: a.tiltX + b.tiltX,
  turnY: a.turnY + b.turnY,
  rollZ: a.rollZ + b.rollZ,
  scaleX: a.scaleX * b.scaleX,
  scaleY: a.scaleY * b.scaleY,
  scaleZ: a.scaleZ * b.scaleZ,
})

export const composeAll = (layers) => layers.reduce(compose, IDENTITY)
