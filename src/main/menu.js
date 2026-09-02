import { Menu } from 'electron'
import {
  CORNERS,
  COSTUME_MENU,
  DANCE_MENU,
  DEFAULT_SHORTCUTS,
  WINDOW_SIZES,
} from './constants.js'

const SIZE_LABELS = Object.freeze({ small: 'Small', medium: 'Medium', large: 'Large' })

const CORNER_LABELS = Object.freeze({
  'bottom-right': 'Bottom right',
  'bottom-left': 'Bottom left',
  'top-right': 'Top right',
  'top-left': 'Top left',
})

/** One template, shared by the menu bar icon and the right-click menu on the character. */
export const buildMenuTemplate = ({ settings, actions, isPanelOpen, hasQueue, update }) => [
  // registerAccelerator: false shows the key combination without claiming it twice —
  // these are already live as global shortcuts.
  {
    label: isPanelOpen ? 'Close panel' : 'Open panel',
    accelerator: DEFAULT_SHORTCUTS.panel,
    registerAccelerator: false,
    click: actions.togglePanel,
  },
  {
    label: 'New note',
    accelerator: DEFAULT_SHORTCUTS.note,
    registerAccelerator: false,
    click: () => actions.openPanel('note'),
  },
  {
    label: settings.activeTimer ? `Stop “${settings.activeTimer.task}”` : 'Start last timer',
    accelerator: DEFAULT_SHORTCUTS.timer,
    registerAccelerator: false,
    enabled: Boolean(settings.activeTimer) || settings.recentTasks.length > 0,
    click: actions.toggleTimer,
  },
  {
    label: 'Clipboard history',
    accelerator: DEFAULT_SHORTCUTS.clips,
    registerAccelerator: false,
    click: () => actions.openPanel('clips'),
  },
  { type: 'separator' },
  {
    label: 'Costume',
    submenu: COSTUME_MENU.map(([name, label]) => ({
      label,
      type: 'radio',
      checked: settings.costume === name,
      click: () => actions.setCostume(name),
    })),
  },
  {
    label: 'Dance',
    submenu: [
      ...DANCE_MENU.map(([name, label]) => ({ label, click: () => actions.setDance(name) })),
      { type: 'separator' },
      { label: 'Stop dancing', click: () => actions.setDance(null) },
    ],
  },
  { type: 'separator' },
  {
    label: 'Wake in corner',
    submenu: Object.keys(CORNERS).map((key) => ({
      label: CORNER_LABELS[key],
      type: 'radio',
      checked: !settings.alwaysVisible && settings.corner === key,
      click: () => actions.setCorner(key),
    })),
  },
  { label: 'Bring to this screen', click: actions.bringToScreen },
  {
    label: 'Always visible',
    type: 'checkbox',
    checked: settings.alwaysVisible,
    click: () => actions.setAlwaysVisible(!settings.alwaysVisible),
  },
  {
    label: 'Size',
    submenu: Object.keys(WINDOW_SIZES).map((key) => ({
      label: SIZE_LABELS[key],
      type: 'radio',
      checked: settings.sizeKey === key,
      click: () => actions.setSize(key),
    })),
  },
  { type: 'separator' },
  {
    label: 'Remember clipboard',
    type: 'checkbox',
    checked: settings.captureClipboard,
    click: () => actions.setCaptureClipboard(!settings.captureClipboard),
  },
  {
    label: 'MOCO',
    submenu: [
      {
        label: settings.mocoSubdomain
          ? `Connected to ${settings.mocoSubdomain}`
          : 'Not connected',
        enabled: false,
      },
      { type: 'separator' },
      { label: 'Push queued time', enabled: hasQueue, click: actions.mocoPush },
      { label: 'Refresh tasks', enabled: Boolean(settings.mocoSubdomain), click: actions.mocoRefresh },
      {
        label: 'Round time up to',
        submenu: [
          ['Exact minutes', 0],
          ['5 minutes', 5],
          ['15 minutes', 15],
        ].map(([label, step]) => ({
          label,
          type: 'radio',
          checked: settings.mocoRoundTo === step,
          click: () => actions.setMocoRounding(step),
        })),
      },
      {
        label: 'Disconnect',
        enabled: Boolean(settings.mocoSubdomain),
        click: actions.mocoDisconnect,
      },
    ],
  },
  {
    label: 'Calendar',
    submenu: [
      {
        label: settings.calendarFeed ? 'Watching a published calendar' : 'Not connected',
        enabled: false,
      },
      { type: 'separator' },
      { label: 'Refresh now', enabled: settings.calendarFeed, click: actions.calendarRefresh },
      {
        label: 'Disconnect',
        enabled: settings.calendarFeed,
        click: actions.calendarDisconnect,
      },
    ],
  },
  {
    label: "Show what's playing",
    type: 'checkbox',
    checked: settings.showNowPlaying,
    click: () => actions.setShowNowPlaying(!settings.showNowPlaying),
  },
  { label: 'Open notes folder', click: actions.revealData },
  { label: 'Change folder…', click: actions.chooseDataDir },
  {
    label: 'Nudge the timer (testing)',
    enabled: Boolean(settings.activeTimer),
    submenu: [
      ['+5 minutes', 5],
      ['+15 minutes', 15],
      ['+1 hour', 60],
      ['−5 minutes', -5],
    ].map(([label, minutes]) => ({ label, click: () => actions.nudgeTimer(minutes) })),
  },
  { type: 'separator' },
  update
    ? { label: `Download v${update.version}…`, click: actions.openUpdate }
    : { label: 'Check for updates', click: actions.checkForUpdates },
  { label: 'Quit Bananino', accelerator: 'Command+Q', click: actions.quit },
]

export const popupMenu = ({ win, onClose, ...options }) =>
  Menu.buildFromTemplate(buildMenuTemplate(options)).popup({ window: win, callback: onClose })
