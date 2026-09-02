import { writeFile } from 'node:fs/promises'

const SNAPSHOT_FLAG = '--snapshot='

/**
 * Development aid: renders for a moment, writes the composited window (transparency
 * included) to a PNG, then exits. Used to eyeball framing without a screen recorder.
 */
export const maybeRunSnapshot = (win, argv, quit) => {
  const flag = argv.find((arg) => arg.startsWith(SNAPSHOT_FLAG))
  if (!flag) return

  const [path, delayMs = '5000'] = flag.slice(SNAPSHOT_FLAG.length).split(':')

  setTimeout(async () => {
    try {
      const image = await win.webContents.capturePage()
      await writeFile(path, image.toPNG())
      console.log('[snapshot]', path)
    } catch (error) {
      console.error('[snapshot] failed:', error.message)
    } finally {
      quit()
    }
  }, Number(delayMs))
}

const DEMO_FLAG = '--demo='

/** Fires one reaction on launch so a single pose can be inspected in a snapshot. */
export const maybeRunDemo = (win, argv, channel) => {
  const flag = argv.find((arg) => arg.startsWith(DEMO_FLAG))
  if (!flag) return

  const name = flag.slice(DEMO_FLAG.length)
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => win.webContents.send(channel, { type: 'react', name }), 1500)
  })
}

/** `--dev` mirrors a window's console output into the terminal. */
export const maybeLogWindowOutput = (win, argv, label) => {
  if (!argv.includes('--dev')) return
  win.webContents.on('console-message', (event) => console.log(`[${label}]`, event.message))
}

/** `--dev` mirrors renderer console output into the terminal. */
export const maybeLogRendererOutput = (win, argv) => {
  if (!argv.includes('--dev')) return
  for (const event of ['focus', 'blur', 'show', 'hide']) {
    win.on(event, () => console.log(`[win] ${event}`))
  }
  win.webContents.on('console-message', (event) => console.log('[renderer]', event.message))
  win.once('ready-to-show', () => console.log('[bounds]', JSON.stringify(win.getBounds())))
}

/** `--open-panel[=note|clips]` starts with the panel showing, for layout work. */
export const maybeOpenPanel = (win, argv, openPanel) => {
  const flag = argv.find((arg) => arg === '--open-panel' || arg.startsWith('--open-panel='))
  if (!flag) return
  const tab = flag.split('=')[1] ?? 'note'
  win.webContents.once('did-finish-load', () => setTimeout(() => openPanel(tab), 1200))
}

/**
 * `--tap[=1|2]` injects a click or double-click at the character, so pointer gestures can
 * be verified without a human hand. Aimed at the centre of the character box, which is
 * horizontally centred and pinned to the window's bottom edge for the bottom corners.
 */
export const maybeTap = (win, argv, characterSize) => {
  const flag = argv.find((arg) => arg === '--tap' || arg.startsWith('--tap='))
  if (!flag) return

  const clicks = Number(flag.split('=')[1] ?? 2)
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      const { width, height } = win.getBounds()
      const point = {
        x: Math.round(width / 2),
        y: Math.round(height - characterSize / 2),
      }
      for (let clickCount = 1; clickCount <= clicks; clickCount += 1) {
        for (const type of ['mouseDown', 'mouseUp']) {
          win.webContents.sendInputEvent({ type, button: 'left', clickCount, ...point })
        }
      }
      console.log(`[tap] injected ${clicks} click(s) at`, point)
    }, 2500)
  })
}

/** `--reveal` brings the character out without waiting for the hot corner. */
export const maybeReveal = (win, argv, reveal) => {
  if (!argv.includes('--reveal')) return
  win.webContents.once('did-finish-load', () => setTimeout(reveal, 400))
}

/**
 * `--click=<css selector>` clicks the centre of a live element, measured from the real
 * layout. Used to verify that the panel actually receives mouse events, which pinning a
 * screenshot alone cannot prove.
 */
export const maybeClickSelector = (win, argv) => {
  const flag = argv.find((arg) => arg.startsWith('--click='))
  if (!flag) return

  const [selector, timeout = '20000'] = flag.slice('--click='.length).split('@')

  win.webContents.once('did-finish-load', async () => {
    try {
      // Waits until the element is genuinely the topmost thing at its own centre. Fixed
      // delays raced the panel opening, which varies with how long the model takes to load.
      const rect = await win.webContents.executeJavaScript(`
        new Promise((resolve) => {
          const deadline = Date.now() + ${Number(timeout) || 20000}
          const tick = () => {
            const node = document.querySelector(${JSON.stringify(selector)})
            if (node) {
              const { left, top, width, height } = node.getBoundingClientRect()
              const x = Math.round(left + width / 2)
              const y = Math.round(top + height / 2)
              const at = document.elementFromPoint(x, y)
              if (at === node || node.contains(at)) return resolve({ x, y })
            }
            if (Date.now() > deadline) return resolve(null)
            setTimeout(tick, 200)
          }
          tick()
        })
      `)

      if (!rect) return console.log(`[click] ${selector} never became clickable`)
      for (const type of ['mouseDown', 'mouseUp']) {
        win.webContents.sendInputEvent({ type, button: 'left', clickCount: 1, ...rect })
      }
      console.log(`[click] ${selector} at`, rect)
    } catch (error) {
      console.error('[click] failed:', error.message)
    }
  })
}

/**
 * `--pin-panel` also freezes motion, so a capture is not taken mid-transition. An
 * unfocused window is not composited, which leaves CSS animations stuck part-way.
 */
export const maybeFreezeMotion = (win, argv) => {
  if (!argv.includes('--pin-panel')) return
  win.webContents.on('did-finish-load', () => {
    win.webContents
      .executeJavaScript('document.documentElement.setAttribute("data-no-motion", "")')
      .catch((error) => console.warn('[freeze] failed:', error.message))
  })
}

/** `--probe=<expression>` evaluates JavaScript in the page and logs the result. */
export const maybeProbe = (win, argv) => {
  const flag = argv.find((arg) => arg.startsWith('--probe='))
  if (!flag) return

  // `--probe=<expr>@<ms>` — the delay matters because the model load pushes did-finish-load.
  const raw = flag.slice('--probe='.length)
  const at = raw.lastIndexOf('@')
  const expression = at > 0 && /^\d+$/.test(raw.slice(at + 1)) ? raw.slice(0, at) : raw
  const delay = at > 0 && /^\d+$/.test(raw.slice(at + 1)) ? Number(raw.slice(at + 1)) : 7000
  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const value = await win.webContents.executeJavaScript(`(() => (${expression}))()`)
        console.log('[probe]', JSON.stringify(value))
      } catch (error) {
        console.error('[probe] failed:', error.message)
      }
    }, delay)
  })
}

/**
 * `--character=<id>`, `--costume=<name>` and `--dance=<name>` set who is on stage and
 * what they are wearing, for a screenshot.
 *
 * The character is given longer than the rest: it is a whole model to fetch and measure,
 * and a capture taken mid-swap catches an empty stage.
 */
export const maybeDressUp = (win, argv, actions) => {
  const character = argv.find((arg) => arg.startsWith('--character='))
  const costume = argv.find((arg) => arg.startsWith('--costume='))
  const dance = argv.find((arg) => arg.startsWith('--dance='))
  if (!character && !costume && !dance) return

  win.webContents.once('did-finish-load', () => {
    if (character) actions.setCharacter(character.split('=')[1])
    setTimeout(() => {
      if (costume) actions.setCostume(costume.split('=')[1])
      if (dance) actions.setDance(dance.split('=')[1])
    }, 900)
  })
}

