import { NodeIO } from '@gltf-transform/core'
import { dedup, prune, simplify, weld } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import { statSync } from 'node:fs'

/**
 * Turns a generated garment into something wearable.
 *
 * The supplied shirt is a Tripo export like the characters: 27 MB and nearly a million
 * triangles for something drawn about eighty pixels wide. Three things are wrong with it
 * as a garment, and all three are fixed here rather than at runtime, so the app only ever
 * loads a small mesh and paints it:
 *
 *   - Its hem is a sealed disc, so worn as-is the character's lower body would cross the
 *     shirt's own skin. It is cut off, leaving an open tube with sleeves and a collar.
 *   - Its UVs are a photogrammetry scatter — the chest alone sprays across 83% of the
 *     atlas — so a brand's logo could never be painted into them. Fresh cylindrical ones
 *     are projected on instead: u around the body from the middle of the chest, v up from
 *     the hem, which is the map the print areas in shirts.js are described against.
 *   - Its own 4 MB colour texture is dead weight, because the shirt's surface is painted
 *     at runtime. It goes, and takes most of the file size with it.
 *
 * The result is yawed to face the app's front and stood with its hem at the origin, so
 * placing it on a character is a scale and a height.
 */
const SOURCE = 'assets/costumes/polo.source.glb'
const TARGET = 'assets/costumes/polo.glb'

/**
 * How much to take off the bottom, as a fraction of the model's height — enough to lose the
 * disc that seals the hem and nothing more.
 *
 * Only the hem is cut. The neck hole is already open, and the neckband is worth keeping
 * even though its hole is far narrower than the body that goes through it: the band ends up
 * buried inside the character, and what shows is the yoke running into the body, which is
 * a neckline. An earlier bake cut the top off at 0.88 to make room, and all that achieved
 * was a strapless tube.
 */
const HEM = 0.06

/** A garment carries no detail worth keeping; this is plenty for its silhouette. */
const TARGET_TRIANGLES = Number(process.env.TRIANGLES ?? 4500)

/** Matches the characters: the source faces +X, and a quarter turn puts it towards us. */
const YAW = -Math.PI / 2

const io = new NodeIO()
const document = await io.read(SOURCE)
const primitive = document.getRoot().listMeshes()[0].listPrimitives()[0]

const position = primitive.getAttribute('POSITION')
const normal = primitive.getAttribute('NORMAL')
const indices = primitive.getIndices()
if (!position || !indices) throw new Error(`${SOURCE} has no indexed positions to work with.`)

const before = indices.getCount() / 3
const points = position.getArray()
const normals = normal?.getArray()
const triangles = indices.getArray()

let minY = Infinity
let maxY = -Infinity
for (let i = 1; i < points.length; i += 3) {
  minY = Math.min(minY, points[i])
  maxY = Math.max(maxY, points[i])
}
const height = maxY - minY
const hemY = minY + height * HEM

/*
 * A triangle is kept only if all three of its corners are above the cut, which leaves a
 * clean rim rather than a fringe of half-triangles.
 */
const kept = []
for (let t = 0; t < triangles.length; t += 3) {
  const above = [0, 1, 2].every((corner) => points[triangles[t + corner] * 3 + 1] >= hemY)
  if (above) kept.push(triangles[t], triangles[t + 1], triangles[t + 2])
}

/** Only the vertices the surviving triangles actually use, renumbered from zero. */
const renumbered = new Map()
const keptPoints = []
const keptNormals = []
const keptIndices = new Uint32Array(kept.length)

kept.forEach((old, at) => {
  let index = renumbered.get(old)
  if (index === undefined) {
    index = renumbered.size
    renumbered.set(old, index)
    // Yawed as it is copied, so the baked shirt faces the way the app does.
    const [x, y, z] = [points[old * 3], points[old * 3 + 1], points[old * 3 + 2]]
    keptPoints.push(x * Math.cos(YAW) + z * Math.sin(YAW), y, -x * Math.sin(YAW) + z * Math.cos(YAW))

    if (normals) {
      const [nx, ny, nz] = [normals[old * 3], normals[old * 3 + 1], normals[old * 3 + 2]]
      keptNormals.push(
        nx * Math.cos(YAW) + nz * Math.sin(YAW),
        ny,
        -nx * Math.sin(YAW) + nz * Math.cos(YAW),
      )
    }
  }
  keptIndices[at] = index
})

/** Stood with its hem on the floor and centred, so placing it is a scale and a height. */
const centre = [0, 2].map((axis) => {
  let lo = Infinity
  let hi = -Infinity
  for (let i = axis; i < keptPoints.length; i += 3) {
    lo = Math.min(lo, keptPoints[i])
    hi = Math.max(hi, keptPoints[i])
  }
  return (lo + hi) / 2
})
let floor = Infinity
for (let i = 1; i < keptPoints.length; i += 3) floor = Math.min(floor, keptPoints[i])

for (let i = 0; i < keptPoints.length; i += 3) {
  keptPoints[i] -= centre[0]
  keptPoints[i + 1] -= floor
  keptPoints[i + 2] -= centre[1]
}

position.setArray(new Float32Array(keptPoints))
if (normal && keptNormals.length > 0) normal.setArray(new Float32Array(keptNormals))
indices.setArray(keptIndices)

/*
 * The scattered UVs go before welding rather than after: weld compares every attribute, so
 * leaving them on would keep the mesh split along every seam in that atlas and give the
 * simplifier almost nothing it is allowed to collapse.
 */
primitive.setAttribute('TEXCOORD_0', null)
for (const texture of document.getRoot().listTextures()) texture.dispose()
for (const material of document.getRoot().listMaterials()) {
  material.setBaseColorFactor([1, 1, 1, 1])
}

const cut = indices.getCount() / 3
await MeshoptSimplifier.ready
await document.transform(
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: TARGET_TRIANGLES / cut, error: 0.01 }),
  dedup(),
  prune(),
)

/*
 * Cylindrical UVs, projected after simplifying because that is when the vertices stop
 * moving. u runs around the body with 0.5 in the middle of the chest and the seam up the
 * middle of the back; v runs from hem to the top of the collar. The sleeves smear under this, which
 * costs nothing — nothing is ever printed on a sleeve.
 */
const finalPosition = primitive.getAttribute('POSITION')
const finalPoints = finalPosition.getArray()
let top = 0
for (let i = 1; i < finalPoints.length; i += 3) top = Math.max(top, finalPoints[i])

const uvs = new Float32Array((finalPoints.length / 3) * 2)
for (let i = 0, uv = 0; i < finalPoints.length; i += 3, uv += 2) {
  const angle = Math.atan2(finalPoints[i], finalPoints[i + 2])
  uvs[uv] = 0.5 + angle / (Math.PI * 2)
  uvs[uv + 1] = finalPoints[i + 1] / top
}

primitive.setAttribute(
  'TEXCOORD_0',
  document.createAccessor().setType('VEC2').setArray(uvs),
)

await io.write(TARGET, document)

const size = (path) => (statSync(path).size / 1048576).toFixed(2)
const after = primitive.getIndices().getCount() / 3
console.log(`bake-garment: ${SOURCE} -> ${TARGET}`)
console.log(`  cut       hem below ${HEM} of its height; neck and collar kept`)
console.log(`  triangles ${Math.round(before).toLocaleString()} -> ${Math.round(cut).toLocaleString()} cut -> ${Math.round(after).toLocaleString()} simplified`)
console.log(`  textures  ${document.getRoot().listTextures().length} left (0 means the shirt is ours to paint)`)
console.log(`  file      ${size(SOURCE)}MB -> ${size(TARGET)}MB`)
