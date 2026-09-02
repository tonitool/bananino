import { IDENTITY } from './transform.js'
import { TAU } from './easing.js'

/**
 * Dances are pose layers that loop until stopped, so they take elapsed seconds rather
 * than normalised progress the way one-shot reactions do. That lets each one run several
 * frequencies at once — a fast bounce under a slow sway is what stops it looking robotic.
 */
export const DANCES = Object.freeze({
  bounce: {
    label: 'Bounce',
    emoji: '🕺',
    transform: (t) => {
      const beat = 2.6
      const lift = Math.abs(Math.sin(Math.PI * beat * t))
      const squash = 1 - lift
      return {
        ...IDENTITY,
        offsetY: lift * 0.13,
        rollZ: Math.sin(TAU * beat * 0.5 * t) * 0.08,
        turnY: Math.sin(TAU * beat * 0.25 * t) * 0.14,
        scaleY: 1 + 0.09 * lift - 0.13 * squash,
        scaleX: 1 - 0.05 * lift + 0.08 * squash,
        scaleZ: 1 - 0.05 * lift + 0.08 * squash,
      }
    },
  },

  sway: {
    label: 'Sway',
    emoji: '💃',
    transform: (t) => {
      const beat = 0.9
      const phase = TAU * beat * t
      return {
        ...IDENTITY,
        offsetX: Math.sin(phase) * 0.05,
        offsetY: Math.abs(Math.sin(phase)) * 0.03,
        rollZ: Math.sin(phase) * 0.17,
        turnY: Math.cos(phase) * 0.2,
        tiltX: 0.03,
      }
    },
  },

  twist: {
    label: 'Twist',
    emoji: '🌀',
    transform: (t) => {
      const beat = 1.5
      return {
        ...IDENTITY,
        turnY: Math.sin(TAU * beat * t) * 0.75,
        rollZ: Math.sin(TAU * beat * t) * -0.06,
        offsetY: Math.abs(Math.sin(TAU * beat * 2 * t)) * 0.05,
        scaleY: 1 + Math.sin(TAU * beat * 2 * t) * 0.03,
      }
    },
  },

  shimmy: {
    label: 'Shimmy',
    emoji: '✨',
    transform: (t) => {
      const beat = 5.5
      return {
        ...IDENTITY,
        offsetX: Math.sin(TAU * beat * t) * 0.024,
        rollZ: Math.sin(TAU * beat * t) * 0.11,
        offsetY: Math.abs(Math.sin(TAU * beat * 0.5 * t)) * 0.025,
        scaleX: 1 + Math.sin(TAU * beat * 0.5 * t) * 0.03,
      }
    },
  },

  headbang: {
    label: 'Headbang',
    emoji: '🤘',
    transform: (t) => {
      const beat = 2.2
      const swing = Math.sin(TAU * beat * t)
      return {
        ...IDENTITY,
        tiltX: swing * 0.24 + 0.06,
        offsetY: Math.abs(swing) * 0.04,
        scaleY: 1 - Math.abs(swing) * 0.05,
        scaleZ: 1 + Math.abs(swing) * 0.04,
      }
    },
  },

  spin: {
    label: 'Spin',
    emoji: '🌪️',
    transform: (t) => ({
      ...IDENTITY,
      turnY: t * TAU * 0.85,
      offsetY: Math.abs(Math.sin(TAU * 1.7 * t)) * 0.1,
      rollZ: 0.06,
    }),
  },
})

export const DANCE_NAMES = Object.freeze(Object.keys(DANCES))

export const isDanceName = (name) => Object.hasOwn(DANCES, name)

export const dancePose = (dance) => (dance ? DANCES[dance.name].transform(dance.elapsed) : IDENTITY)

export const randomDance = (previous) => {
  const options = DANCE_NAMES.filter((name) => name !== previous)
  return options[Math.floor(Math.random() * options.length)]
}
