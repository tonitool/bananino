import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodePng } from './png.mjs'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')
const SUPERSAMPLE = 4

/** Crescent = inside the outer disc, outside the inner one. In 16px units. */
const OUTER = { x: 8.6, y: 9.4, r: 6.9 }
const INNER = { x: 11.0, y: 12.2, r: 6.6 }

const coverage = (x, y) => {
  let hits = 0
  for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
    for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
      const px = x + (sx + 0.5) / SUPERSAMPLE
      const py = y + (sy + 0.5) / SUPERSAMPLE
      const inOuter = Math.hypot(px - OUTER.x, py - OUTER.y) <= OUTER.r
      const inInner = Math.hypot(px - INNER.x, py - INNER.y) <= INNER.r
      if (inOuter && !inInner) hits += 1
    }
  }
  return hits / (SUPERSAMPLE * SUPERSAMPLE)
}

const render = (size) => {
  const scale = size / 16
  const rgba = Buffer.alloc(size * size * 4)

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const alpha = coverage(x / scale, y / scale)
      const i = (y * size + x) * 4
      // Template images are pure black plus alpha; macOS recolours them per menu bar theme.
      rgba[i + 3] = Math.round(alpha * 255)
    }
  }

  return encodePng(size, size, rgba)
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, 'trayTemplate.png'), render(16))
writeFileSync(join(OUT_DIR, 'trayTemplate@2x.png'), render(32))
console.log('Wrote assets/trayTemplate.png (16px, 32px)')
