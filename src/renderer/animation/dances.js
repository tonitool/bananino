import { IDENTITY } from './transform.js'
import { TAU } from './easing.js'
import { SAMBA_CURVE } from './curves/samba.js'

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

  /**
   * The only dance that is not invented here: an 18-second table baked out of a real
   * motion-captured samba (see scripts/bake-dance.mjs). What survives the trip from a
   * 34-joint skeleton to a body that can only lean, tilt, twist, sway and squash is the
   * hips and the torso — which is most of what reads at this size anyway.
   */
  samba: {
    label: 'Samba',
    emoji: '🥁',
    transform: (t) => {
      const [offsetX, offsetY, tiltX, rollZ, turnY] = sampleCurve(SAMBA_CURVE, t)

      // The performance is far bigger than this app: raw, it is two to three times the
      // amplitude of every other dance here. These bring it into the house range without
      // touching its timing, and can be re-tuned without re-baking.
      const bob = offsetY / SAMBA_CURVE.peaks[1]
      const lift = Math.max(0, bob)
      const squash = Math.max(0, -bob)

      return {
        ...IDENTITY,
        offsetX: offsetX * 0.2,
        offsetY,
        tiltX: tiltX * 0.7,
        rollZ: rollZ * 0.25,
        turnY: turnY * 0.5,
        // Squash on the beat, from the bob rather than a separate baked channel — the
        // same shape bounce and the hop reaction use.
        scaleY: 1 + 0.06 * lift - 0.09 * squash,
        scaleX: 1 - 0.035 * lift + 0.06 * squash,
        scaleZ: 1 - 0.035 * lift + 0.06 * squash,
      }
    },
  },
})

/**
 * Reads a baked curve at `t` seconds, looping at its duration and interpolating between
 * the two frames either side — including across the seam, where the last frame runs back
 * into the first.
 */
const sampleCurve = ({ data, columns, frames, duration }, t) => {
  const x = ((t % duration) / duration) * frames
  const lo = Math.floor(x) % frames
  const hi = (lo + 1) % frames
  const f = x - Math.floor(x)

  return Array.from({ length: columns }, (_, c) => {
    const from = data[lo * columns + c]
    return from + (data[hi * columns + c] - from) * f
  })
}

export const DANCE_NAMES = Object.freeze(Object.keys(DANCES))

export const isDanceName = (name) => Object.hasOwn(DANCES, name)

export const dancePose = (dance) => (dance ? DANCES[dance.name].transform(dance.elapsed) : IDENTITY)

export const randomDance = (previous) => {
  const options = DANCE_NAMES.filter((name) => name !== previous)
  return options[Math.floor(Math.random() * options.length)]
}
