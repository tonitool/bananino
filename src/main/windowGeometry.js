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
