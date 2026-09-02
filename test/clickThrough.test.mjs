import assert from 'node:assert/strict'
import test from 'node:test'
import { createClickThrough } from '../src/main/clickThrough.js'

/** Just enough BrowserWindow to observe what setIgnoreMouseEvents was told. */
const fakeWindow = () => {
  const calls = []
  return {
    calls,
    isDestroyed: () => false,
    setIgnoreMouseEvents: (ignore) => calls.push(ignore),
    getPosition: () => [0, 0],
  }
}

test('hovering the character makes the window accept clicks', () => {
  const win = fakeWindow()
  const interaction = createClickThrough({ win })

  interaction.setInteractive(true)
  assert.deepEqual(win.calls, [false], 'ignore=false means clicks land')
  assert.equal(interaction.isInteractive(), true)

  interaction.setInteractive(false)
  assert.deepEqual(win.calls, [false, true], 'ignore=true restores click-through')
})

test('repeated identical requests do not thrash the window', () => {
  const win = fakeWindow()
  const interaction = createClickThrough({ win })

  interaction.setInteractive(true)
  interaction.setInteractive(true)
  assert.equal(win.calls.length, 1)
})

test('an open panel refuses every attempt to become click-through', () => {
  // Regression: with the panel open, the cursor tracker's safety net (pointer left the
  // window) and the renderer's hover tracking (the panel is not the character) both
  // asked for click-through, leaving a visible panel that clicks fell straight through.
  const win = fakeWindow()
  let panelOpen = false
  const interaction = createClickThrough({ win, isLocked: () => panelOpen })

  panelOpen = true
  interaction.setInteractive(true)
  assert.deepEqual(win.calls, [false])

  interaction.setInteractive(false) // the safety net
  interaction.setInteractive(false) // the renderer's hover tracking
  assert.deepEqual(win.calls, [false], 'still clickable while the panel is open')
  assert.equal(interaction.isInteractive(), true)

  panelOpen = false
  interaction.setInteractive(false)
  assert.deepEqual(win.calls, [false, true], 'click-through returns once the panel closes')
})
