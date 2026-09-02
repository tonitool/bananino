import { Box3, Raycaster, Vector3 } from 'three'

const DOWN = new Vector3(0, -1, 0)

/** Rays start outside the model and travel inwards to find its surface. */
const OUTSIDE = 4

/**
 * Measures where a hat, glasses or headphones should sit by probing the mesh itself,
 * rather than hard-coding numbers that only suit one model.
 */
export const measureAnchors = (model) => {
  const raycaster = new Raycaster()
  const bounds = new Box3().setFromObject(model)
  const size = bounds.getSize(new Vector3())
  const centre = bounds.getCenter(new Vector3())

  const hit = (origin, direction) => {
    raycaster.set(origin, direction)
    return raycaster.intersectObject(model, true)[0]?.point ?? null
  }

  const sideX = measureSide({ hit, centre, bounds, size })
  const profile = measureHeadProfile({ model, centre, sideX })

  return {
    height: size.y,
    /** Eye line, as a proportion of height — where the face is painted on this model. */
    eyeY: bounds.min.y + size.y * EYE_HEIGHT_RATIO,
    frontZ: measureFront({ hit, centre, bounds, size }),
    sideX,
    /**
     * The height at which the head is `radius` wide — where a band of that radius would
     * actually come to rest. The head is a dome, so a hat seated at a single fixed height
     * either floats above it or sinks inside it.
     */
    ringY: (radius) => ringHeight(profile, radius),
  }
}

/**
 * The head profile is read straight from the vertex data in one pass.
 *
 * This used to be 288 raycasts — 24 radii by 12 rays — against a mesh of nearly a million
 * triangles, which took a visible moment on every launch. Scanning the positions once is
 * the same measurement for a fraction of the work.
 */
const PROFILE_BUCKETS = 24
const PROFILE_SECTORS = 12

const measureHeadProfile = ({ model, centre, sideX }) => {
  const maxRadius = sideX * 1.35
  // Highest point per (radius, angle) cell, so a thin stem occupies one sector and is
  // then discarded by taking the median across sectors — as the ring of rays did.
  const cells = Array.from({ length: PROFILE_BUCKETS }, () =>
    new Float32Array(PROFILE_SECTORS).fill(Number.NEGATIVE_INFINITY),
  )

  const vertex = new Vector3()

  model.traverse((child) => {
    const positions = child.isMesh ? child.geometry?.attributes?.position : null
    if (!positions) return

    for (let i = 0; i < positions.count; i += 1) {
      vertex.fromBufferAttribute(positions, i).applyMatrix4(child.matrixWorld)

      const dx = vertex.x - centre.x
      const dz = vertex.z - centre.z
      const radius = Math.hypot(dx, dz)
      if (radius > maxRadius) continue

      const bucket = Math.min(PROFILE_BUCKETS - 1, Math.floor((radius / maxRadius) * PROFILE_BUCKETS))
      const angle = Math.atan2(dz, dx) + Math.PI
      const sector = Math.min(PROFILE_SECTORS - 1, Math.floor((angle / (Math.PI * 2)) * PROFILE_SECTORS))

      if (vertex.y > cells[bucket][sector]) cells[bucket][sector] = vertex.y
    }
  })

  const profile = []
  for (let bucket = 0; bucket < PROFILE_BUCKETS; bucket += 1) {
    const heights = [...cells[bucket]].filter(Number.isFinite).sort((a, b) => a - b)
    if (heights.length === 0) continue
    profile.push({
      radius: ((bucket + 0.5) / PROFILE_BUCKETS) * maxRadius,
      y: heights[Math.floor(heights.length / 2)],
    })
  }
  return profile
}

/** Linear interpolation across the sampled profile, clamped at both ends. */
const ringHeight = (profile, radius) => {
  if (profile.length === 0) return 0
  if (radius <= profile[0].radius) return profile[0].y

  for (let i = 1; i < profile.length; i += 1) {
    const previous = profile[i - 1]
    const current = profile[i]
    if (radius > current.radius) continue

    const span = current.radius - previous.radius
    const t = span > 0 ? (radius - previous.radius) / span : 0
    return previous.y + (current.y - previous.y) * t
  }
  return profile[profile.length - 1].y
}

/** Taken from where the face is painted on the supplied model's texture. */
const EYE_HEIGHT_RATIO = 0.62

const measureFront = ({ hit, centre, bounds, size }) => {
  const y = bounds.min.y + size.y * EYE_HEIGHT_RATIO
  const point = hit(
    new Vector3(centre.x, y, bounds.max.z + OUTSIDE),
    new Vector3(0, 0, -1),
  )
  return point ? point.z : bounds.max.z
}

/** Half-width at head height — the arms make the overall bounding box far too wide. */
const measureSide = ({ hit, centre, bounds, size }) => {
  const y = bounds.min.y + size.y * 0.72
  const point = hit(
    new Vector3(bounds.max.x + OUTSIDE, y, centre.z),
    new Vector3(-1, 0, 0),
  )
  return point ? Math.abs(point.x - centre.x) : size.x / 2
}
