import { app, screen } from 'electron'
import {
  BLUR_GRACE_MS,
  CONCEAL_ANIMATION_MS,
  CONCEAL_DELAY_MS,
  FOCUS_SETTLE_MS,
  HOT_CORNER_DWELL_MS,
  HOT_CORNER_SIZE_PX,
  IPC,
  MIN_PANEL_HEIGHT,
  PANEL,
  PANEL_CLOSE_FADE_MS,
  SCREEN_MARGIN,
  WINDOW_SIZES,
} from './constants.js'
import { isInside } from './geometry.js'
import {
  clampToWorkArea,
  cornerBounds,
  hotCornerZone,
  panelPlacement,
  panelSide,
  windowSize,
} from './windowGeometry.js'

/**
 * Where the character lives and when it is on screen.
 *
 * Docked is the default: the window is hidden until the cursor rests in the chosen screen
 * corner, and tucks itself away again once the cursor has been elsewhere for a moment.
 * "Always visible" turns all of that off and lets the character be dragged anywhere.
 */
export const createPerch = ({
  win,
  getSettings,
  saveSettings,
  interaction,
  isPinned = () => false,
}) => {
  let isPanelOpen = false
  let cornerSince = null
  let awaySince = null
  let openedAt = 0
  let focusedAt = 0
  let hideTimer = null
  let closeBoundsTimer = null
  let measuredHeight = PANEL.height

  const workArea = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea

  const panelHeight = () => measuredHeight

  const restingBounds = () => {
    const { corner, sizeKey, alwaysVisible, position } = getSettings()
    const area = workArea()
    const height = panelHeight()
    const anchored = cornerBounds({ workArea: area, corner, sizeKey, isPanelOpen, panelHeight: height })
    if (!alwaysVisible || !position) return anchored

    const size = windowSize({ sizeKey, isPanelOpen, panelHeight: height })
    return { ...size, ...clampToWorkArea({ x: position[0], y: position[1] }, size, area) }
  }

  const notify = ({ leaving = false } = {}) => {
    if (win.isDestroyed()) return
    // The renderer lays itself out from these, so main stays the single source of truth.
    win.webContents.send(IPC.panelState, {
      isPanelOpen,
      isRevealed: win.isVisible() && !leaving,
      characterSize: WINDOW_SIZES[getSettings().sizeKey],
      panelHeight: panelHeight(),
      panelOverlap: PANEL.overlap,
      placement: panelPlacement(getSettings().corner),
      side: panelSide(getSettings().corner),
      panelWidth: PANEL.width,
    })
  }

  /**
   * The window is created non-resizable so nobody can drag its edges, but on macOS that
   * also pins its maximum size to whatever it currently is — so setBounds could shrink it
   * and never grow it. The panel then rendered at full height while the window stayed
   * collapsed, leaving everything past the fold outside the window and unclickable.
   */
  /**
   * `animate` uses macOS's own window resize animation, which matters when the panel opens
   * or a view changes height — the window otherwise snaps to its new size while the panel
   * fades, and the snap is what reads as stuttering.
   */
  const applyBounds = ({ animate = false } = {}) => {
    if (win.isDestroyed()) return
    const bounds = restingBounds()

    // Setting identical bounds mid-animation restarts it, which reads as a stutter.
    const current = win.getBounds()
    const unchanged =
      current.x === bounds.x &&
      current.y === bounds.y &&
      current.width === bounds.width &&
      current.height === bounds.height

    if (!unchanged) {
      win.setResizable(true)
      win.setBounds(bounds, animate)
      win.setResizable(false)
    }

    notify()
  }

  const reveal = () => {
    // Cancels a fade-out already under way, so a quick out-and-back does not blink.
    clearTimeout(hideTimer)
    hideTimer = null

    applyBounds()
    if (!win.isVisible()) win.showInactive()
    awaySince = null
    notify()
  }

  const conceal = () => {
    if (getSettings().alwaysVisible || isPinned()) return
    if (hideTimer) return

    setPanelOpen(false)
    cornerSince = null
    awaySince = null

    // Tell the renderer to animate out first; the window goes away once it has.
    notify({ leaving: true })
    hideTimer = setTimeout(() => {
      hideTimer = null
      if (!win.isDestroyed() && win.isVisible()) win.hide()
      notify()
    }, CONCEAL_ANIMATION_MS)
  }

  const setPanelOpen = (next) => {
    if (isPanelOpen === next) return
    isPanelOpen = next
    openedAt = next ? Date.now() : 0
    if (next) focusedAt = 0
    // Asserted here rather than left to the renderer: the panel is only useful clickable.
    interaction?.setInteractive(next)

    if (next) {
      clearTimeout(closeBoundsTimer)
      closeBoundsTimer = null
      applyBounds({ animate: true })
      // The panel has text fields, so the window has to be able to take keyboard focus.
      if (!win.isVisible()) win.showInactive()
      // An accessory app has to claim activation explicitly before a field can take keys.
      app.focus({ steal: true })
      win.focus()
    } else {
      // The renderer melts the panel into the character first; the window only shrinks
      // after the fade, so the character itself never moves on close.
      notify()
      closeBoundsTimer = setTimeout(() => {
        closeBoundsTimer = null
        if (!isPanelOpen) applyBounds({ animate: true })
      }, PANEL_CLOSE_FADE_MS)
      win.blur()
      return
    }
    notify()
  }

  /** Fed every cursor sample by the tracker, so this needs no timer of its own. */
  const handleCursor = (point) => {
    const { alwaysVisible, corner } = getSettings()
    if (alwaysVisible) return

    const now = Date.now()
    const zone = hotCornerZone({ workArea: workArea(), corner, size: HOT_CORNER_SIZE_PX })
    const inCorner = isInside(point, zone)

    if (!inCorner) cornerSince = null
    else {
      cornerSince ??= now
      if (now - cornerSince >= HOT_CORNER_DWELL_MS && !win.isVisible()) reveal()
    }

    if (!win.isVisible() || isPanelOpen) return

    const nearby = inCorner || isInside(point, win.getBounds())
    if (nearby) return void (awaySince = null)

    awaySince ??= now
    if (now - awaySince >= CONCEAL_DELAY_MS) conceal()
  }

  /** Switching modes re-places the window rather than leaving it stranded mid-screen. */
  const setAlwaysVisible = (alwaysVisible) => {
    saveSettings({ alwaysVisible })
    if (alwaysVisible) reveal()
    else if (!isPanelOpen) conceal()
  }

  return {
    reveal,
    conceal,
    applyBounds,
    setPanelOpen,
    togglePanel: () => setPanelOpen(!isPanelOpen),
    isPanelOpen: () => isPanelOpen,
    /**
     * The renderer measures the panel and reports it here, so the window is always exactly
     * as tall as the content needs — no empty space, nothing clipped.
     */
    setPanelHeight: (height) => {
      if (!Number.isFinite(height)) return

      const area = workArea()
      const character = WINDOW_SIZES[getSettings().sizeKey]
      const ceiling = area.height - SCREEN_MARGIN * 2 - character + PANEL.overlap
      const next = Math.round(Math.min(Math.max(height, MIN_PANEL_HEIGHT), ceiling))

      if (Math.abs(next - measuredHeight) < 3) return
      measuredHeight = next
      if (isPanelOpen) applyBounds({ animate: true })
      else notify()
    },
    /**
     * A blur only counts as "clicked away" once focus actually landed and stayed put.
     * Without both checks, the flicker during app activation closes the panel instantly.
     */
    canDismissOnBlur: () =>
      isPanelOpen &&
      !isPinned() &&
      focusedAt > 0 &&
      Date.now() - openedAt > BLUR_GRACE_MS &&
      Date.now() - focusedAt > FOCUS_SETTLE_MS,
    noteFocus: () => (focusedAt = Date.now()),
    handleCursor,
    setAlwaysVisible,
    notify,
  }
}
