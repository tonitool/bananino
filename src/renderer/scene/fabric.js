import { CanvasTexture, SRGBColorSpace } from 'three'

/**
 * Paints cloth: a colour, a pattern woven into it, and a printed design on top.
 *
 * One painter for the cap and the shirt, because a look has to mean the same thing on
 * both — a navy stripe on the cap and a different navy on the shirt is not an outfit.
 * Both are mapped the same way too: `u` runs around the garment with 0.5 dead centre
 * front, `v` runs up it.
 */

/**
 * How much further one step of `u` travels across a garment than one step of `v`.
 *
 * `u` wraps a whole circumference while `v` only covers a height, and these garments are
 * far wider around than they are tall, so anything drawn here has to be stretched by this
 * or it arrives squashed — a square logo came out as a four-to-one streak before this
 * existed. Patterns are drawn in this space deliberately: it is why the stripes below are
 * counted around the body rather than measured in pixels.
 */
export const printStretch = ({ width, height }) => (2 * Math.PI * width) / height

/**
 * Every pattern tiles a whole number of times around `u`, which is what keeps the seam up
 * the middle of the back from showing as a half-stripe. Drawn in texture space, so `x`
 * runs around the garment and `y` runs down it.
 *
 * `density` scales every count, because these garments are drawn at wildly different
 * sizes: a weave counted for the shirt's chest arrives on a forty-pixel cap crown as
 * noise, so the cap asks for a third of it.
 */
const PATTERNS = Object.freeze({
  /** Bands around the body, the way a knitted stripe actually runs. */
  stripe: (context, size, { accent, density }, stretch) => {
    // Counted so the bands come out roughly square-ish on the cloth rather than as
    // hairlines: v is compressed by `stretch`, so a band needs that much less of it.
    const bands = Math.max(3, Math.round(stretch * 1.6 * density))
    const step = size / bands
    context.fillStyle = accent
    for (let i = 0; i < bands; i += 2) context.fillRect(0, i * step, size, step)
  },

  /** Vertical stripes: panels down the garment, so counted around it. */
  panel: (context, size, { accent, density }) => {
    const panels = Math.max(4, Math.round(12 * density) * 2)
    const step = size / panels
    context.fillStyle = accent
    for (let i = 0; i < panels; i += 1) {
      if (i % 2 === 0) context.fillRect(i * step, 0, step, size)
    }
  },

  dots: (context, size, { accent, density }, stretch) => {
    const across = Math.max(4, Math.round(10 * density))
    const step = size / across
    const down = Math.max(2, Math.round(across / stretch))
    const rise = size / down
    context.fillStyle = accent
    for (let row = 0; row < down; row += 1) {
      for (let i = 0; i < across; i += 1) {
        // Offset alternate rows, so it reads as polka dots and not as a grid.
        const x = (i + (row % 2 ? 0.5 : 0)) * step
        context.beginPath()
        context.arc(x % size, (row + 0.5) * rise, step * 0.19, 0, Math.PI * 2)
        context.fill()
      }
    }
  },

  check: (context, size, { accent, density }, stretch) => {
    const across = Math.max(4, Math.round(12 * density))
    const down = Math.max(2, Math.round(across / stretch))
    context.fillStyle = accent
    for (let row = 0; row < down; row += 1) {
      for (let i = 0; i < across; i += 1) {
        if ((i + row) % 2) continue
        context.fillRect((i * size) / across, (row * size) / down, size / across + 1, size / down + 1)
      }
    }
  },

  /** A block of colour across the lower half — a hem band, or a two-tone cap. */
  band: (context, size, { accent }) => {
    context.fillStyle = accent
    context.fillRect(0, size * 0.62, size, size * 0.38)
  },
})

export const patternNames = () => Object.keys(PATTERNS)

/**
 * `area` is where a design may be printed: `u` around the garment, `v` up it, `size` how
 * far around it reaches, and `aspect` how much wider than tall the box is on the cloth.
 *
 * `aspect` exists because a cap front is not a square. The crown is barely thirty pixels
 * tall, so a square print on it would come out smaller than the shirt's — while sideways
 * there is room to spare. Two-to-one is what a cap is really printed at, and it is why a
 * wordmark belongs on the hat and a round mark on the chest.
 *
 * The box is described in cloth distances and drawn in texture space, where one step of u
 * covers `stretch` times more ground than one of v — hence the correction on the height.
 * A logo is scaled to fit and centred, never distorted, because a stretched logo is the
 * one thing a brand will not forgive.
 */
export const paintFabric = ({ look, logo, area, stretch, density = 1, size = 1024 }) => {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')

  context.fillStyle = look.color
  context.fillRect(0, 0, size, size)

  const pattern = look.pattern ? PATTERNS[look.pattern] : null
  if (pattern) pattern(context, size, { accent: look.accent ?? '#ffffff', density }, stretch)

  if (logo && area) {
    const aspect = area.aspect ?? 1
    const width = area.size * size
    const height = (width * stretch) / aspect
    const scale = Math.min(width / logo.width, width / (aspect * logo.height))

    context.drawImage(
      logo,
      area.u * size - (logo.width * scale) / 2,
      // v runs up the garment, a canvas runs down.
      (1 - area.v) * size - (logo.height * scale * stretch) / 2,
      logo.width * scale,
      logo.height * scale * stretch,
    )
  }

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/**
 * Fetches the collaboration logos once at boot, so painting stays synchronous — the racks
 * rebuild what is worn on every character swap, and a fetch per rebuild would show. A logo
 * that will not load is reported and skipped: the garment then wears plain, which is a
 * better failure than a bare character.
 */
export const loadLogos = async (files) => {
  const entries = await Promise.all(
    files.map(async (file) => {
      try {
        const image = new Image()
        image.src = `./shirt/${file}`
        await image.decode()
        return [file, image]
      } catch (error) {
        console.warn(`[look] logo "${file}" could not be loaded:`, error.message)
        return null
      }
    }),
  )
  return Object.fromEntries(entries.filter(Boolean))
}
