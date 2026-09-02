import { globalShortcut } from 'electron'
import { DEFAULT_SHORTCUTS } from './constants.js'

/**
 * Global shortcuts are best-effort: another app may already own an accelerator, and
 * failing to register one must never stop the app from starting.
 */
export const registerShortcuts = (handlers) => {
  const failed = []

  for (const [name, accelerator] of Object.entries(DEFAULT_SHORTCUTS)) {
    const handler = handlers[name]
    if (!handler) continue

    try {
      if (!globalShortcut.register(accelerator, handler)) failed.push(accelerator)
    } catch (error) {
      console.warn(`[shortcuts] ${accelerator} could not be registered:`, error.message)
      failed.push(accelerator)
    }
  }

  if (failed.length > 0) {
    console.warn(`[shortcuts] already taken by another app: ${failed.join(', ')}`)
  }

  return () => globalShortcut.unregisterAll()
}
