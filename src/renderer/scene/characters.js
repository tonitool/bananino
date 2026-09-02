/**
 * The characters you can be. Data only — no three.js here — so the build scripts and the
 * tests can read the same list the renderer loads from.
 *
 * `yaw` aims the source model at the camera and `eyeRatio` says how far up its height the
 * face is painted, which is where glasses and headphones hang. Both are measured by hand,
 * once per model: nothing in a mesh announces which way it faces, and the eyes are in the
 * texture rather than the geometry.
 *
 * The ids must match CHARACTER_MENU in src/main/constants.js — test/characters.test.mjs
 * keeps the two honest — and each one needs a model at assets/characters/<id>.source.glb.
 */
export const CHARACTERS = Object.freeze({
  banana: Object.freeze({
    label: 'Bananino',
    blurb: 'Squishy, yellow, mildly judgemental.',
    yaw: -Math.PI / 2,
    eyeRatio: 0.62,
  }),
  cat: Object.freeze({
    label: 'Cat',
    blurb: 'Grey, round and thoroughly unimpressed.',
    yaw: -Math.PI / 2,
    // Higher than the banana: this face is on a head, not painted up the middle.
    eyeRatio: 0.71,
  }),
})

export const DEFAULT_CHARACTER = 'banana'

export const isCharacterId = (id) => Object.hasOwn(CHARACTERS, id)

/** Anything unknown — a hand-edited settings file, a stale query — falls back. */
export const characterId = (id) => (isCharacterId(id) ? id : DEFAULT_CHARACTER)

export const characterIds = () => Object.keys(CHARACTERS)

/** Copied out to `build/characters/` by scripts/build-renderer.mjs. */
export const characterModelUrl = (id) => `./characters/${characterId(id)}.glb`
