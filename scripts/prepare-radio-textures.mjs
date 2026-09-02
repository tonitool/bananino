import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Shrinks the radio's 4K PBR maps to something sane.
 *
 * The prop is drawn about fifty pixels tall, so 4096² maps are ~11 MB of detail nobody can
 * see. Ambient occlusion is multiplied into the base colour here rather than shipped as a
 * separate map — it costs nothing at runtime and saves an 8 MB texture.
 *
 * The supplied normal and height maps are flat (2 KB for 4096²) and are skipped.
 */
const SOURCE = process.argv[2] ?? '/tmp/radiotex/textures'
const OUT = 'assets/radio'
const SIZE = 256

const source = (name) => join(SOURCE, `radio-icon-002-${name}-metalness-4k.png`)

await mkdir(OUT, { recursive: true })

const shade = await sharp(source('ao')).resize(SIZE, SIZE).greyscale().toBuffer()

await sharp(source('col'))
  .resize(SIZE, SIZE)
  .composite([{ input: shade, blend: 'multiply' }])
  .png({ compressionLevel: 9 })
  .toFile(join(OUT, 'color.png'))

for (const [name, file] of [
  ['roughness', 'roughness.png'],
  ['metalness', 'metalness.png'],
]) {
  await sharp(source(name)).resize(SIZE, SIZE).greyscale().png({ compressionLevel: 9 }).toFile(join(OUT, file))
}

console.log(`radio textures written to ${OUT}/ at ${SIZE}px`)
