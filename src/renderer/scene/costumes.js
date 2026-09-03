import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three'

/**
 * Costumes are built from primitives rather than loaded as assets: the character is a
 * single static mesh with no skeleton, so there is nothing to rig clothing onto, and a
 * few cones and tori parented to the pivot follow every hop and dance for free.
 *
 * Everything is expressed relative to measured anchors, so a swapped-in model still gets
 * its hat on its head.
 */

const matte = (color) => new MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.02 })
const metal = (color) => new MeshStandardMaterial({ color, roughness: 0.24, metalness: 0.95 })
const glass = (color) => new MeshStandardMaterial({ color, roughness: 0.12, metalness: 0.7 })

const COLORS = Object.freeze({
  partyPink: 0xff6f91,
  partyCream: 0xfff2b2,
  santaRed: 0xd0263c,
  snow: 0xfbfbfb,
  charcoal: 0x33383f,
  slate: 0x24282e,
  gold: 0xf2c14e,
  wool: 0x5b8fb9,
})

const partyHat = ({ ringY, sideX }) => {
  const group = new Group()
  const radius = sideX * 0.55

  const cone = new Mesh(new ConeGeometry(radius, radius * 2.5, 28), matte(COLORS.partyPink))
  cone.position.y = radius * 1.25

  const pom = new Mesh(new SphereGeometry(radius * 0.3, 16, 12), matte(COLORS.partyCream))
  pom.position.y = radius * 2.6

  group.add(cone, pom)
  group.position.set(0, ringY(radius) - radius * 0.1, 0)
  group.rotation.z = -0.2
  return group
}

const santaHat = ({ ringY, sideX }) => {
  const group = new Group()
  const radius = sideX * 0.62

  const cone = new Mesh(new ConeGeometry(radius, radius * 2.3, 28), matte(COLORS.santaRed))
  cone.position.y = radius * 1.15

  const brim = new Mesh(new TorusGeometry(radius, radius * 0.26, 12, 32), matte(COLORS.snow))
  brim.rotation.x = Math.PI / 2

  const pom = new Mesh(new SphereGeometry(radius * 0.34, 16, 12), matte(COLORS.snow))
  pom.position.set(radius * 0.5, radius * 2.2, 0)

  group.add(cone, brim, pom)
  group.position.set(0, ringY(radius), 0)
  group.rotation.z = -0.24
  return group
}

const headphones = ({ eyeY, sideX }) => {
  const group = new Group()
  // Wider than the head so the band arcs clear over it instead of sinking into the dome,
  // which is exactly where the ear cups want to be anyway.
  const span = sideX * 1.12

  // A half torus in the XY plane arcs neatly from ear to ear over the top of the head.
  const band = new Mesh(
    new TorusGeometry(span, span * 0.085, 10, 40, Math.PI),
    matte(COLORS.charcoal),
  )

  const cupGeometry = new CylinderGeometry(span * 0.3, span * 0.3, span * 0.18, 20)
  for (const side of [-1, 1]) {
    const cup = new Mesh(cupGeometry, matte(COLORS.slate))
    cup.rotation.z = Math.PI / 2
    cup.position.x = side * span
    group.add(cup)
  }

  group.add(band)
  // Raised until the whole arc clears the dome; the ears sit high on this character.
  group.position.set(0, eyeY + sideX * 0.17, 0)
  return group
}

const shades = ({ eyeY, frontZ, sideX }) => {
  const group = new Group()
  const lensRadius = sideX * 0.3
  const offset = lensRadius * 1.05

  const lensGeometry = new CylinderGeometry(lensRadius, lensRadius, lensRadius * 0.18, 24)
  const lensMaterial = glass(COLORS.slate)

  for (const side of [-1, 1]) {
    const lens = new Mesh(lensGeometry, lensMaterial)
    // The cylinder's axis runs up Y by default; tipping it forward faces the disc at us.
    lens.rotation.x = Math.PI / 2
    lens.position.x = side * offset
    group.add(lens)
  }

  const bridge = new Mesh(
    new BoxGeometry(offset, lensRadius * 0.2, lensRadius * 0.2),
    matte(COLORS.slate),
  )
  group.add(bridge)

  group.position.set(0, eyeY, frontZ + lensRadius * 0.1)
  return group
}

const crown = ({ ringY, sideX }) => {
  const group = new Group()
  // Seated on a wider part of the head so the band is visible, not swallowed by the dome.
  const radius = sideX * 0.82
  const gold = metal(COLORS.gold)
  const goldBand = metal(COLORS.gold)
  goldBand.side = DoubleSide

  const band = new Mesh(
    new CylinderGeometry(radius, radius, radius * 0.55, 24, 1, true),
    goldBand,
  )
  band.position.y = radius * 0.275
  group.add(band)

  const spikeGeometry = new ConeGeometry(radius * 0.22, radius * 0.6, 10)
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2
    const spike = new Mesh(spikeGeometry, gold)
    spike.position.set(Math.cos(angle) * radius, radius * 0.85, Math.sin(angle) * radius)
    group.add(spike)
  }

  group.position.set(0, ringY(radius) - radius * 0.12, 0)
  return group
}

const beanie = ({ ringY, sideX }) => {
  const group = new Group()
  const radius = sideX * 0.9

  const dome = new Mesh(
    new SphereGeometry(radius, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    matte(COLORS.wool),
  )

  const brim = new Mesh(new TorusGeometry(radius, radius * 0.16, 12, 32), matte(COLORS.snow))
  brim.rotation.x = Math.PI / 2

  const bobble = new Mesh(new SphereGeometry(radius * 0.24, 16, 12), matte(COLORS.snow))
  bobble.position.y = radius * 1.05

  group.add(dome, brim, bobble)
  group.position.set(0, ringY(radius) - radius * 0.06, 0)
  return group
}

export const COSTUMES = Object.freeze({
  none: { label: 'None', emoji: '🚫', build: null },
  party: { label: 'Party', emoji: '🎉', build: partyHat },
  santa: { label: 'Santa', emoji: '🎅', build: santaHat },
  headphones: { label: 'Headphones', emoji: '🎧', build: headphones },
  shades: { label: 'Shades', emoji: '🕶️', build: shades },
  crown: { label: 'Crown', emoji: '👑', build: crown },
  beanie: { label: 'Beanie', emoji: '🧢', build: beanie },
})
