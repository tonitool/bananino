import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampToWorkArea,
  cornerBounds,
  hotCornerZone,
  panelPlacement,
  windowSize,
} from '../src/main/windowGeometry.js'
import { CORNERS, PANEL, SCREEN_MARGIN, WINDOW_SIZES } from '../src/main/constants.js'

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

test('the hot corner zone sits flush in the corner of the work area', () => {
  const zone = hotCornerZone({ workArea, corner: 'bottom-right', size: 28 })
  assert.deepEqual(zone, { x: 1484, y: 917, width: 28, height: 28 })
})

test('clamping keeps a window fully inside the work area', () => {
  const size = { width: 300, height: 300 }
  assert.deepEqual(clampToWorkArea({ x: -80, y: -80 }, size, workArea), { x: 0, y: 25 })
  assert.deepEqual(clampToWorkArea({ x: 9999, y: 9999 }, size, workArea), { x: 1212, y: 645 })
})
