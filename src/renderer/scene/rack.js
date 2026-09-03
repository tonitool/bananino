/**
 * Wears one thing at a time from a registry, in one slot of the rig.
 *
 * Both the hats and the shirt work this way, and they have to be separate racks rather
 * than one list: a shirt is not an alternative to a hat, so putting a crown on must not
 * take the polo off.
 *
 * A registry is a record of `{ label, build }`, where `build(context)` returns a Group and
 * a null `build` means bare. `build` may also decline by returning nothing — the shirt does
 * that for a character it is not cut for — which is bare too.
 *
 * The context is read through a function rather than stored, so a rebuild always fits
 * whoever is on stage now: the character can change underneath.
 */
export const createRack = ({ slot, registry, context }) => {
  let current = null
  let currentName = 'none'

  const resolve = (name) => (Object.hasOwn(registry, name) ? name : 'none')

  const wear = (name) => {
    if (current) {
      slot.remove(current)
      disposeGroup(current)
      current = null
    }

    currentName = resolve(name)
    const build = registry[currentName]?.build
    if (!build) return currentName

    current = build(context()) ?? null
    if (current) slot.add(current)
    return currentName
  }

  /** A different character is a different body: rebuild what is worn against the new one. */
  const refit = () => wear(currentName)

  return { wear, refit, current: () => currentName }
}

/**
 * Geometries, materials and their textures, all of which add up over a long session of
 * swapping. The textures matter more than they used to: the shirt paints its own, so
 * dropping one on every change would leak a canvas-sized texture each time.
 */
const disposeGroup = (group) => {
  group.traverse((child) => {
    if (!child.isMesh) return
    child.geometry?.dispose()

    for (const material of [child.material].flat().filter(Boolean)) {
      for (const value of Object.values(material)) {
        if (value?.isTexture) value.dispose()
      }
      material.dispose()
    }
  })
}
