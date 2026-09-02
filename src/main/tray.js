import { Menu, Tray, nativeImage } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { APP_NAME } from './constants.js'
import { buildMenuTemplate } from './menu.js'
import { formatElapsed } from './storage/dates.js'

const here = dirname(fileURLToPath(import.meta.url))
const ICON_PATH = join(here, '..', '..', 'assets', 'trayTemplate.png')

const TITLE_REFRESH_MS = 1000

export const createTray = (getMenuOptions) => {
  const icon = nativeImage.createFromPath(ICON_PATH)
  icon.setTemplateImage(true)

  const tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip(APP_NAME)

  const refresh = () => {
    const options = getMenuOptions()
    tray.setContextMenu(Menu.buildFromTemplate(buildMenuTemplate(options)))
    refreshTitle(options)
  }

  /** A running timer is shown in the menu bar so it can never be forgotten about. */
  const refreshTitle = ({ settings }) => {
    const active = settings.activeTimer
    tray.setTitle(active ? ` ${formatElapsed(Date.now() - active.startedAt)}` : '')
  }

  const ticker = setInterval(() => refreshTitle(getMenuOptions()), TITLE_REFRESH_MS)

  refresh()
  return { tray, refresh, dispose: () => clearInterval(ticker) }
}
