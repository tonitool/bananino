import { appendFile } from 'node:fs/promises'
import { app, shell } from 'electron'
/*
 * CommonJS interop: electron-updater is a CJS package, and Electron's ESM loader cannot
 * statically see its named exports — a named import of autoUpdater throws SyntaxError
 * before a line of it runs. Default-import and destructure instead.
 */
import updaterPackage from 'electron-updater'
import { parseRepository } from './version.js'

const { autoUpdater } = updaterPackage

const CHECK_DELAY_MS = 20_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * Installs new versions itself, instead of pointing at the page that has them.
 *
 * electron-updater drives Squirrel.Mac here, and Squirrel refuses to swap an unsigned
 * app — which is why this only exists since 1.4.0, once the app carried a Developer ID.
 * Feed comes from the GitHub publish config baked into the build; the download is the
 * plain .zip asset, checked against the running copy's Team ID by Squirrel itself.
 *
 * Development runs skip the loop entirely: an unpackaged app must never try to swap
 * itself, and a failed check is never worth a toast.
 */
export const startAutoUpdater = ({ repositoryUrl, onAvailable, onDownloaded, onNone, logFile = null }) => {
  const repository = parseRepository(repositoryUrl)

  /**
   * Console, plus a file when --update-log=<path> asks for one. Packaged GUI apps on
   * macOS lose stdout more often than they keep it, so diagnosing update behaviour in
   * the field needs somewhere dependable to write.
   */
  const log = (...args) => {
    console.log(...args)
    if (logFile) appendFile(logFile, `${new Date().toISOString()} ${args.join(' ')}\n`).catch(() => {})
  }

  /*
   * The same shape whether or not updating is possible.
   *
   * These used to return {stop, checkNow} only, so every call site guarded with `?.` — and
   * a guard that forgives a missing method also forgives a misspelt one. `updates.open()`
   * sat in app.js for three releases doing nothing at all, because the optional call
   * swallowed it: the menu said "Restart Bananino for v1.6.1" and clicking it was a no-op.
   * One shape means the call sites can simply call, and a wrong name is a crash in
   * development rather than a silence in someone's menu bar.
   */
  const idle = (why) => {
    log(`[update] ${why}`)
    return {
      stop: () => {},
      checkNow: async () => {},
      isReady: () => false,
      install: () => log('[update] nothing to install here'),
      // No repository means no releases page to open; saying so beats a broken link.
      openReleasesPage: () => log('[update] no releases page to open'),
    }
  }

  if (!repository) return idle('no repository configured, so no update checks')
  if (!app.isPackaged) {
    return idle('development run — update checks off, swap would not be ours to make')
  }

  const { owner, repo } = repository
  /* The page nobody should need: the escape hatch if a download fails outright. */
  const releasesPage = `https://github.com/${owner}/${repo}/releases/latest`

  log(`[update] watching, from v${app.getVersion()}`)

  autoUpdater.autoDownload = true
  // Quietly installs at the next quit even if the banner is never clicked.
  autoUpdater.autoInstallOnAppQuit = true

  let ready = null

  autoUpdater.on('update-available', ({ version }) => (log(`[update] v${version} found, fetching`), onAvailable(version)))
  autoUpdater.on('update-not-available', () => (log('[update] nothing newer'), onNone()))
  autoUpdater.on('update-downloaded', ({ version }) => {
    ready = version
    log(`[update] v${version} downloaded and staged`)
    onDownloaded(version)
  })
  autoUpdater.on('error', (error) => {
    // Log, never toast: a flaky network check must not look like something is broken.
    log('[update] check failed:', error.message)
  })

  const check = () =>
    autoUpdater
      .checkForUpdates()
      .then((result) => log(`[update] checked — ${result?.updateInfo?.version ?? 'no answer'}`))
      .catch((error) => log('[update] check skipped:', error.message))

  const first = setTimeout(check, CHECK_DELAY_MS)
  const repeat = setInterval(check, CHECK_INTERVAL_MS)

  return {
    stop: () => (clearTimeout(first), clearInterval(repeat)),
    checkNow: check,
    isReady: () => ready !== null,
    /*
     * `isForceRunAfter` on purpose: this is reached from a menu item that says *Restart*,
     * and an update that installs and leaves the Mac without its buddy is not the restart
     * anybody pressed.
     */
    install: () => autoUpdater.quitAndInstall(false, true),
    openReleasesPage: () => shell.openExternal(releasesPage),
  }
}
