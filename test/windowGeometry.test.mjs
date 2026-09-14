import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  boundsAtRest,
  clampToWorkArea,
  cornerBounds,
  hotCornerZone,
  panelPlacement,
  restingSpotFor,
  windowSize,
} from '../src/main/windowGeometry.js'
import { CORNERS, PANEL, SCREEN_MARGIN, WINDOW_SIZES } from '../src/main/constants.js'
import { isInside } from '../src/main/geometry.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const workArea = { x: 0, y: 25, width: 1512, height: 920 }

/** Where the character actually lands on screen, mirroring the renderer's CSS rules. */
const characterBox = (options) => {
  const bounds = cornerBounds({ workArea, ...options })
  const size = WINDOW_SIZES[options.sizeKey]
  const isAbove = panelPlacement(options.corner) === 'above'
  return {
    size,
    left: bounds.x + (bounds.width - size) / 2,
    top: isAbove ? bounds.y + bounds.height - size : bounds.y,
  }
}

test('the window keeps a constant width so only its height changes', () => {
  const closed = windowSize({ sizeKey: 'medium', isPanelOpen: false })
  const open = windowSize({ sizeKey: 'medium', isPanelOpen: true })

  assert.equal(closed.width, open.width)
  assert.equal(closed.height, WINDOW_SIZES.medium)
  assert.equal(open.height, WINDOW_SIZES.medium - PANEL.overlap + PANEL.height)
})

test('the panel opens away from the anchored corner', () => {
  assert.equal(panelPlacement('bottom-right'), 'above')
  assert.equal(panelPlacement('bottom-left'), 'above')
  assert.equal(panelPlacement('top-right'), 'below')
  assert.equal(panelPlacement('top-left'), 'below')
  assert.equal(panelPlacement('nonsense'), 'above')
})

for (const corner of Object.keys(CORNERS)) {
  test(`the character does not move when the panel opens (${corner})`, () => {
    // Regression: the character used to be pinned to the top of a window that grew
    // upwards, so it leapt hundreds of pixels away and swallowed the second click of a
    // double-click.
    for (const sizeKey of Object.keys(WINDOW_SIZES)) {
      assert.deepEqual(
        characterBox({ corner, sizeKey, isPanelOpen: false }),
        characterBox({ corner, sizeKey, isPanelOpen: true }),
        `${corner} / ${sizeKey}`,
      )
    }
  })
}

test('the anchored edges stay flush against the work area', () => {
  const open = cornerBounds({ workArea, corner: 'bottom-right', sizeKey: 'medium', isPanelOpen: true })
  assert.equal(open.x + open.width, workArea.width - SCREEN_MARGIN)
  assert.equal(open.y + open.height, workArea.y + workArea.height - SCREEN_MARGIN)
})

test('the top-left corner anchors to the work area origin, not the screen origin', () => {
  const bounds = cornerBounds({ workArea, corner: 'top-left', sizeKey: 'small', isPanelOpen: false })
  assert.equal(bounds.x, SCREEN_MARGIN)
  assert.equal(bounds.y, workArea.y + SCREEN_MARGIN)
})

test('an unknown corner falls back to bottom-right instead of throwing', () => {
  const bounds = cornerBounds({ workArea, corner: 'nowhere', sizeKey: 'medium', isPanelOpen: false })
  assert.equal(bounds.x + bounds.width, workArea.width - SCREEN_MARGIN)
})

test('the hot corner zone sits flush in the corner when nothing is in the way', () => {
  const zone = hotCornerZone({ workArea, corner: 'bottom-right', size: 28 })
  assert.deepEqual(zone, { x: 1484, y: 917, width: 28, height: 28 })
})

test('the hot corner reaches past the Dock to the screen’s own corner', () => {
  /*
   * The bug this is here for: the zone used to stop at the work area, which stops at the
   * Dock. With a Dock along the bottom — the default — the bottom-right work-area corner
   * is ~80px above the screen's corner, so shoving the pointer into the corner (the only
   * gesture the screen edge lets you make without aiming) parked it on the Dock, outside
   * the zone. It worked flawlessly for anyone who had hidden their Dock, which is how it
   * came to be reported as "doesn't work on some laptops".
   */
  const screenBounds = { x: 0, y: 0, width: 1512, height: 982 }
  const withDock = { x: 0, y: 38, width: 1512, height: 862 }

  const zone = hotCornerZone({ workArea: withDock, bounds: screenBounds, corner: 'bottom-right', size: 28 })
  assert.deepEqual(zone, { x: 1484, y: 872, width: 28, height: 110 })

  // The pixel in the very corner of the screen is now in the zone; it was not before.
  assert.equal(isInside({ x: 1511, y: 981 }, zone), true)
  assert.equal(isInside({ x: 1511, y: 981 }, hotCornerZone({ workArea: withDock, corner: 'bottom-right', size: 28 })), false)
  // And the band inside the work area still counts, so nothing that worked stops working.
  assert.equal(isInside({ x: 1500, y: 880 }, zone), true)
})

test('a top corner reaches up through the menu bar, and a side one out to the edge', () => {
  const screenBounds = { x: 0, y: 0, width: 1512, height: 982 }
  const withDock = { x: 0, y: 38, width: 1512, height: 862 }

  const top = hotCornerZone({ workArea: withDock, bounds: screenBounds, corner: 'top-left', size: 28 })
  assert.deepEqual(top, { x: 0, y: 0, width: 28, height: 66 })
  assert.equal(isInside({ x: 0, y: 0 }, top), true)

  // A Dock on the left moves the work area's left edge; the zone still starts at the screen.
  const leftDock = { x: 80, y: 38, width: 1432, height: 944 }
  const bottomLeft = hotCornerZone({ workArea: leftDock, bounds: screenBounds, corner: 'bottom-left', size: 28 })
  assert.equal(bottomLeft.x, 0)
  assert.equal(bottomLeft.width, 108)
  assert.equal(isInside({ x: 2, y: 981 }, bottomLeft), true)
})

test('clamping keeps a window fully inside the work area', () => {
  const size = { width: 300, height: 300 }
  assert.deepEqual(clampToWorkArea({ x: -80, y: -80 }, size, workArea), { x: 0, y: 25 })
  assert.deepEqual(clampToWorkArea({ x: 9999, y: 9999 }, size, workArea), { x: 1212, y: 645 })
})

test('a parked character does not move when the panel opens above it', () => {
  // Regression: always-visible mode reused the resting origin for the taller open
  // window, so the buddy slid down a panel's height on open and back up on close.
  const rest = [600, 400]
  const sizeKey = 'medium'
  const character = WINDOW_SIZES[sizeKey]

  const closed = boundsAtRest({ position: rest, placement: 'above', workArea, sizeKey, isPanelOpen: false })
  const open = boundsAtRest({
    position: rest, placement: 'above', workArea, sizeKey, isPanelOpen: true, panelHeight: 400,
  })

  // The character is pinned to the window's bottom edge when the panel hangs above it,
  // so its bottom edge is its home. The panel's arrival must not move it.
  assert.equal(open.x, closed.x)
  assert.equal(open.y + open.height, closed.y + closed.height)
  assert.equal(closed.y, rest[1])
  assert.equal(closed.height, character)
})

test('a parked character does not move when the panel opens below it', () => {
  // Pinned to the top edge, the window origin is the character's spot already.
  const rest = [600, 200]
  const closed = boundsAtRest({ position: rest, placement: 'below', workArea, sizeKey: 'medium', isPanelOpen: false })
  const open = boundsAtRest({
    position: rest, placement: 'below', workArea, sizeKey: 'medium', isPanelOpen: true, panelHeight: 400,
  })

  assert.equal(open.x, closed.x)
  assert.equal(open.y, closed.y)
})

test('restingSpotFor inverts boundsAtRest, so a drag with the panel open still remembers the resting spot', () => {
  const rest = [600, 400]
  const open = boundsAtRest({
    position: rest, placement: 'above', workArea, sizeKey: 'medium', isPanelOpen: true, panelHeight: 400,
  })

  assert.deepEqual(
    restingSpotFor({ origin: [open.x, open.y], placement: 'above', isPanelOpen: true, panelHeight: 400 }),
    rest,
  )
  // With the panel closed the two agree trivially — no growth to undo.
  assert.deepEqual(
    restingSpotFor({ origin: rest, placement: 'above', isPanelOpen: false, panelHeight: 400 }),
    rest,
  )
  // Panels below the character never shift the origin, either way.
  assert.deepEqual(
    restingSpotFor({ origin: [600, 200], placement: 'below', isPanelOpen: true, panelHeight: 400 }),
    [600, 200],
  )
})

test('the panel opens at the height it was left at, not at a default it has to correct', async () => {
  /*
   * The blink on opening. The measured height started at PANEL.height every launch, so the
   * first open animated the window to a size that was wrong, the renderer measured the
   * real one, and a second animated resize crossed the first — two animations over each
   * other, which is what you see. Remembering the height removes the correction, and a
   * correction that does arrive mid-open is applied without animation.
   *
   * Checked as text because perch.js reaches electron and cannot be imported under node.
   */
  const perch = await readFile(join(ROOT, 'src', 'main', 'perch.js'), 'utf8')
  assert.match(perch, /measuredHeight = getSettings\(\)\.panelHeight/)
  assert.match(perch, /saveSettings\(\{ panelHeight: next \}\)/)
  assert.match(perch, /animate: Date\.now\(\) - openedAt > PANEL_OPEN_SETTLE_MS/)

  // And the store has to keep it, or it is re-learnt on every launch regardless.
  const store = await readFile(join(ROOT, 'src', 'main', 'store.js'), 'utf8')
  assert.match(store, /panelHeight: Number\.isFinite/)
})
