import { Menu, app, dialog, session, shell } from 'electron'
import {
  CALENDAR,
  CHARACTER_MENU,
  IPC,
  LOOK_MENU,
  SHIRT_MENU,
  UPDATE_REPOSITORY,
  WINDOW_SIZES,
} from './constants.js'
import { readSettings, withRecentTask, writeSettings } from './store.js'
import { createPetWindow } from './petWindow.js'
import { createPerch } from './perch.js'
import { createInteraction } from './interaction.js'
import { startCursorTracker } from './cursorTracker.js'
import { createClipboardWatcher } from './clipboardWatcher.js'
import { createTimer } from './timer.js'
import { createTray } from './tray.js'
import { popupMenu } from './menu.js'
import { registerIpcHandlers } from './ipcHandlers.js'
import { registerShortcuts } from './shortcuts.js'
import { createMeetingController } from './meeting/controller.js'
import { createMicBridge } from './meeting/micBridge.js'
import { createCalendarSync } from './calendar/sync.js'
import * as calendarKeys from './calendar/credentials.js'
import { buildSnapshot } from './snapshot.js'
import { createMocoSync } from './moco/sync.js'
import { startUpdateNotifier } from './update/notifier.js'
import { createNowPlaying } from './music/nowPlaying.js'
import { appendNote, deleteNote, readDayMarkdown, readEntry } from './storage/notes.js'
import { AI_TARGETS, buildHandoff } from './ai/handoff.js'
import { appendManualTimeEntry } from './storage/timeLog.js'
import { describeMinutes, parseDuration } from './storage/duration.js'
import { clearUnpinned, removeClip, togglePin } from './storage/clips.js'
import { ensureDir } from './storage/paths.js'
import { formatMinutes } from './storage/dates.js'
import {
  maybeClickSelector,
  maybeDressUp,
  maybeFreezeMotion,
  maybeLogRendererOutput,
  maybeOpenPanel,
  maybeProbe,
  maybeRunDemo,
  maybeReveal,
  maybeRunSnapshot,
  maybeTap,
} from './devTools.js'

/** Dates arrive from the panel as YYYY-MM-DD; midday avoids every timezone edge. */
const parseIsoDate = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const [, year, month, day] = match.map(Number)
  const date = new Date(year, month - 1, day, 12)
  return Number.isNaN(date.getTime()) ? null : date
}

export const startApp = () => {
  // A desktop buddy belongs on the desktop, not in the Dock or the app switcher.
  app.dock?.hide()

  let settings = readSettings()
  let isQuitting = false
  let isMenuOpen = false
  let pendingUpdate = null

  const getSettings = () => settings
  const saveSettings = (patch) => (settings = writeSettings(patch))

  const win = createPetWindow({ character: settings.character })
  // --pin-panel keeps the panel up while a screenshot is taken.
  const isPinned = () => process.argv.includes('--pin-panel')
  const interaction = createInteraction({
    win,
    // Read lazily: perch is built next and the two reference each other.
    isLocked: () => perch.isPanelOpen(),
    onDragEnd: (position) => saveSettings({ position }),
  })
  const perch = createPerch({ win, getSettings, saveSettings, interaction, isPinned })

  const send = (channel, payload) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }

  /**
   * Goes through the clipboard watcher rather than Electron's clipboard directly, so text
   * this app puts there is not immediately recorded back as a new clip.
   */
  const copyText = async (text, message) => {
    if (!text) return
    try {
      await clipboard.copyToClipboard(text)
      say(message)
    } catch (error) {
      console.error('[app] could not copy that:', error)
      say('could not copy that', 'sad')
    }
  }

  const say = (text, tone = 'happy') => send(IPC.command, { type: 'toast', text, tone })
  /** Sent separately: it changes rarely and would bloat every snapshot. */
  const sendCatalogue = () => send(IPC.mocoCatalogue, moco.search('', 500))
  const react = (name) => send(IPC.command, { type: 'react', name })

  const pushSnapshot = async () => {
    if (win.isDestroyed()) return
    try {
      send(
        IPC.snapshot,
        await buildSnapshot({
          settings,
          clips: clipboard.all(),
          moco: { ...moco.status(), entries: moco.pendingEntries() },
          nowPlaying: music.current(),
          meeting: meeting.status(),
          calendar: calendar.status(),
        }),
      )
    } catch (error) {
      console.error('[app] could not build the panel snapshot:', error)
    }
  }

  const refresh = () => {
    tray.refresh()
    void pushSnapshot()
  }

  const clipboard = createClipboardWatcher({
    isEnabled: () => settings.captureClipboard,
    onChange: () => void pushSnapshot(),
  })

  const moco = createMocoSync({
    getSettings,
    saveSettings,
    onChange: () => refresh(),
  })

  /*
   * The microphone is recorded in the renderer, so the bridge sits between them: it
   * commands the page to start and stop, and writes the samples that come back.
   */
  const mic = createMicBridge({ send: (command) => send(IPC.command, command) })

  const meeting = createMeetingController({
    getSettings,
    mic,
    onChange: () => void pushSnapshot(),
    say,
  })

  const music = createNowPlaying({
    isEnabled: () => settings.showNowPlaying,
    onChange: () => void pushSnapshot(),
    onBlocked: () => {
      saveSettings({ showNowPlaying: false })
      say('let me see Music in Privacy settings', 'sad')
      refresh()
    },
  })

  /*
   * A coming-up meeting is one of the few things worth interrupting idle for, so the
   * reminder does the full attention grab: come out of the corner, hop, and say what's
   * coming. Clicking the buddy then shows the Join/Record strip in the panel.
   */
  const calendar = createCalendarSync({
    getSettings,
    saveSettings,
    keys: calendarKeys,
    onChange: () => void pushSnapshot(),
    onReminder: (event, kind) => {
      perch.reveal()
      react('hop')
      say(
        kind === 'now'
          ? `“${event.title}” is starting`
          : `“${event.title}” in ${CALENDAR.remindMinutes} min`,
        kind === 'now' ? 'excited' : 'happy',
      )
    },
  })

  const timer = createTimer({
    getSettings,
    saveSettings,
    onChange: (event) => {
      if (event.type === 'started') (react('hop'), say(`tracking “${event.task}”`))
      if (event.type === 'error') say(event.message, 'sad')

      if (event.type === 'nudged') {
        say(`${event.minutes > 0 ? '+' : ''}${event.minutes}m — for testing`)
      }

      if (event.type === 'discarded') {
        say(`only ${Math.round(event.seconds)}s — not logged`, 'sad')
      }

      if (event.type === 'stopped') {
        react('hop')
        // Queued, never pushed: these become billable records, so the send stays manual.
        moco
          .enqueue(event)
          .then((queued) =>
            say(
              queued
                ? `${formatMinutes(event.minutes)} logged · queued for MOCO`
                : // Silence here once let a stint look synced when it never was.
                  `${formatMinutes(event.minutes)} logged · local only, no MOCO task`,
              queued || !moco.isConnected() ? 'happy' : 'sad',
            ),
          )
          .catch((error) => {
            console.error('[moco] could not queue that entry:', error)
            say('logged, but not queued for MOCO', 'sad')
          })
      }
      refresh()
    },
  })

  const actions = {
    /**
     * The renderer calls this once it is ready. The catalogue is sent here too because a
     * one-shot push at startup lands before the renderer has subscribed — the model takes
     * seconds to load — and was simply lost, leaving the task search permanently empty.
     */
    pushSnapshot: () => {
      void pushSnapshot()
      sendCatalogue()
      // Presence too: reveal() at startup fires long before the renderer is listening,
      // and a lost message used to leave the character at opacity 0 permanently.
      perch.notify()
    },

    meetingStart: async ({ title } = {}) => {
      await meeting.start({ title })
      void pushSnapshot()
    },

    meetingStop: async () => {
      await meeting.stop()
      void pushSnapshot()
    },

    meetingCancel: async () => {
      await meeting.cancel()
      void pushSnapshot()
    },

    mocoConnect: async ({ subdomain, apiKey }) => {
      try {
        const result = await moco.connect({ subdomain, apiKey })
        sendCatalogue()
        say(`MOCO connected · ${result.taskCount} tasks`)
        react('hop')
      } catch (error) {
        // The message is shown in the panel; the key itself is never logged.
        console.error('[moco] connect failed:', error.message)
        send(IPC.command, {
          type: 'moco-error',
          message: `${error.message} ${error.hint ?? ''}`.trim(),
        })
        say('MOCO said no', 'sad')
      }
      refresh()
    },

    mocoDisconnect: async () => {
      await moco.disconnect().catch(reportOnly('disconnect MOCO'))
      sendCatalogue()
      say('MOCO disconnected')
      refresh()
    },

    mocoRefresh: async () => {
      try {
        const count = await moco.refreshCatalogue()
        sendCatalogue()
        say(`${count} MOCO tasks`)
      } catch (error) {
        console.error('[moco] refresh failed:', error.message)
        say('could not refresh MOCO', 'sad')
      }
      refresh()
    },

    /**
     * The reason a push failed is shown, not just the fact of it. It used to go to the
     * main process's console — invisible in a packaged app — leaving "could not reach
     * MOCO" as the only thing a user could act on, which is nothing.
     */
    mocoPush: async () => {
      try {
        const { sent, failed } = await moco.push()
        react('hop')
        say(
          failed > 0 ? `${sent} sent, ${failed} failed` : `${sent} sent to MOCO`,
          failed > 0 ? 'sad' : 'happy',
        )
        // Whatever MOCO said about the entries that would not go; the queue keeps them.
        if (failed > 0 && moco.status().lastError) {
          send(IPC.command, { type: 'moco-error', message: moco.status().lastError })
        }
      } catch (error) {
        console.error('[moco] push failed:', error.message)
        send(IPC.command, {
          type: 'moco-error',
          message: `${error.message} ${error.hint ?? ''}`.trim(),
        })
        say('could not reach MOCO', 'sad')
      }
      refresh()
    },

    /**
     * Rounds up before sending. MOCO can round server-side too, per account; this is for
     * when you want the app's own record to match what is booked.
     */
    setMocoRounding: (step) => (saveSettings({ mocoRoundTo: step }), refresh()),

    calendarConnect: async ({ feedUrl }) => {
      try {
        await calendar.connect({ feedUrl })
        react('hop')
        const count = calendar.upcoming().length
        say(count === 1 ? 'calendar connected · 1 meeting ahead' : `calendar connected · ${count} meetings ahead`)
      } catch (error) {
        console.error('[calendar] connect failed:', error.message)
        send(IPC.command, {
          type: 'calendar-error',
          message: `${error.message} ${error.hint ?? ''}`.trim(),
        })
        say('that calendar link did not work', 'sad')
      }
      refresh()
    },

    calendarDisconnect: async () => {
      await calendar.disconnect().catch(reportOnly('disconnect the calendar'))
      say('calendar disconnected')
      refresh()
    },

    calendarRefresh: async () => {
      await calendar.pollNow().catch((error) => {
        console.error('[calendar] refresh failed:', error.message)
        say('could not refresh the calendar', 'sad')
      })
      refresh()
    },

    /** The two answers a reminder deserves: silence it, or silence and hide it. */
    calendarAcknowledge: (id) => {
      calendar.acknowledge(id)
      say('see you there!')
    },

    calendarSkip: (id) => {
      calendar.skip(id)
      say('out of your hair')
    },

    /** Join links are opened by us, so only meeting hosts get handed to the browser. */
    calendarJoin: async (url) => {
      let parsed
      try {
        parsed = new URL(String(url ?? ''))
        if (parsed.protocol !== 'https:') throw new Error('https only')
      } catch {
        return say('that is not a link', 'sad')
      }
      const allowed =
        ['teams.microsoft.com', 'teams.live.com', 'meet.google.com'].includes(parsed.hostname) ||
        parsed.hostname.endsWith('.zoom.us')
      if (!allowed) return say('that does not look like a meeting link', 'sad')

      await shell.openExternal(parsed.href).catch((error) => {
        console.error('[calendar] could not open the join link:', error)
        say('could not open the link', 'sad')
      })
    },


    mocoDiscard: async (id) => {
      await moco.discard(id).catch(reportOnly('discard that entry'))
      refresh()
    },

    setCostume: (name) => {
      saveSettings({ costume: name })
      send(IPC.command, { type: 'costume', name })
      refresh()
    },

    /**
     * Who the buddy is. The renderer swaps the model in place; this only records the
     * choice, which is also what the window is loaded with next launch, so a restart
     * never flashes the character you just left behind.
     */
    setCharacter: (id) => {
      const known = CHARACTER_MENU.find(([characterId]) => characterId === id)
      if (!known || id === settings.character) return
      saveSettings({ character: id })
      send(IPC.command, { type: 'character', id })
      say(`${known[1].toLowerCase()} it is!`)
      refresh()
    },
    /** What it wears on its body. Its own setting, so a hat and a shirt coexist. */
    setShirt: (name) => {
      if (!SHIRT_MENU.some(([id]) => id === name)) return
      saveSettings({ shirt: name })
      send(IPC.command, { type: 'shirt', name })
      refresh()
    },
    /** What the cap and the shirt are made of. One setting dresses both. */
    setLook: (id) => {
      if (!LOOK_MENU.some(([known]) => known === id)) return
      saveSettings({ look: id })
      send(IPC.command, { type: 'look', id })
      refresh()
    },

    setDance: (name) => send(IPC.command, { type: 'dance', name }),

    /** Recovery for a window stranded on a disconnected or unwatched display. */
    bringToScreen: () => {
      saveSettings({ position: null })
      perch.reveal()
      say('over here!')
      react('hop')
      refresh()
    },


    togglePanel: () => {
      perch.reveal()
      perch.togglePanel()
      refresh()
    },
    openPanel: (tab) => {
      perch.reveal()
      perch.setPanelOpen(true)
      send(IPC.command, { type: 'focus-tab', tab })
      refresh()
    },

    saveNote: async (text) => {
      try {
        await appendNote({ dataDir: settings.dataDir, text })
        react('hop')
        say('noted!')
        send(IPC.command, { type: 'note-saved' })
      } catch (error) {
        console.error('[app] could not save the note:', error)
        say(error.message, 'sad')
      }
      void pushSnapshot()
    },

    /** Right-clicking a note: copy it, hand it to an assistant, or delete it. */
    openNoteMenu: async (index) => {
      const entry = await readEntry({ dataDir: settings.dataDir, index }).catch(() => null)
      if (!entry) return

      isMenuOpen = true
      Menu.buildFromTemplate([
        { label: 'Copy note', click: () => void copyText(entry.text, 'note copied') },
        {
          label: 'Ask',
          submenu: Object.entries(AI_TARGETS).map(([name, target]) => ({
            label: target.label,
            click: () => void actions.askAi(name, entry.text),
          })),
        },
        { type: 'separator' },
        {
          label: 'Copy the whole day',
          click: async () => {
            const markdown = await readDayMarkdown({ dataDir: settings.dataDir })
            await copyText(markdown, "today's notes copied")
          },
        },
        { label: 'Reveal the file', click: actions.revealData },
        { type: 'separator' },
        { label: 'Delete note', click: () => void actions.deleteNote(index) },
      ]).popup({ window: win, callback: () => (isMenuOpen = false) })
    },

    askAi: async (provider, text) => {
      const { url, needsClipboard, label } = buildHandoff(provider, text)
      try {
        if (needsClipboard) await clipboard.copyToClipboard(text)
        await shell.openExternal(url)
        say(needsClipboard ? `paste it into ${label}` : `over to ${label}`)
      } catch (error) {
        console.error('[app] could not hand that to an assistant:', error)
        say('could not open that', 'sad')
      }
    },

    deleteNote: async (index) => {
      try {
        const removed = await deleteNote({ dataDir: settings.dataDir, index })
        say(removed ? 'note deleted' : 'could not find that note', removed ? 'happy' : 'sad')
      } catch (error) {
        console.error('[app] could not delete that note:', error)
        say('could not delete that', 'sad')
      }
      refresh()
    },

    startTimer: (task, binding, description) =>
      timer.start(task, binding, description).catch(reportOnly('start the timer')),
    stopTimer: () => timer.stop().catch(reportOnly('stop the timer')),
    describeTimer: (text) => (timer.describe(text), void pushSnapshot()),

    nudgeTimer: (minutes) => {
      if (!timer.nudge(minutes)) return say('no timer running', 'sad')
      refresh()
    },

    /**
     * Time entered after the fact, for the days the timer never got started. Validated
     * here as well as in the panel: this ends up in a billable record.
     */
    addManualTime: async ({ task, date, duration, description, binding }) => {
      const minutes = parseDuration(duration)
      if (!minutes) return say(`"${duration}" is not a duration`, 'sad')

      const when = parseIsoDate(date)
      if (!when) return say('that date looks wrong', 'sad')

      const name = task.trim() || binding?.label
      if (!name) return say('what was the task?', 'sad')

      try {
        await appendManualTimeEntry({ dataDir: settings.dataDir, task: name, date: when, minutes })
        saveSettings({
          recentTasks: withRecentTask(settings.recentTasks, name),
          taskBindings: binding ? { ...settings.taskBindings, [name]: binding } : settings.taskBindings,
        })

        const queued = await moco.enqueueManual({
          task: name,
          binding: binding ?? settings.taskBindings[name] ?? null,
          date: when,
          minutes,
          description,
        })

        react('hop')
        say(queued ? `${describeMinutes(minutes)} added · queued for MOCO` : `${describeMinutes(minutes)} added`)
        send(IPC.command, { type: 'manual-added' })
      } catch (error) {
        console.error('[app] could not add that entry:', error)
        say('could not add that entry', 'sad')
      }
      refresh()
    },
    toggleTimer: () => timer.toggle().catch(reportOnly('toggle the timer')),

    copyClip: async (id) => {
      const clip = clipboard.all().find((entry) => entry.id === id)
      if (!clip) return
      try {
        await clipboard.copyToClipboard(clip.text)
        say('copied!')
      } catch (error) {
        console.error('[app] could not copy that clip:', error)
        say('could not copy that', 'sad')
      }
    },
    deleteClip: (id) => void clipboard.update(removeClip(clipboard.all(), id)),
    pinClip: (id) => void clipboard.update(togglePin(clipboard.all(), id)),
    clearClips: () => void clipboard.update(clearUnpinned(clipboard.all())),

    setSize: (sizeKey) => (saveSettings({ sizeKey }), perch.applyBounds(), refresh()),
    setCorner: (corner) => {
      saveSettings({ corner, alwaysVisible: false })
      perch.setAlwaysVisible(false)
      refresh()
    },
    setAlwaysVisible: (value) => (perch.setAlwaysVisible(value), refresh()),
    setCaptureClipboard: (value) => (saveSettings({ captureClipboard: value }), refresh()),
    setShowNowPlaying: (value) => {
      saveSettings({ showNowPlaying: value })
      // Retries even after a refusal, since the user has just asked for it again.
      if (value) music.reset()
      refresh()
    },

    chooseDataDir: async () => {
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: 'Where should notes and time logs live?',
        defaultPath: settings.dataDir,
        properties: ['openDirectory', 'createDirectory'],
      })
      if (canceled || !filePaths[0]) return
      saveSettings({ dataDir: filePaths[0] })
      say('new home set')
      refresh()
    },

    revealData: async () => {
      try {
        await ensureDir(settings.dataDir)
        await shell.openPath(settings.dataDir)
      } catch (error) {
        console.error('[app] could not open the data folder:', error)
        say('could not open that folder', 'sad')
      }
    },

    openMenu: () => {
      isMenuOpen = true
      popupMenu({
        win,
        settings,
        actions,
        isPanelOpen: perch.isPanelOpen(),
        hasQueue: moco.pendingEntries().length > 0,
        update: pendingUpdate,
        onClose: () => (isMenuOpen = false),
      })
    },

    openUpdate: () => pendingUpdate && updates.open?.(pendingUpdate.url),
    checkForUpdates: () => updates.checkNow?.(),

    quit: () => {
      isQuitting = true
      app.quit()
    },
  }

  const tray = createTray(() => ({
    win,
    settings,
    actions,
    isPanelOpen: perch.isPanelOpen(),
    hasQueue: moco.pendingEntries().length > 0,
    update: pendingUpdate,
  }))

  const updates = startUpdateNotifier({
    repositoryUrl: UPDATE_REPOSITORY,
    onUpdateAvailable: (update) => {
      pendingUpdate = update
      react('hop')
      say(`v${update.version} is out!`)
      tray.refresh()
    },
  })

  music.start()

  const stopCursorTracker = startCursorTracker({
    win,
    interaction,
    listeners: [perch.handleCursor],
  })

  moco
    .start()
    .then(sendCatalogue)
    .catch((error) => console.error('[moco] could not start:', error))

  calendar.start().catch((error) => console.error('[calendar] could not start:', error))

  /*
   * Without a handler Electron's default would decide this; being explicit means the page
   * can only ever obtain the microphone, only for audio, and only while a meeting is
   * actually recording.
   */
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const wantsMicrophone =
      permission === 'media' && (details?.mediaTypes ?? ['audio']).every((type) => type === 'audio')
    callback(wantsMicrophone && meeting.isRecording())
  })

  const unregisterIpc = registerIpcHandlers({ interaction, perch, actions, mic })
  const unregisterShortcuts = registerShortcuts({
    panel: actions.togglePanel,
    note: () => actions.openPanel('note'),
    clips: () => actions.openPanel('clips'),
    timer: actions.toggleTimer,
  })

  win.webContents.once('did-finish-load', () => {
    void clipboard.start()
    void pushSnapshot()
    if (settings.alwaysVisible) perch.reveal()
  })

  win.on('moved', () => {
    if (!interaction.isDragging() && settings.alwaysVisible) {
      saveSettings({ position: win.getPosition() })
    }
  })

  // Clicking away is how a floating panel is dismissed everywhere else on the system.
  win.on('focus', perch.noteFocus)
  win.on('blur', () => {
    if (!isMenuOpen && perch.canDismissOnBlur()) perch.setPanelOpen(false)
  })

  maybeLogRendererOutput(win, process.argv)
  maybeOpenPanel(win, process.argv, actions.openPanel)
  maybeTap(win, process.argv, WINDOW_SIZES[settings.sizeKey])
  maybeReveal(win, process.argv, perch.reveal)
  maybeClickSelector(win, process.argv)
  maybeDressUp(win, process.argv, actions)
  maybeProbe(win, process.argv)
  maybeFreezeMotion(win, process.argv)
  maybeRunSnapshot(win, process.argv, actions.quit)
  maybeRunDemo(win, process.argv, IPC.command)

  app.on('before-quit', () => {
    isQuitting = true
    calendar.stop()
    stopCursorTracker()
    music.stop()
    updates.stop?.()
    unregisterIpc()
    unregisterShortcuts()
    clipboard.stop()
    tray.dispose()
    interaction.stopDrag()
  })

  // Closing the only window must not kill a menu-bar-resident app.
  app.on('window-all-closed', () => {
    if (isQuitting) app.quit()
  })
}

const reportOnly = (what) => (error) => console.error(`[app] could not ${what}:`, error)
