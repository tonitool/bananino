import { NodeIO } from '@gltf-transform/core'
import { dedup, prune, simplify, weld } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { characterIds } from '../src/renderer/scene/characters.js'

/**
 * The supplied models are photogrammetry-style exports: nearly a million triangles each
 * for a character drawn at a few hundred pixels. That is invisible detail at this size,
 * but it is most of the app's download and all of its GPU cost.
 *
 * Reads assets/characters/<id>.source.glb and writes assets/characters/<id>.glb, so the
 * originals are always kept and this can be re-run with a different ratio. Pass ids to
 * do only some of them: `node scripts/optimise-model.mjs cat`.
 */
const DIR = 'assets/characters'
const RATIO = Number(process.env.RATIO ?? 0.08)

const requested = process.argv.slice(2)
const unknown = requested.filter((id) => !characterIds().includes(id))
if (unknown.length > 0) {
  console.error(`optimise-model: no such character: ${unknown.join(', ')}`)
  console.error(`Known characters: ${characterIds().join(', ')}`)
  process.exit(1)
}

const triangles = (document) =>
  document
    .getRoot()
    .listMeshes()
    .flatMap((mesh) => mesh.listPrimitives())
    .reduce((total, primitive) => {
      const indices = primitive.getIndices()
      const position = primitive.getAttribute('POSITION')
      return total + (indices ? indices.getCount() : (position?.getCount() ?? 0)) / 3
    }, 0)

const size = (path) => (statSync(path).size / 1048576).toFixed(1)

await MeshoptSimplifier.ready

for (const id of requested.length > 0 ? requested : characterIds()) {
  const source = join(DIR, `${id}.source.glb`)
  const target = join(DIR, `${id}.glb`)

  const io = new NodeIO()
  const document = await io.read(source)
  const before = triangles(document)

  await document.transform(
    // Welding merges coincident vertices, without which simplification cannot collapse edges.
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: RATIO, error: 0.0015 }),
    dedup(),
    prune(),
  )

  await io.write(target, document)

  console.log(`${id}: triangles ${Math.round(before).toLocaleString()} -> ${Math.round(triangles(document)).toLocaleString()}`)
  console.log(`${id}: file      ${size(source)}MB -> ${size(target)}MB`)
}
