import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
} from 'three'

/*
 * A little desk clock that turns up beside the character when a meeting is close.
 *
 * Built from primitives for now: it is a placeholder for a real model, sitting behind the
 * same load/update contract the radio uses, so swapping assets/clock.mesh in later means
 * changing the loader, not the animation or the wiring.
 */
const FACE_RADIUS = 0.16
const BODY_DEPTH = 0.055
const DESK_HEIGHT = FACE_RADIUS + 0.035

const TAU = Math.PI * 2

const makeMaterial = (color, extra = {}) =>
  new MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.15, transparent: true, ...extra })

const makeHand = (length, width, material, z) => {
  const hand = new Mesh(new BoxGeometry(width, length, 0.006), material)
  hand.geometry.translate(0, length / 2, 0)
  hand.position.z = z
  return hand
}

export const loadClockScene = async ({ anchors }) => {
  const cocoa = makeMaterial(0x5b4636)
  const cream = makeMaterial(0xfff6e1, { roughness: 0.5 })
  const brass = makeMaterial(0xd9a13f, { roughness: 0.35, metalness: 0.6 })
  const red = makeMaterial(0xd9553f, { roughness: 0.45 })

  const body = new Mesh(new CylinderGeometry(FACE_RADIUS, FACE_RADIUS, BODY_DEPTH, 48), cocoa)
  body.rotation.x = Math.PI / 2

  const rim = new Mesh(new TorusGeometry(FACE_RADIUS, 0.016, 12, 48), brass)
  rim.position.z = BODY_DEPTH / 2

  const face = new Mesh(new CircleGeometry(FACE_RADIUS * 0.86, 40), cream)
  face.position.z = BODY_DEPTH / 2 + 0.002

  const tickMarks = new Group()
  for (let i = 0; i < 12; i += 1) {
    const mark = new Mesh(
      new BoxGeometry(i % 3 === 0 ? 0.012 : 0.006, 0.022, 0.004),
      cocoa,
    )
    const angle = (i / 12) * TAU
    mark.position.set(
      Math.sin(angle) * FACE_RADIUS * 0.72,
      Math.cos(angle) * FACE_RADIUS * 0.72,
      BODY_DEPTH / 2 + 0.006,
    )
    mark.rotation.z = -angle
    tickMarks.add(mark)
  }

  // Hands pivot at their base: the geometry is translated half a length up, so rotating
  // the mesh turns it around the pin, not its middle.
  const hourHand = makeHand(FACE_RADIUS * 0.44, 0.014, cocoa, BODY_DEPTH / 2 + 0.012)
  const minuteHand = makeHand(FACE_RADIUS * 0.66, 0.01, cocoa, BODY_DEPTH / 2 + 0.018)
  const secondHand = makeHand(FACE_RADIUS * 0.7, 0.004, red, BODY_DEPTH / 2 + 0.024)
  const pin = new Mesh(new CircleGeometry(0.012, 16), brass)
  pin.position.z = BODY_DEPTH / 2 + 0.028

  // Little feet, so it reads as a desk clock and not a floating disc.
  const footL = new Mesh(new BoxGeometry(0.05, 0.05, 0.03), brass)
  footL.position.set(-FACE_RADIUS * 0.55, -FACE_RADIUS - 0.012, 0)
  footL.rotation.z = 0.5
  const footR = footL.clone()
  footR.position.x = FACE_RADIUS * 0.55
  footR.rotation.z = -0.5

  const clock = new Group()
  clock.add(body, rim, face, tickMarks, hourHand, minuteHand, secondHand, pin, footL, footR)
  clock.position.y = DESK_HEIGHT

  const root = new Group()
  root.add(clock)
  // On the floor to the character's right — the radio owns the left. Re-run on a
  // character swap, since the measurements it stands beside change with the character.
  const place = ({ sideX, frontZ }) => root.position.set(sideX * 2.15, 0, frontZ * 0.55)
  place(anchors)
  root.rotation.y = -0.3

  const materials = [cocoa, cream, brass, red]
  let lastTick = -1

  /** `presence` is eased by the render loop; the hands read the real wall clock. */
  const update = ({ presence }) => {
    root.visible = presence > 0.005
    if (!root.visible) return

    root.scale.setScalar(0.4 + 0.6 * presence)
    for (const material of materials) material.opacity = presence

    const now = new Date()
    const seconds = now.getSeconds()
    const minutes = now.getMinutes() + seconds / 60
    const hours = (now.getHours() % 12) + minutes / 60

    hourHand.rotation.z = -(hours / 12) * TAU
    minuteHand.rotation.z = -(minutes / 60) * TAU
    // Stepped, not swept: a tick reads as *ticking*.
    secondHand.rotation.z = -(seconds / 60) * TAU

    // A small shiver on each tick makes the mechanism feel alive without any springs.
    if (seconds !== lastTick) {
      lastTick = seconds
      clock.rotation.z = 0.012
    }
    clock.rotation.z *= 0.82
  }

  const dispose = () => {
    for (const material of materials) material.dispose()
  }

  return { root, update, dispose, place }
}
