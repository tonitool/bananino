import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

/*
 * The menu bar icon, drawn from arithmetic rather than exported from a drawing app.
 *
 * A menu bar icon is a *template* image: macOS throws the colour away and keeps the alpha,
 * tinting it black or white to suit the menu bar. So there is nothing to draw but a
 * silhouette, at 16 points, where a banana's problem becomes obvious — a banana in
 * silhouette is a crescent, and a crescent is a moon. The old icon was a perfectly good
 * banana that everybody read as the weather.
 *
 * Three things fix it, and all three are about being the thing a moon is not:
 *
 *   - **A stem.** The one feature no moon has. It is deliberately chunky: one pixel of
 *     stem at this size is a smudge or an artefact, never a stem.
 *   - **The smile pose.** Moons are drawn as vertical crescents, horns to the side. This
 *     lies along the bottom with both ends up, which no moon does.
 *   - **Ends that differ.** Tapered at the flower end, squared under the stem, so it
 *     reads as an object with a top and a bottom rather than an arc.
 *
 * Written with no dependency beyond node's own zlib: a build asset nobody can regenerate
 * is a build asset that slowly goes wrong. `node scripts/make-tray-icon.mjs --preview`
 * prints it as text, which is the only way to judge a 16px shape without squinting at one.
 */

/** The centreline the banana is stroked along, as a circle arc in a 0..1 square. */
const ARC = Object.freeze({
  centreX: 0.5,
  /* Above the icon, so the arc hanging below it is the smile the body lies along. */
  centreY: 0.90,
  radius: 0.47,
  /* Degrees with y upward, both ends swinging up: the stem end first. */
  from: 214,
  to: 326,
})

/**
 * Where the whole shape sits in the square.
 *
 * Tuned against `--preview` rather than calculated: the stem adds height on one side only,
 * so centring the arc does not centre the banana, and a menu bar icon wants a pixel of air
 * on every edge — one that touches the sides looks crammed next to its neighbours.
 */
const OFFSET = Object.freeze({ x: -0.02, y: -0.10 })

/** How thick the body is along the arc, from the stem end (0) to the flower end (1). */
const thicknessAt = (t) => {
  // Fullest just past the middle, tapering to a blunt point at the flower end.
  // The flower end stays blunt rather than tapering away: a point thinner than a pixel
  // renders as a faint speck at 16px, which reads as dirt on the screen.
  return (0.055 + 0.030 * Math.sin(Math.PI * t)) * (1 - 0.25 * t * t)
}

const pointAt = (t) => {
  const angle = ((ARC.to + (ARC.from - ARC.to) * t) * Math.PI) / 180
  return {
    x: ARC.centreX + OFFSET.x + ARC.radius * Math.cos(angle),
    y: ARC.centreY + OFFSET.y + ARC.radius * Math.sin(angle),
  }
}

/** Distance from a point to a line segment — the brush that strokes the centreline. */
const toSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax
  const dy = by - ay
  const length = dx * dx + dy * dy
  const along = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length))
  return Math.hypot(px - (ax + along * dx), py - (ay + along * dy))
}

const STEPS = 160

/** True if the point is inside the banana: the stroked arc, plus the stem on the end. */
const isInk = (x, y) => {
  for (let step = 0; step < STEPS; step += 1) {
    const t0 = step / STEPS
    const t1 = (step + 1) / STEPS
    const a = pointAt(t0)
    const b = pointAt(t1)
    if (toSegment(x, y, a.x, a.y, b.x, b.y) <= thicknessAt(t0)) return true
  }

  /*
   * The stem: a stub standing up from the squared end, angled slightly outward so it
   * cannot be mistaken for the body carrying on.
   */
  const root = pointAt(0)
  const tip = { x: root.x + 0.050, y: root.y + 0.135 }
  return toSegment(x, y, root.x, root.y, tip.x, tip.y) <= 0.048
}

/** Coverage per pixel, supersampled — the whole icon is edges at this size. */
const render = (size, samples = 8) => {
  const coverage = new Float64Array(size * size)

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let hits = 0
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = (px + (sx + 0.5) / samples) / size
          // Flipped: the maths has y upward, a bitmap counts rows downward.
          const y = 1 - (py + (sy + 0.5) / samples) / size
          if (isInk(x, y)) hits += 1
        }
      }
      coverage[py * size + px] = hits / (samples * samples)
    }
  }
  return coverage
}

/** A PNG, by hand: black pixels whose alpha is the coverage. */
const png = (size, coverage) => {
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)

  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0 // filter: none
    for (let x = 0; x < size; x += 1) {
      const at = y * (stride + 1) + 1 + x * 4
      raw[at] = 0
      raw[at + 1] = 0
      raw[at + 2] = 0
      raw[at + 3] = Math.round(coverage[y * size + x] * 255)
    }
  }

  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([length, body, crc])
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // colour type: RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

const crc32 = (buffer) => {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const preview = (size, coverage) => {
  for (let y = 0; y < size; y += 1) {
    let line = ''
    for (let x = 0; x < size; x += 1) {
      const a = coverage[y * size + x]
      line += a > 0.66 ? '##' : a > 0.25 ? '::' : '  '
    }
    console.log(line)
  }
}

const OUT = join(process.cwd(), 'assets')

for (const [size, name] of [
  [16, 'trayTemplate.png'],
  [32, 'trayTemplate@2x.png'],
]) {
  const coverage = render(size)
  if (process.argv.includes('--preview')) {
    console.log(`\n${name} — ${size}x${size}`)
    preview(size, coverage)
  }
  if (!process.argv.includes('--preview-only')) {
    writeFileSync(join(OUT, name), png(size, coverage))
  }
}

if (!process.argv.includes('--preview-only')) console.log('make-tray-icon: wrote both sizes')
