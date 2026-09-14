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
  PANEL_OPEN_SETTLE_MS,
  WINDOW_ANIMATION_MS,
  SCREEN_MARGIN,
  WINDOW_SIZES,
} from './constants.js'
import { isInside } from './geometry.js'
import {
  boundsAtRest,
  cornerBounds,
  hotCornerZone,
  panelPlacement,
  panelSide,
  restingSpotFor,
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
  // Where the last session left it, so the first open does not have to correct itself.
  let measuredHeight = getSettings().panelHeight ?? PANEL.height

  /*
   * The display under the cursor, not the primary one: on a second screen the corner has
   * to be that screen's corner. Both rectangles are kept — the window is placed inside the
   * work area so it never hides under the Dock, while the hot corner reaches past it to
   * the screen's own edge.
   */
  const display = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const workArea = () => display().workArea

  const panelHeight = () => measuredHeight

  const restingBounds = () => {
    const { corner, sizeKey, alwaysVisible, position } = getSettings()
    const area = workArea()
    const height = panelHeight()
    if (!alwaysVisible || !position) {
      return cornerBounds({ workArea: area, corner, sizeKey, isPanelOpen, panelHeight: height })
    }

    return boundsAtRest({
      position,
      placement: panelPlacement(corner),
      workArea: area,
      sizeKey,
      isPanelOpen,
      panelHeight: height,
    })
  }

  /**
   * The window origin is not always the character's resting spot: with the panel open
   * above, the origin sits a panel's height higher. Saved positions must always be the
   * resting spot — see windowGeometry for why — so conversions go through here, where
   * the panel's measured height is known.
   */
  const restingSpot = (origin) =>
    restingSpotFor({
      origin,
      placement: panelPlacement(getSettings().corner),
      isPanelOpen,
      panelHeight: panelHeight(),
    })

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
   * `animate` hands the resize to macOS's own window animation.
   *
   * Used sparingly, and never for opening the panel. The window is transparent, so its
   * frame is not a thing anyone can see moving — what you watch when the panel opens is
   * the CSS clip-path wipe inside it. Animating the frame as well meant two animations of
   * different lengths and easings for one motion, and a full relayout of the panel on
   * every frame of the native one, in a window that is also drawing a 3D character. That
   * is the stutter on opening: not a wrong size being corrected, but the same motion being
   * performed twice, expensively.
   *
   * It stays for a height change on an *open* panel — switching to a taller view genuinely
   * moves an opaque edge, and there is no CSS to carry that because the height is the
   * window's.
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

      /*
       * Restored after the animation, not during it. An animated setBounds returns at once
       * while macOS keeps animating, and a window that is not resizable has its maximum
       * size pinned to its current one — so putting the pin back immediately clamps a
       * window that is still moving. That fight is the rest of the stutter.
       */
      if (animate) {
        setTimeout(() => {
          if (!win.isDestroyed()) win.setResizable(false)
        }, WINDOW_ANIMATION_MS)
      } else {
        win.setResizable(false)
      }
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
    /*
     * Told twice on purpose: applyBounds notifies before the window is shown, so that
     * first message carries isRevealed: false. This one, after showInactive, is the one
     * that says the buddy is on screen.
     */
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
      // Instant: the CSS wipe is the animation, and the frame under it is invisible.
      applyBounds()
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
        // The panel has already faded; shrinking a transparent window is nothing to watch.
        if (!isPanelOpen) applyBounds()
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
    const { workArea: area, bounds } = display()
    const zone = hotCornerZone({ workArea: area, bounds, corner, size: HOT_CORNER_SIZE_PX })
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
    restingSpot,
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
      // Remembered, so the next launch opens at this size instead of learning it again.
      saveSettings({ panelHeight: next })

      if (!isPanelOpen) return notify()

      /*
       * Animated only once the opening resize has settled. A correction that lands while
       * the panel is still fading in is invisible as a snap and a visible blink as a
       * second animation crossing the first — which is what opening the panel looked like.
       */
      applyBounds({ animate: Date.now() - openedAt > PANEL_OPEN_SETTLE_MS })
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
