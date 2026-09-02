/**
 * Owns whether the window swallows clicks or lets them fall through to the desktop.
 *
 * `isLocked` wins over any request to become click-through. With the panel open the whole
 * window must stay clickable, and two separate callers would otherwise turn it off: the
 * renderer's hover tracking (hovering the panel is "not hovering the character") and the
 * cursor tracker's safety net (the pointer briefly left the window). Either one left a
 * visible panel that clicks fell straight through.
 */
export const createClickThrough = ({ win, isLocked = () => false }) => {
  let interactive = false

  const setInteractive = (next) => {
    const target = Boolean(next) || isLocked()
    if (interactive === target || win.isDestroyed()) return
    interactive = target
    // Forwarding keeps mousemove flowing so the renderer can tell when to become clickable.
    win.setIgnoreMouseEvents(!target, { forward: true })
  }

  return { setInteractive, isInteractive: () => interactive }
}
