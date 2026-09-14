import { Menu, app, clipboard as systemClipboard, dialog, session, shell, systemPreferences } from 'electron'
import {
  APP_NAME,
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
import { createSettingsWindow } from './settingsWindow.js'
import { createPerch } from './perch.js'
import { createInteraction } from './interaction.js'
import { startCursorTracker } from './cursorTracker.js'
import { createClipboardWatcher } from './clipboardWatcher.js'
import { createTimer } from './timer.js'
import { createTray } from './tray.js'
import { popupMenu } from './menu.js'
import { registerIpcHandlers } from './ipcHandlers.js'
import { registerShortcuts } from './shortcuts.js'
import { normaliseAccelerator } from './accelerators.js'
import { createMeetingController } from './meeting/controller.js'
import { createMicBridge } from './meeting/micBridge.js'
import { createCalendarSync } from './calendar/sync.js'
import { createChat } from './chat/session.js'
import { createRewrite } from './rewrite/controller.js'
import { SYSTEM as REWRITE_SYSTEM } from './rewrite/prompt.js'
import { createSelection } from './rewrite/selection.js'
import { createRewriteWindow } from './rewriteWindow.js'
import { chooseEngine } from './chat/engine.js'
import * as calendarKeys from './calendar/credentials.js'
import { buildSnapshot } from './snapshot.js'
import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { ask as askCloud, forgetKey, readKey, saveKey } from './meeting/openrouter.js'
import { LlmUnavailable, ask as askLocal, checkOllama } from './meeting/llm.js'
import { createMocoSync } from './moco/sync.js'
import { startAutoUpdater } from './update/updater.js'
import { createNowPlaying } from './music/nowPlaying.js'
import { createMusicControl } from './music/control.js'
import { osascript } from './music/osascript.js'
import { FULL_DISK_ACCESS_HINT, formatRow, searchMessages } from './messages/search.js'
import {
  appendNote,
  deleteNote,
  readDayMarkdown,
  readEntry,
  readNotesToday,
} from './storage/notes.js'
import { AI_TARGETS, buildHandoff } from './ai/handoff.js'
import { appendManualTimeEntry } from './storage/timeLog.js'
import { describeMinutes, parseDuration } from './storage/duration.js'
import { clearUnpinned, removeClip, searchClips, togglePin } from './storage/clips.js'
import { ensureDir, notesDir } from './storage/paths.js'
import { searchNotes } from './storage/noteSearch.js'
import { createFileSearch } from './storage/fileSearch.js'
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
  maybeSnapshotSettings,
  maybeTap,
} from './devTools.js'

/**
 * `~/Desktop/spec.pdf` as a path the filesystem knows.
 *
 * A model writes a path the way a person says one, and `~` is a shell's convention rather
 * than a real directory — expanded here so a tilde path is opened instead of refused.
 */
const expandHome = (value) => {
  const path = String(value ?? '').trim()
  return path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path
}

/** Longest a recording may hold the global shortcuts down before they come back by force. */
const RECORDING_GRACE_MS = 20_000

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
  // Rebinding on close covers the window being shut mid-recording, before its own stop.
  const settingsWindow = createSettingsWindow({ onClosed: () => bindShortcuts() })
  // --pin-panel keeps the panel up while a screenshot is taken.
  const isPinned = () => process.argv.includes('--pin-panel')
  const interaction = createInteraction({
    win,
    // Read lazily: perch is built next and the two reference each other.
    isLocked: () => perch.isPanelOpen(),
    // The window origin is not the resting spot while the panel hangs above the
    // character — what is saved must be where the buddy rests, panel shut.
    onDragEnd: (position) => saveSettings({ position: perch.restingSpot(position) }),
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

  /**
   * The last snapshot sent to the panel, kept so the chat can describe the day without
   * reading the day's files again. It is also the honest source: the chat then knows
   * exactly what the panel is showing, and cannot contradict the view beside it.
   */
  let lastSnapshot = {}

  const pushSnapshot = async () => {
    if (win.isDestroyed()) return
    try {
      lastSnapshot = await buildSnapshot({
        settings,
        clips: clipboard.all(),
        moco: { ...moco.status(), entries: moco.pendingEntries() },
        nowPlaying: music.current(),
        meeting: meeting.status(),
        calendar: calendar.status(),
        shortcuts: { values: settings.shortcuts, failed: shortcuts.failed },
        version: app.getVersion(),
      })
      send(IPC.snapshot, lastSnapshot)
      // The settings window reads the same truth; no-ops while it is closed.
      settingsWindow.send(IPC.snapshot, lastSnapshot)
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

  /*
   * Watching the players and working them are kept apart on purpose: the poller must never
   * launch anything, and a command must never be swallowed by a poll's error handling.
   * They share only the osascript runner and the rule about not speaking to a closed app.
   */
  const musicControl = createMusicControl({ osascript })

  /*
   * Spotlight, plus a folder listing for "what did I download". `mdfind` is given its
   * arguments as an array and never a command line, so a query is words to search for and
   * cannot become a flag or a second command. The well-known folders come from electron
   * rather than from `~/Downloads` guessed at: a Mac in German has a Downloads folder the
   * Finder calls Downloads and the shell does not.
   */
  const fileSearch = createFileSearch({
    /*
     * Errors are thrown rather than swallowed, which is the whole point: every way this
     * can fail used to arrive as one useless sentence, so the chat guessed at reasons.
     * A timeout, an overflowing buffer and a folder macOS will not open are three
     * different things to tell someone — see describeFailure in storage/fileSearch.js.
     *
     * A whole-Mac search is slow and can match a great deal, so both limits are generous:
     * the old 8s and 1MB were a scoped search's numbers, and an unscoped one hit them.
     */
    mdfind: async (args) => {
      const { stdout } = await execFileAsync('mdfind', args, {
        timeout: 20_000,
        maxBuffer: 8 * 1024 * 1024,
      })
      return stdout.split('\n').filter(Boolean)
    },
    statFile: (path) => stat(path),
    readFolder: (dir) => readdir(dir),
    home: homedir(),
    known: (name) => app.getPath(name),
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

  const chat = createChat({
    getSnapshot: () => lastSnapshot,
    onState: (state) => send(IPC.chatState, state),
    /*
     * Read lazily, because the chat exists before the actions it drives. Everything the
     * buddy does to your *records* it does through these — the very same calls the panel's
     * buttons make — so there is no path the chat can take through your time, notes or
     * MOCO queue that the UI does not already have, and a timer it starts hops and toasts
     * exactly as a clicked one does. Working the Mac around you (the players, opening a
     * file) has no button to go through and is handed in separately below.
     */
    actions: {
      startTimer: (task, binding, description) => actions.startTimer(task, binding, description),
      stopTimer: () => actions.stopTimer(),
      cancelTimer: () => actions.cancelTimer(),
      saveNote: (text) => actions.saveNote(text),
      deleteNote: (index) => actions.deleteNote(index),
      addManualTime: (payload) => actions.addManualTime(payload),
      mocoPush: () => actions.mocoPush(),
    },
    readNotes: ({ at, limit } = {}) =>
      readNotesToday({ dataDir: settings.dataDir, at, limit }).catch(() => []),
    // Read-only and only while remembering is on — the clips tab's own rule for showing.
    readClips: ({ query, limit } = {}) =>
      settings.captureClipboard ? searchClips(clipboard.all(), query, limit) : null,
    searchTasks: (query, limit) => moco.search(query, limit),
    getModel: () => settings.chatModel,
    setModel: (name) => saveSettings({ chatModel: name }),
    getEngineMode: () => settings.chatEngine,
    hasCloudKey: async () => (await readKey()) !== null,
    // Spotlight, for the chat's search_files tool: looks, never opens or moves anything.
    searchFiles: fileSearch,
    // The notes the user already owns, across every day rather than only today's file.
    searchNotes: (query, limit) =>
      searchNotes({ dir: notesDir(settings.dataDir), query, limit }).catch((error) => {
        console.error('[app] note search failed:', error.message)
        return []
      }),
    /*
     * Messages, read-only and only ever as lines. The rows never leave this function as
     * rows: what the chat gets back is the same one-line-per-hit shape a clip search
     * returns, so a tool result cannot quietly become a database dump.
     */
    searchMessages: async (query, limit) => {
      const outcome = await searchMessages({ query, limit })
      if (outcome.blocked) return { blocked: true, hint: FULL_DISK_ACCESS_HINT }
      if (outcome.failed) return { failed: outcome.failed }
      return { lines: outcome.messages.map(formatRow) }
    },
    music: musicControl,
    /*
     * Opening is handed to macOS itself — the same call the Finder makes — rather than to
     * a shell. `open` with a crafted string is a command; shell.openPath is a path and
     * nothing else, which is the whole reason this is the only way out to the desktop.
     */
    openPath: async (path, { reveal } = {}) => {
      const wanted = expandHome(path)
      if (reveal) {
        shell.showItemInFolder(wanted)
        return { opened: true }
      }
      const error = await shell.openPath(wanted)
      return error ? { failed: error } : { opened: true }
    },
    inspectPath: async (path) => {
      const wanted = expandHome(path)
      const found = await stat(wanted).catch(() => null)
      return {
        exists: found !== null,
        path: wanted,
        name: basename(wanted),
        directory: Boolean(found?.isDirectory()),
      }
    },
  })

  /*
   * The rewrite popup: ⌃⌥R over a selection in any app.
   *
   * Three pieces, deliberately apart — selection.js borrows the clipboard and presses the
   * keys, controller.js holds the flow and the rule that nothing is replaced without a
   * click, and the window is just a window. The engine choice is made here, the same way
   * the chat makes it, so "This Mac only" means the same thing in both places.
   */
  const selection = createSelection({
    osascript,
    clipboard: {
      readText: async () => (await systemClipboard.readText()) ?? '',
      writeText: (text) => systemClipboard.writeText(text),
    },
    // Counted pause: a rewrite's clipboard traffic is not something the user copied.
    pauseClips: () => clipboard.pause(),
  })

  /**
   * Where a rewrite's words go: the chat's engine rule, applied to a one-shot ask.
   *
   * Local unless the user has chosen the cloud and saved a key — and refused outright when
   * cloud is chosen with no key, rather than quietly falling back to a local model and
   * rewriting in a different voice than the one they picked.
   */
  const askRewriteModel = async ({ prompt, signal }) => {
    const chosen = chooseEngine({
      mode: settings.chatEngine,
      hasCloudKey: (await readKey()) !== null,
    })

    if (chosen === 'needs-key') {
      throw new LlmUnavailable('Cloud is chosen in Settings → AI, but no OpenRouter key is saved.')
    }
    if (chosen === 'cloud') return askCloud({ system: REWRITE_SYSTEM, prompt, signal })

    const engine = await checkOllama({
      prefer: settings.chatModel,
      allowCloud: Boolean(settings.chatModel),
    })
    if (!engine.ok) throw new LlmUnavailable(engine.reason ?? 'No local model is available.')

    return askLocal({ model: engine.model, system: REWRITE_SYSTEM, prompt, signal })
  }

  const rewriteWindow = createRewriteWindow({ onClosed: () => rewrite.close() })

  const rewrite = createRewrite({
    selection,
    askModel: askRewriteModel,
    onState: (state) => rewriteWindow.send(IPC.rewriteState, state),
    openWindow: () => rewriteWindow.open(),
    closeWindow: () => rewriteWindow.close(),
    holdWindow: () => rewriteWindow.holdOpen(),
    /*
     * Passing true lets macOS put up its own dialog the first time. An app explaining a
     * permission is a worse experience than the system asking for it.
     */
    isAccessibilityTrusted: (prompt) => systemPreferences.isTrustedAccessibilityClient(prompt),
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

      if (event.type === 'cancelled') say(`dropped “${event.task}” — nothing logged`)

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

  /**
   * The global shortcuts, and the ability to change one without restarting.
   *
   * Registration is all-or-nothing per chord and there is no way to move one: unregister
   * everything and claim it again, which is cheap and keeps one code path instead of two.
   * `failed` travels into the snapshot so the Keys pane can say *which* chord another app
   * already owns, rather than leaving a key that silently does nothing.
   */
  const SHORTCUT_HANDLERS = {
    panel: () => actions.togglePanel(),
    note: () => actions.openPanel('note'),
    clips: () => actions.openPanel('clips'),
    timer: () => actions.toggleTimer(),
    rewrite: () => actions.rewrite(),
  }

  let shortcuts = { failed: [], dispose: () => {} }
  let recordingTimeout = null

  const bindShortcuts = () => {
    clearTimeout(recordingTimeout)
    recordingTimeout = null
    shortcuts.dispose()
    shortcuts = registerShortcuts(SHORTCUT_HANDLERS, settings.shortcuts)
    return shortcuts
  }

  /**
   * Every global shortcut stands down while the Keys pane is listening.
   *
   * Without this you cannot rebind the five chords that matter most: a registered global
   * shortcut is swallowed before any window sees it, so pressing ⌃⌥Space to record it
   * would open the panel instead. The timeout is the safety net — a settings window that
   * disappears mid-recording must not leave the keys switched off.
   */
  const standDownShortcuts = (recording) => {
    clearTimeout(recordingTimeout)
    if (!recording) return void bindShortcuts()

    shortcuts.dispose()
    shortcuts = { failed: [], dispose: () => {} }
    recordingTimeout = setTimeout(() => bindShortcuts(), RECORDING_GRACE_MS)
  }

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
      // The thread survives the panel closing, so a reopened panel gets it back.
      chat.start()
    },

    /**
     * The snapshot is refreshed first, on purpose: the question travels with a description
     * of the day, and answering "is anything running?" from a snapshot built ten minutes
     * ago is worse than not answering at all.
     */
    chatSend: async (text) => {
      await pushSnapshot()
      await chat.send(text)
    },
    chatStop: () => chat.stop(),
    chatClear: () => chat.clear(),
    chatOpened: () => chat.refresh(),
    /** Pressing a card: the confirm an irreversible act waits for, or an Undo. */
    chatAct: (id, choice) => chat.act(id, choice),
    chatModel: (name) => void chat.choose(name),

    /**
     * Where the chat's words may go, and the key behind the cloud side of that choice.
     * The key is write-only over IPC: it lands in the Keychain-backed store and is never
     * read back to a window — the settings pane learns "saved" from a boolean, not a key.
     */
    setAiEngine: (engine) => (saveSettings({ chatEngine: engine }), chat.recheck(), refresh()),
    saveAiKey: async (key) => {
      await saveKey(key)
      chat.recheck()
      say('cloud is ready — the chat now answers from it')
      refresh()
    },
    forgetAiKey: async () => {
      await forgetKey()
      chat.recheck()
      say('cloud key removed — answers stay on this Mac')
      refresh()
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
    /** Undo of a start: the stint is dropped rather than logged. See timer.js. */
    cancelTimer: () => (timer.cancel(), refresh()),
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

    /*
     * The rewrite popup. `rewriteUse` takes an index rather than text: the versions the
     * user read were produced here, and accepting a string back from the page would mean
     * pasting something nobody in this process had ever seen.
     */
    /** Dismissed for good, not for this window: it is a setting, not a session flag. */
    hideChatExamples: () => {
      saveSettings({ chatExamples: false })
      void pushSnapshot()
    },

    rewrite: () => void rewrite.start(),
    rewriteOpened: () => rewriteWindow.send(IPC.rewriteState, rewrite.state()),
    rewriteAsk: (instruction) => void rewrite.ask(instruction),
    rewriteUse: (index) => void rewrite.use(index),
    rewriteUndo: () => void rewrite.undo(),
    rewriteClose: () => rewrite.close(),
    rewriteHeight: (height) => rewriteWindow.setHeight(height),

    /**
     * Rebinding a shortcut, from Settings → Keys.
     *
     * Saved first and registered second, so a chord another app owns is still the one the
     * pane shows: the user picked it, it is theirs, and the snapshot's `failed` list says
     * it did not take. Quietly reverting to the old chord would be the worse lie.
     */
    setRecordingShortcut: (recording) => standDownShortcuts(recording),

    setShortcut: ({ id, accelerator }) => {
      if (!Object.hasOwn(SHORTCUT_HANDLERS, id)) return
      const wanted = accelerator === '' ? '' : normaliseAccelerator(accelerator)
      if (wanted === null) return

      saveSettings({ shortcuts: { ...settings.shortcuts, [id]: wanted } })
      bindShortcuts()
      // The menus print the live chord beside each item, so they are stale until rebuilt.
      refresh()
    },

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

    /**
     * The restart that swaps the app in.
     *
     * Quitting is declared before Squirrel is asked to do it: closing the windows is part
     * of quitAndInstall, and `window-all-closed` only quits when it knows that is what is
     * happening. Without it the windows go and the process stays, which is a restart that
     * never comes back.
     */
    openUpdate: () => {
      if (!updates.isReady()) return say('nothing to install yet')
      isQuitting = true
      updates.install()
    },
    checkForUpdates: () => updates.checkNow(),
    openReleases: () =>
      shell.openExternal(`${UPDATE_REPOSITORY}/releases`).catch(reportOnly('open the releases page')),
    openSettings: () => settingsWindow.open(),

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

  /*
   * A menu-bar app still wants a real application menu, for two reasons. ⌘, opening
   * Settings is muscle memory on a Mac, and without an Edit menu the panel's text fields
   * lose cut/copy/paste — the standard roles restore all of it at once.
   */
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: APP_NAME,
        submenu: [
          { role: 'about', label: `About ${APP_NAME}` },
          { type: 'separator' },
          { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: actions.openSettings },
          { type: 'separator' },
          { label: `Quit ${APP_NAME}`, accelerator: 'Cmd+Q', click: actions.quit },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
    ]),
  )

  const clearPendingUpdate = () => {
    pendingUpdate = null
    tray.refresh()
  }

  let manualCheckWaiting = false

  /*
   * The app now installs its own updates: Squirrel.Mac swaps a signed app, and this one
   * is signed. Found → fetched quietly in the background → a restart away, with the old
   * releases page kept as the escape hatch if that machinery ever says no.
   */
  const updates = startAutoUpdater({
    repositoryUrl: UPDATE_REPOSITORY,
    // --update-log=<path> writes the updater's story to a file: packaged apps lose stdout.
    logFile: process.argv.find((arg) => arg.startsWith('--update-log='))?.split('=')[1] ?? null,
    onAvailable: (version) => {
      manualCheckWaiting = false
      pendingUpdate = { version, state: 'downloading' }
      react('hop')
      say(`v${version} is out — fetching it`)
      tray.refresh()
    },
    onDownloaded: (version) => {
      pendingUpdate = { version, state: 'ready' }
      say(`v${version} is here — restart Bananino when you like`, 'excited')
      tray.refresh()
    },
    onNone: () => {
      if (manualCheckWaiting) say('already the newest Bananino')
      manualCheckWaiting = false
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
  bindShortcuts()

  win.webContents.once('did-finish-load', () => {
    void clipboard.start()
    void pushSnapshot()
    if (settings.alwaysVisible) perch.reveal()
  })

  win.on('moved', () => {
    if (!interaction.isDragging() && settings.alwaysVisible) {
      saveSettings({ position: perch.restingSpot(win.getPosition()) })
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
  maybeSnapshotSettings(settingsWindow, process.argv, actions.quit)
  maybeRunDemo(win, process.argv, IPC.command)

  app.on('before-quit', () => {
    isQuitting = true
    calendar.stop()
    stopCursorTracker()
    music.stop()
    updates.stop()
    unregisterIpc()
    shortcuts.dispose()
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
