import { globalShortcut } from 'electron'
import { DEFAULT_SHORTCUTS } from './constants.js'

/**
 * The global shortcuts, as the user has them.
 *
 * Best-effort by design: another app may already own a chord, and failing to register one
 * must never stop this app from starting. What is new since that was the whole story is
 * that the failures are *returned* rather than only logged — Settings → Keys shows which
 * chord did not take, which is the difference between "this app is broken" and "Raycast
 * has that one".
 *
 * An empty accelerator is not a failure: it is a shortcut the user switched off.
 */
export const registerShortcuts = (handlers, accelerators = DEFAULT_SHORTCUTS) => {
  const failed = []

  for (const [name, handler] of Object.entries(handlers)) {
    const accelerator = accelerators?.[name]
    if (!handler || !accelerator) continue

    try {
      if (!globalShortcut.register(accelerator, handler)) failed.push(name)
    } catch (error) {
      console.warn(`[shortcuts] ${accelerator} could not be registered:`, error.message)
      failed.push(name)
    }
  }

  if (failed.length > 0) {
    const taken = failed.map((name) => `${name} (${accelerators[name]})`).join(', ')
    console.warn(`[shortcuts] already taken by another app: ${taken}`)
  }

  return { failed, dispose: () => globalShortcut.unregisterAll() }
}
