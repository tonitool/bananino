/**
 * The main process owns the window's geometry; the renderer mirrors it into CSS variables
 * so the character and the panel always agree on where the seam between them is.
 */
export const applyLayout = (stage, { isPanelOpen, placement, ...sizes }) => {
  const root = document.documentElement
  const variables = {
    '--character-size': sizes.characterSize,
    '--panel-height': sizes.panelHeight,
    '--panel-overlap': sizes.panelOverlap,
    '--panel-width': sizes.panelWidth,
  }

  for (const [name, value] of Object.entries(variables)) {
    if (Number.isFinite(value)) root.style.setProperty(name, `${value}px`)
  }

  stage.dataset.panel = isPanelOpen ? 'open' : 'closed'
  stage.dataset.place = placement === 'below' ? 'below' : 'above'
  stage.dataset.side = sizes.side === 'left' ? 'left' : 'right'
  // Drives the entrance and exit animation; the window is only hidden once it has played.
  stage.dataset.presence = isPanelOpen || sizes.isRevealed !== false ? 'in' : 'out'
}

/** Cursor arrives in window pixels; the character only occupies part of that window. */
export const toCanvasCursor = (cursor, canvas) => {
  const rect = canvas.getBoundingClientRect()
  return {
    x: cursor.x - rect.left,
    y: cursor.y - rect.top,
    screenX: cursor.screenX,
    screenY: cursor.screenY,
    width: rect.width,
    height: rect.height,
  }
}
