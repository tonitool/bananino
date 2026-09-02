import { IDENTITY } from './transform.js'
import { TAU, clamp, easeInOutCubic, easeOutCubic } from './easing.js'

/** Peak lift of a hop, in character heights. Also drives how far the shadow drops off. */
export const HOP_HEIGHT = 0.24
const ANTICIPATION = 0.22

/**
 * Each reaction maps normalised progress (0 → 1) to a pose delta. Keeping them as pure
 * functions means a reaction can be previewed, tested, or layered without side effects.
 */
export const REACTIONS = Object.freeze({
  hop: {
    duration: 0.78,
    transform: (p) => {
      if (p < ANTICIPATION) {
        const crouch = Math.sin((Math.PI * p) / ANTICIPATION)
        return { ...IDENTITY, scaleY: 1 - 0.2 * crouch, scaleX: 1 + 0.13 * crouch, scaleZ: 1 + 0.13 * crouch }
      }
      const q = (p - ANTICIPATION) / (1 - ANTICIPATION)
      const height = Math.sin(Math.PI * q)
      return {
        ...IDENTITY,
        offsetY: height * HOP_HEIGHT,
        scaleY: 1 + 0.12 * height,
        scaleX: 1 - 0.07 * height,
        scaleZ: 1 - 0.07 * height,
        rollZ: Math.sin(TAU * q) * 0.06,
      }
    },
  },

  spin: {
    duration: 1.05,
    transform: (p) => ({
      ...IDENTITY,
      turnY: easeInOutCubic(p) * TAU,
      offsetY: Math.sin(Math.PI * p) * 0.16,
      scaleY: 1 + Math.sin(Math.PI * p) * 0.05,
    }),
  },

  wobble: {
    duration: 0.9,
    transform: (p) => ({
      ...IDENTITY,
      rollZ: Math.sin(p * TAU * 2.5) * 0.22 * (1 - easeOutCubic(p)),
    }),
  },

  /** Played the moment the character is grabbed, so a click feels like it landed. */
  squish: {
    duration: 0.45,
    transform: (p) => {
      const recoil = Math.sin(Math.PI * p) * (1 - p * 0.4)
      return {
        ...IDENTITY,
        scaleY: 1 - 0.16 * recoil,
        scaleX: 1 + 0.11 * recoil,
        scaleZ: 1 + 0.11 * recoil,
      }
    },
  },

  /** A slow, pleased stretch used when the character is left alone for a while. */
  stretch: {
    duration: 2.2,
    transform: (p) => {
      const wave = Math.sin(Math.PI * p)
      return {
        ...IDENTITY,
        scaleY: 1 + 0.09 * wave,
        scaleX: 1 - 0.05 * wave,
        scaleZ: 1 - 0.05 * wave,
        tiltX: -0.1 * wave,
        offsetY: 0.05 * wave,
      }
    },
  },
})

export const isReactionName = (name) => Object.hasOwn(REACTIONS, name)

export const reactionPose = ({ name, elapsed }) => {
  const reaction = REACTIONS[name]
  if (!reaction) return IDENTITY
  return reaction.transform(clamp(elapsed / reaction.duration, 0, 1))
}
