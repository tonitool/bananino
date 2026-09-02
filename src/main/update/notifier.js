import { app, shell } from 'electron'
import { isNewerVersion, parseRepository } from './version.js'

const CHECK_DELAY_MS = 20_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 10_000

/**
 * Checks GitHub Releases and offers the download, rather than installing it.
 *
 * Squirrel.Mac — what electron-updater drives — refuses to install an update unless the
 * app is code signed, so silent updates are not possible until there is a Developer ID.
 * Telling someone an update exists needs no signature, and works today.
 */
export const startUpdateNotifier = ({ repositoryUrl, onUpdateAvailable }) => {
  const repository = parseRepository(repositoryUrl)
  if (!repository) {
    console.log('[update] no repository configured, so no update checks')
    return () => {}
  }

  const { owner, repo } = repository
  let announced = null

  const check = async () => {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
        {
          headers: { Accept: 'application/vnd.github+json' },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      )
      if (!response.ok) return

      const release = await response.json()
      const latest = release?.tag_name
      if (!isNewerVersion(app.getVersion(), latest)) return
      if (announced === latest) return

      // Only ever a github.com URL, never whatever the response happens to contain.
      const url = `https://github.com/${owner}/${repo}/releases/latest`
      announced = latest
      onUpdateAvailable({ version: String(latest).replace(/^v/, ''), url })
    } catch (error) {
      // A failed check is not worth bothering anyone about.
      console.log('[update] check skipped:', error.message)
    }
  }

  const first = setTimeout(check, CHECK_DELAY_MS)
  const repeat = setInterval(check, CHECK_INTERVAL_MS)

  return {
    stop: () => (clearTimeout(first), clearInterval(repeat)),
    checkNow: check,
    open: (url) => {
      if (!String(url).startsWith(`https://github.com/${owner}/${repo}/`)) return
      shell.openExternal(url)
    },
  }
}
