import { NodeIO } from '@gltf-transform/core'
import { dedup, prune, simplify, weld } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import { statSync } from 'node:fs'

/**
 * The supplied model is a photogrammetry-style export: nearly a million triangles for a
 * character drawn at a few hundred pixels. That is invisible detail at this size, but it
 * is most of the app's download and all of its GPU cost.
 *
 * Reads assets/character.source.glb and writes assets/character.glb, so the original is
 * always kept and this can be re-run with a different ratio.
 */
const SOURCE = 'assets/character.source.glb'
const TARGET = 'assets/character.glb'
const RATIO = Number(process.env.RATIO ?? 0.08)

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

await MeshoptSimplifier.ready

const io = new NodeIO()
const document = await io.read(SOURCE)
const before = triangles(document)

await document.transform(
  // Welding merges coincident vertices, without which simplification cannot collapse edges.
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: RATIO, error: 0.0015 }),
  dedup(),
  prune(),
)

await io.write(TARGET, document)

const size = (path) => (statSync(path).size / 1048576).toFixed(1)
console.log(`triangles ${Math.round(before).toLocaleString()} -> ${Math.round(triangles(document)).toLocaleString()}`)
console.log(`file      ${size(SOURCE)}MB -> ${size(TARGET)}MB`)
