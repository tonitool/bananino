import { IDENTITY, composeAll } from './transform.js'
import { TAU, clamp, damp, easeOutBack } from './easing.js'
import { reactionPose } from './reactions.js'
import { dancePose } from './dances.js'

const IDLE = Object.freeze({
  breathRate: 1.55,
  breathAmount: 0.022,
  floatRate: 1.05,
  floatAmount: 0.03,
  swayRate: 0.63,
  swayAmount: 0.035,
})

const GAZE = Object.freeze({
  maxTurn: 0.55,
  maxTilt: 0.22,
  /** Fraction of the remaining distance still left after one second. */
  smoothing: 0.0004,
})

const DRAG = Object.freeze({
  swingPerPixel: 0.09,
  maxSwing: 0.45,
  stretchPerPixel: 0.05,
  maxStretch: 0.14,
})

const HOVER_LIFT = 0.035

/** Fraction of the presence gap left after one second — about a quarter-second arrival. */
const PRESENCE_SMOOTHING = 0.0002

/**
 * Breathing, floating and swaying — the layer that keeps a static mesh feeling alive.
 * `damping` pulls it back while a dance is running, so the two do not fight each other.
 */
export const idlePose = (clock, damping = 1) => {
  const breath = Math.sin(clock * IDLE.breathRate) * damping
  return {
    ...IDENTITY,
    offsetY: Math.sin(clock * IDLE.floatRate) * IDLE.floatAmount * damping,
    rollZ: Math.sin(clock * IDLE.swayRate) * IDLE.swayAmount * damping,
    turnY: Math.sin(clock * IDLE.swayRate * 0.41) * 0.05 * damping,
    scaleY: 1 + breath * IDLE.breathAmount,
    scaleX: 1 - breath * IDLE.breathAmount * 0.6,
    scaleZ: 1 - breath * IDLE.breathAmount * 0.6,
  }
}

/** How much of the idle layer survives while dancing. */
const DANCING_IDLE_DAMPING = 0.25

/** `gaze` components are -1 → 1, relative to the window centre. */
export const gazePose = (gaze) => ({
  ...IDENTITY,
  turnY: gaze.x * GAZE.maxTurn,
  tiltX: gaze.y * GAZE.maxTilt,
})

/** Momentum while being carried: the body trails the hand, then stretches slightly. */
export const dragPose = (velocity) => {
  const swing = clamp(-velocity.x * DRAG.swingPerPixel, -DRAG.maxSwing, DRAG.maxSwing)
  const stretch = clamp(
    Math.abs(velocity.y) * DRAG.stretchPerPixel,
    0,
    DRAG.maxStretch,
  )
  return {
    ...IDENTITY,
    rollZ: swing,
    tiltX: clamp(velocity.y * DRAG.swingPerPixel * 0.4, -0.2, 0.2),
    scaleY: 1 + stretch,
    scaleX: 1 - stretch * 0.5,
    scaleZ: 1 - stretch * 0.5,
  }
}

export const hoverPose = (isHovered) =>
  isHovered ? { ...IDENTITY, offsetY: HOVER_LIFT, scaleY: 1.015 } : IDENTITY

/** Arrives with a little overshoot, leaves by dropping and shrinking away. */
export const presencePose = (presence) => {
  if (presence >= 0.999) return IDENTITY
  const eased = clamp(easeOutBack(clamp(presence, 0, 1)), 0, 1.1)
  const scale = 0.68 + 0.32 * eased
  return {
    ...IDENTITY,
    offsetY: (eased - 1) * 0.14,
    scaleX: scale,
    scaleY: scale,
    scaleZ: scale,
  }
}

export const settlePresence = (presence, target, dt) =>
  damp(presence, target, PRESENCE_SMOOTHING, dt)

export const settleGaze = (gaze, target, dt) => ({
  x: damp(gaze.x, target.x, GAZE.smoothing, dt),
  y: damp(gaze.y, target.y, GAZE.smoothing, dt),
})

export const poseFor = (state) =>
  composeAll([
    presencePose(state.presence),
    idlePose(state.clock, state.dance ? DANCING_IDLE_DAMPING : 1),
    dancePose(state.dance),
    gazePose(state.gaze),
    hoverPose(state.isHovered),
    state.isDragging ? dragPose(state.dragVelocity) : IDENTITY,
    ...state.reactions.map(reactionPose),
  ])

/** Applies a composed pose to the character rig. Scale is anchored at the feet. */
export const applyPose = ({ root, pivot }, pose) => {
  root.position.set(pose.offsetX, pose.offsetY, 0)
  root.rotation.set(pose.tiltX, pose.turnY, pose.rollZ)
  pivot.scale.set(pose.scaleX, pose.scaleY, pose.scaleZ)
}

export { TAU }
