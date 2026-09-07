import {
  CORNERS,
  PANEL,
  PANEL_PLACEMENT,
  SCREEN_MARGIN,
  SIDE_GUTTER,
  WINDOW_SIZES,
} from './constants.js'

/**
 * The window is anchored to a screen corner and only ever changes height, growing away
 * from that corner. Together with the character being pinned to the anchored edge, this
 * is what keeps it from sliding out from under the cursor when the panel opens.
 *
 * The width is deliberately constant — the extra area is fully click-through, so paying
 * for it while collapsed costs nothing and buys a character that never moves.
 */
export const windowSize = ({ sizeKey, isPanelOpen, panelHeight = PANEL.height }) => {
  const character = WINDOW_SIZES[sizeKey]
  // The gutter is always present so the width never changes, which is what keeps the
  // character from sliding sideways when something appears beside it.
  const width = Math.max(character, PANEL.width) + SIDE_GUTTER
  if (!isPanelOpen) return { width, height: character }
  return { width, height: character - PANEL.overlap + panelHeight }
}

export const panelPlacement = (corner) => PANEL_PLACEMENT[corner] ?? 'above'

/** Which edge the panel and character hug, so the gutter opens on the other side. */
export const panelSide = (corner) => ((CORNERS[corner] ?? CORNERS['bottom-right']).x === 1 ? 'right' : 'left')

export const cornerBounds = ({ workArea, corner, sizeKey, isPanelOpen, panelHeight }) => {
  const { width, height } = windowSize({ sizeKey, isPanelOpen, panelHeight })
  const anchor = CORNERS[corner] ?? CORNERS['bottom-right']

  return {
    width,
    height,
    x: Math.round(
      anchor.x === 1
        ? workArea.x + workArea.width - width - SCREEN_MARGIN
        : workArea.x + SCREEN_MARGIN,
    ),
    y: Math.round(
      anchor.y === 1
        ? workArea.y + workArea.height - height - SCREEN_MARGIN
        : workArea.y + SCREEN_MARGIN,
    ),
  }
}

/** The small square of screen that summons the character. */
export const hotCornerZone = ({ workArea, corner, size }) => {
  const anchor = CORNERS[corner] ?? CORNERS['bottom-right']
  return {
    x: anchor.x === 1 ? workArea.x + workArea.width - size : workArea.x,
    y: anchor.y === 1 ? workArea.y + workArea.height - size : workArea.y,
    width: size,
    height: size,
  }
}

export const clampToWorkArea = ({ x, y }, { width, height }, workArea) => ({
  x: Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - width),
  y: Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - height),
})

/** How much taller the panel makes the window. The width never changes — see windowSize. */
const panelGrowth = (panelHeight = PANEL.height) => panelHeight - PANEL.overlap

/**
 * Always-visible mode remembers the character's resting spot — the window's origin with
 * the panel shut — not the window's origin. Opening the panel makes the window taller,
 * and the character is pinned to one edge of it: with the panel hanging above, the window
 * has to start higher by exactly the growth, or the buddy slides down when the panel
 * arrives and jumps back up when the panel leaves.
 */
export const boundsAtRest = ({ position, placement, workArea, sizeKey, isPanelOpen, panelHeight }) => {
  const size = windowSize({ sizeKey, isPanelOpen, panelHeight })
  const growth = placement === 'above' && isPanelOpen ? panelGrowth(panelHeight) : 0
  const origin = { x: position[0], y: position[1] - growth }
  return { ...size, ...clampToWorkArea(origin, size, workArea) }
}

/**
 * The inverse for saving: the window's origin mid-drag is only the resting spot when the
 * panel is shut. Dragging with the panel open used to save the open origin, and closing
 * dropped the character at what had been the panel's top edge.
 */
export const restingSpotFor = ({ origin, placement, isPanelOpen, panelHeight }) => {
  const growth = placement === 'above' && isPanelOpen ? panelGrowth(panelHeight) : 0
  return [origin[0], origin[1] + growth]
}
