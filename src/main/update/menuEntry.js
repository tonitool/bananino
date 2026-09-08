/**
 * The one menu line that changes as an update travels from found to installed: a plain
 * check while nothing is known, a greyed-out progress note while Squirrel fetches, and the
 * restart that swaps the app in once the download is verified and staged.
 */
export const updateMenuEntry = (update, actions) => {
  if (!update) return { label: 'Check for updates', click: actions.checkForUpdates }
  if (update.state === 'ready') {
    return { label: `Restart Bananino for v${update.version}`, click: actions.openUpdate }
  }
  return { label: `Downloading v${update.version}…`, enabled: false }
}
