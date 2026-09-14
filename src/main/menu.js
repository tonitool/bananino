import { Menu } from 'electron'
import { updateMenuEntry } from './update/menuEntry.js'
import {
  CORNERS,
  COSTUME_MENU,
  DANCE_MENU,
  DEFAULT_SHORTCUTS,
  LOOK_MENU,
  SHIRT_MENU,
  WINDOW_SIZES,
} from './constants.js'

const SIZE_LABELS = Object.freeze({ small: 'Small', medium: 'Medium', large: 'Large' })

const CORNER_LABELS = Object.freeze({
  'bottom-right': 'Bottom right',
  'bottom-left': 'Bottom left',
  'top-right': 'Top right',
  'top-left': 'Top left',
})

/**
 * The chord printed beside a menu item — whatever the user has bound, not what shipped.
 *
 * A menu that still advertises ⌃⌥N after someone rebound it is worse than one printing no
 * shortcut at all, so a shortcut switched off contributes no key here — and as *nothing*
 * rather than an empty string, which Electron refuses as an invalid accelerator.
 *
 * registerAccelerator: false throughout: these are already live as global shortcuts, and
 * claiming them again from a menu would be the same key registered twice.
 */
const chord = (settings, id) => {
  const accelerator = settings.shortcuts?.[id] ?? DEFAULT_SHORTCUTS[id] ?? ''
  return accelerator ? { accelerator, registerAccelerator: false } : {}
}

/** One template, shared by the menu bar icon and the right-click menu on the character. */
export const buildMenuTemplate = ({ settings, actions, isPanelOpen, hasQueue, update, version }) => [
  /*
   * Which version is actually running, at the top of the menu that opens it.
   *
   * Not decoration: an update that installs on quit means the thing on screen and the
   * thing just downloaded can differ, and "is this fixed for you?" was being answered by
   * guesswork on both sides. One glance settles it.
   */
  ...(version ? [{ label: `Bananino ${version}`, enabled: false }, { type: 'separator' }] : []),
  {
    label: isPanelOpen ? 'Close panel' : 'Open panel',
    ...chord(settings, 'panel'),
    click: actions.togglePanel,
  },
  {
    label: 'New note',
    ...chord(settings, 'note'),
    click: () => actions.openPanel('note'),
  },
  {
    label: settings.activeTimer ? `Stop “${settings.activeTimer.task}”` : 'Start last timer',
    ...chord(settings, 'timer'),
    enabled: Boolean(settings.activeTimer) || settings.recentTasks.length > 0,
    click: actions.toggleTimer,
  },
  // No accelerator: the three above earn a global key because they are things you do
  // mid-sentence in another app. Asking a question is not one of those.
  { label: 'Ask Bananino…', click: () => actions.openPanel('chat') },
  {
    label: 'Rewrite selection…',
    ...chord(settings, 'rewrite'),
    click: () => actions.rewrite(),
  },
  {
    label: 'Clipboard history',
    ...chord(settings, 'clips'),
    click: () => actions.openPanel('clips'),
  },
  { type: 'separator' },
  // Its own window, as on every Mac app — the same one ⌘, opens. Not a submenu: the
  // settings have long outgrown what a menu can say.
  { label: 'Settings…', accelerator: 'CmdOrCtrl+,', registerAccelerator: false, click: () => actions.openSettings() },
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
    label: 'Shirt',
    submenu: SHIRT_MENU.map(([name, label]) => ({
      label,
      type: 'radio',
      checked: settings.shirt === name,
      click: () => actions.setShirt(name),
    })),
  },
  {
    label: 'Look',
    submenu: LOOK_MENU.map(([id, label]) => ({
      label,
      type: 'radio',
      checked: settings.look === id,
      click: () => actions.setLook(id),
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
  /*
   * Built by the helper, not inlined here. The line below used to read
   * `Download v${update.version}…` and fire openUpdate whatever state the update was in —
   * so while Squirrel was still fetching, the menu offered a restart that installed
   * nothing, which is the other half of "I pressed it and I'm still on the old version".
   * updateMenuEntry has said the right thing for three releases; it was imported at the
   * top of this file and never called.
   */
  updateMenuEntry(update, actions),
  { label: 'Quit Bananino', accelerator: 'Command+Q', click: actions.quit },
]

export const popupMenu = ({ win, onClose, ...options }) =>
  Menu.buildFromTemplate(buildMenuTemplate(options)).popup({ window: win, callback: onClose })
