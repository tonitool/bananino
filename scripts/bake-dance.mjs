import { NodeIO } from '@gltf-transform/core'
import { writeFileSync } from 'node:fs'

/**
 * Bakes a rigged dance clip down to something this app can actually play.
 *
 * The characters are single static meshes with no skeleton, and the whole per-frame rig
 * surface is position and rotation on the body plus a scale on the pivot (see
 * animator.js applyPose). A 34-joint Mixamo clip cannot be played on that — but the parts
 * of it that read at a few hundred pixels can: the hips' sway and bob, the torso's lean,
 * tilt and twist. Those are exactly the fields a dance may write, so they are sampled out
 * of the clip into a small table that dances.js plays back.
 *
 * What is deliberately dropped:
 *   - every limb, because there is nothing to attach them to;
 *   - fore/aft travel, because applyPose hard-wires z to 0;
 *   - the hips' yaw, which in this clip turns the dancer right round (430 degrees across
 *     the phrase) as staging. The twist that reads as *dancing* is the spine's yaw
 *     relative to the hips, and that is what is baked instead. Filtering the hips' yaw was
 *     measured and does not work: the turns are fast, not a slow drift, so a 1-second
 *     high-pass still leaves 330 degrees of it.
 *
 * Amplitudes are NOT applied here — the table is normalised to the character's height and
 * left in radians, so dances.js can be re-tuned without re-baking.
 */
const SOURCE = 'assets/dances/samba.source.glb'
const TARGET = 'src/renderer/animation/curves/samba.js'

/** 15 fps costs 3% worst-case error against this clip's ~35 fps source. 30 doubles the table for 0.5%. */
const FPS = Number(process.env.FPS ?? 15)

/** Which bone gives which motion. Mixamo names carry a prefix and an export suffix. */
const boneName = (node) => (node?.getName() ?? '').replace('mixamorig:', '').replace(/_\d+$/, '')

const io = new NodeIO()
const document = await io.read(SOURCE)
const animation = document.getRoot().listAnimations()[0]
if (!animation) throw new Error(`${SOURCE} has no animation to bake.`)

/** channels[bone][path] = { times, values } — values as one array per key. */
const channels = {}
for (const channel of animation.listChannels()) {
  const bone = boneName(channel.getTargetNode())
  const sampler = channel.getSampler()
  const input = sampler.getInput()
  const output = sampler.getOutput()
  const stride = output.getElementSize()
  const flat = output.getArray()

  channels[bone] ??= {}
  channels[bone][channel.getTargetPath()] = {
    times: Array.from(input.getArray()),
    values: Array.from({ length: output.getCount() }, (_, i) =>
      Array.from(flat.subarray(i * stride, (i + 1) * stride)),
    ),
  }
}

const need = (bone, path) => {
  const channel = channels[bone]?.[path]
  if (!channel) throw new Error(`${SOURCE} has no ${path} channel for ${bone}.`)
  return channel
}

const hipsPosition = need('Hips', 'translation')
const hipsRotation = need('Hips', 'rotation')
const spineRotation = need('Spine', 'rotation')

const DURATION = hipsPosition.times.at(-1)

/**
 * YXZ, which is what makes the rest of this work: Y is applied first, so X and Z come out
 * as lean and tilt *in the body's own frame*. Dropping the yaw then leaves the dancer's
 * lean as a camera following them would see it — which is what a character that always
 * faces the front needs.
 */
const eulerYXZ = ([x, y, z, w]) => [
  Math.asin(Math.max(-1, Math.min(1, 2 * (w * x - y * z)))),
  Math.atan2(2 * (w * y + x * z), 1 - 2 * (x * x + y * y)),
  Math.atan2(2 * (w * z + x * y), 1 - 2 * (x * x + z * z)),
]

/** Linear read of a channel, matching how the renderer will play the table back. */
const sample = ({ times, values }, t, map = (v) => v) => {
  const i = times.findIndex((time) => time >= t)
  if (i <= 0) return map(values[0])
  const span = times[i] - times[i - 1]
  const f = span > 0 ? (t - times[i - 1]) / span : 0
  const a = map(values[i - 1])
  const b = map(values[i])
  return a.map((value, k) => value + (b[k] - value) * f)
}

/**
 * The figure's height, which the translations are normalised against so the motion means
 * the same on a one-unit-tall character. Estimated from the resting hips: a humanoid's
 * hips sit at about half its height, and no bone in the file states the total.
 */
const restingHip = hipsPosition.values.reduce((sum, [, y]) => sum + y, 0) / hipsPosition.values.length
const BODY_HEIGHT = restingHip * 2
const restingSide = hipsPosition.values.reduce((sum, [x]) => sum + x, 0) / hipsPosition.values.length

/** The five numbers a dance may write, in the order dances.js unpacks them. */
const COLUMNS = ['offsetX', 'offsetY', 'tiltX', 'rollZ', 'turnY']

const poseAt = (t) => {
  const position = sample(hipsPosition, t)
  const hips = sample(hipsRotation, t, eulerYXZ)
  const spine = sample(spineRotation, t, eulerYXZ)
  return [
    // Means removed: otherwise the dance would stand the character off-centre and hold it
    // there, floating or sunk into the floor for as long as it ran.
    (position[0] - restingSide) / BODY_HEIGHT,
    (position[1] - restingHip) / BODY_HEIGHT,
    hips[0] + spine[0],
    hips[2] + spine[2],
    spine[1],
  ]
}

/*
 * Frame 0 and frame FRAMES coincide — the clip's first and last hips keys are identical —
 * so only the first is stored and playback wraps back to it.
 */
const FRAMES = Math.round(DURATION * FPS)
const table = Array.from({ length: FRAMES }, (_, i) => poseAt((i / FRAMES) * DURATION))
const peaks = COLUMNS.map((_, c) => Math.max(...table.map((frame) => Math.abs(frame[c]))))

/*
 * The table's own report card: play it back the way the renderer will and compare against
 * the source at far higher resolution than either. A large number here means the mapping
 * or the sampling rate is wrong, and it is the only thing that says whether the baked
 * dance is still the dance that was recorded.
 */
const play = (t) => {
  const x = ((t % DURATION) / DURATION) * FRAMES
  const lo = Math.floor(x) % FRAMES
  const hi = (lo + 1) % FRAMES
  const f = x - Math.floor(x)
  return table[lo].map((value, c) => value + (table[hi][c] - value) * f)
}

const CHECKS = 2000
const worst = COLUMNS.map(() => 0)
for (let i = 0; i < CHECKS; i += 1) {
  const t = (i / CHECKS) * DURATION
  const truth = poseAt(t)
  const played = play(t)
  truth.forEach((value, c) => {
    worst[c] = Math.max(worst[c], Math.abs(played[c] - value))
  })
}

const round = (value) => Number(value.toFixed(4))
const source = `/*
 * GENERATED FILE — do not edit. Regenerate with \`npm run bake-dance\`.
 *
 * Baked from assets/dances/samba.source.glb by scripts/bake-dance.mjs, which documents
 * what is kept and what is dropped. Translations are in character heights, rotations in
 * radians, both unscaled: the amplitudes live with the dance in dances.js.
 *
 * "Stickman Samba Dancing (aka the Toothless Dance)" by adu2763, CC-BY-4.0
 * https://sketchfab.com/3d-models/stickman-samba-dancing-aka-the-toothless-dance-329a2840e54e4ad59452cfcb4e53c9a8
 */
export const SAMBA_CURVE = Object.freeze({
  duration: ${round(DURATION)},
  fps: ${FPS},
  frames: ${FRAMES},
  columns: ${COLUMNS.length},
  /** ${COLUMNS.join(', ')} — the largest absolute value each one reaches. */
  peaks: Object.freeze([${peaks.map(round).join(', ')}]),
  /** ${COLUMNS.length} numbers per frame, in the order above. */
  data: Object.freeze([
${table.map((frame) => `    ${frame.map(round).join(', ')},`).join('\n')}
  ]),
})
`

writeFileSync(TARGET, source, 'utf8')

const size = (Buffer.byteLength(source) / 1024).toFixed(1)
console.log(`bake-dance: ${SOURCE} -> ${TARGET}`)
console.log(`  clip      ${DURATION.toFixed(2)}s, baked at ${FPS}fps = ${FRAMES} frames x ${COLUMNS.length} = ${FRAMES * COLUMNS.length} numbers (${size}KB)`)
console.log(`  figure    ${BODY_HEIGHT.toFixed(2)} units tall (hips resting at ${restingHip.toFixed(2)})`)
for (const [c, name] of COLUMNS.entries()) {
  const unit = name.startsWith('offset') ? 'heights' : 'rad'
  const asPercent = peaks[c] > 0 ? ((worst[c] / peaks[c]) * 100).toFixed(2) : '0.00'
  console.log(`  ${name.padEnd(8)}  peak ${peaks[c].toFixed(4)} ${unit.padEnd(7)} worst playback error ${worst[c].toFixed(4)} (${asPercent}% of peak)`)
}
const seam = play(DURATION).map((value, c) => Math.abs(value - table[0][c]))
console.log(`  loop      seam error ${Math.max(...seam).toFixed(6)} (0 means it repeats exactly)`)
