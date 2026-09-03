/**
 * The characters you can be. Data only — no three.js here — so the build scripts and the
 * tests can read the same list the renderer loads from.
 *
 * `yaw` aims the source model at the camera and `eyeRatio` says how far up its height the
 * face is painted, which is where glasses and headphones hang. Both are measured by hand,
 * once per model: nothing in a mesh announces which way it faces, and the eyes are in the
 * texture rather than the geometry.
 *
 * `shirt` is the same kind of fact, and the reason it is four hand-tuned numbers rather
 * than a measurement is that this body defeats measuring: the banana is curved, so no
 * axis runs down it, and its torso sits about 0.08 behind the middle of its own bounding
 * box. So the shirt declares where its hem sits, how tall and how wide it is — all as
 * fractions of the character's height — and how far forward, tuned against a render.
 *
 * A character with no `shirt` wears none: the polo is cut for a banana, and stretching it
 * over a cat would look like exactly that.
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
    /*
     * The collar has to clear the face, and this character wears its face on its body —
     * the eyes are at 0.62, so the shirt stops at 0.52. Its torso is a 0.24-wide tube
     * standing 0.08 back, and its stubby arms hang from about 0.48 down to 0.20, which is
     * what the sleeves have to land on.
     */
    shirt: Object.freeze({
      hemY: 0.19,
      height: 0.36,
      width: 0.27,
      depth: 0.32,
      z: -0.01,
      lean: -0.25,
    }),
  }),
  cat: Object.freeze({
    label: 'Cat',
    blurb: 'Grey, round and thoroughly unimpressed.',
    yaw: -Math.PI / 2,
    // Higher than the banana: this face is on a head, not painted up the middle.
    eyeRatio: 0.71,
    // No shirt: the polo is modelled for the banana, and a cat is a different animal.
  }),
})

export const DEFAULT_CHARACTER = 'banana'

export const isCharacterId = (id) => Object.hasOwn(CHARACTERS, id)

/** Anything unknown — a hand-edited settings file, a stale query — falls back. */
export const characterId = (id) => (isCharacterId(id) ? id : DEFAULT_CHARACTER)

export const characterIds = () => Object.keys(CHARACTERS)

/** Copied out to `build/characters/` by scripts/build-renderer.mjs. */
export const characterModelUrl = (id) => `./characters/${characterId(id)}.glb`
