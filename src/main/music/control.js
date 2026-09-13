import { PLAYERS, parseRunning, parseTrack, runningScript, trackScript } from './players.js'
import { NOT_AUTHORISED } from './osascript.js'

/**
 * Working the players, rather than only watching them.
 *
 * Everything here obeys the rule nowPlaying.js already lives by: **never speak to a player
 * that is not already open**. `tell application "Music" to play` launches Music, and a
 * buddy that opens a music app because you asked it to skip a track is a buddy you turn
 * off. So a command finds a running player or refuses, and the refusal says which apps it
 * looked for.
 *
 * Nothing in here writes anything down. That is what makes these acts undoable in the
 * chat's sense — the worst a wrong one does is play the wrong song, and the Undo pill
 * asks for the opposite.
 */

/** What the buddy may ask a player to do, and the AppleScript verb for each. */
export const MUSIC_COMMANDS = Object.freeze({
  play: 'play',
  pause: 'pause',
  next: 'next track',
  previous: 'previous track',
})

/** Undo is the opposite command — the same thing a person would press to take it back. */
export const INVERSE_COMMAND = Object.freeze({
  play: 'pause',
  pause: 'play',
  next: 'previous',
  previous: 'next',
})

/** Which field a name is matched against, per kind of thing to play. */
const FIELDS = Object.freeze({ album: 'album', artist: 'artist', song: 'name' })

export const PLAY_KINDS = Object.freeze(['album', 'artist', 'song', 'playlist'])

/**
 * A name, made safe to drop inside a script.
 *
 * Two separate hazards: a quote or backslash would end the AppleScript string early, and a
 * newline would end the `-e` argument the line travels in — so a title carrying either
 * could otherwise run as script instead of being searched for.
 */
export const quoteApplescript = (value) =>
  `"${String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/[\\"]/g, (character) => `\\${character}`)
    .trim()
    .slice(0, 120)}"`

export const commandScript = ({ app }, command) =>
  [`tell application "${app}"`, MUSIC_COMMANDS[command], 'end tell', 'return "ok"'].join('\n')

/**
 * Finding something by name and playing it.
 *
 * Apple Music only, and not for want of trying: Spotify's AppleScript dictionary can play
 * a `spotify:` URI but cannot search the library for one, so asking it for "the new album"
 * is a question it has no verb for. The tool says that plainly rather than doing nothing —
 * and skip, pause and play still work there, because those it does have.
 */
export const playNamedScript = ({ app, id }, { kind, name }) => {
  if (id !== 'music') return null

  const needle = quoteApplescript(name)
  const found =
    kind === 'playlist'
      ? `set found to (every playlist whose name contains ${needle})`
      : `set found to (every track of library playlist 1 whose ${FIELDS[kind] ?? 'name'} contains ${needle})`

  return [
    `tell application "${app}"`,
    found,
    'if found is {} then return "none"',
    'play item 1 of found',
    'end tell',
    'return "ok"',
  ].join('\n')
}

/** How long to let a player settle before asking what it landed on. */
const SETTLE_MS = 500

const settle = () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS))

const NOTHING_OPEN = 'Neither Apple Music nor Spotify is open, so there is nothing to play.'

/**
 * An osascript failure as a sentence the chat can pass on.
 *
 * Automation is the one worth naming: the first command a Mac sees puts up a permission
 * dialog, and a refused one comes back as error -1743 for ever after. Left to throw, that
 * would reach the user as "the model could not answer", which sends them to the wrong
 * settings pane entirely.
 */
const explain = (error) => {
  const message = `${error?.stderr ?? ''}${error?.message ?? ''}`
  if (NOT_AUTHORISED.test(message)) {
    return {
      failed:
        'macOS has not allowed Bananino to control the music: System Settings → Privacy & ' +
        'Security → Automation → Bananino, and switch on Music or Spotify.',
    }
  }
  console.warn('[music] a player would not take that:', message.trim())
  return { failed: 'The player would not take that.' }
}

/**
 * The control surface, over an injected `osascript` so the whole thing can be driven by a
 * fake in a test — none of this can run on the machine the tests run on.
 */
export const createMusicControl = ({ osascript, pause = settle }) => {
  const running = async () =>
    parseRunning(await osascript(`return ${runningScript()}`)).map((id) =>
      PLAYERS.find((player) => player.id === id),
    )

  const trackOn = async (player) => parseTrack(player.id, await osascript(trackScript(player)))

  /**
   * Which player a command is meant for: the one you can actually hear, and otherwise the
   * one that is open. With both open and both idle the first in PLAYERS order wins —
   * arbitrary, but stable, and the reply always names the player it chose.
   */
  const target = async (players) => {
    for (const player of players) if (await trackOn(player)) return player
    return players[0] ?? null
  }

  /** What is playing now, after a beat — the sentence the chat answers with. */
  const settled = async (player) => {
    await pause()
    return trackOn(player).catch(() => null)
  }

  /** The two acts, named so the returned pair can wrap each one whole. */
  const runCommand = async (name) => {
    const players = await running()
    if (players.length === 0) return { failed: NOTHING_OPEN }

    const player = await target(players)
    await osascript(commandScript(player, name))
    return { player: player.label, track: await settled(player) }
  }

  const runPlayNamed = async ({ kind, name }) => {
    const wanted = String(name ?? '').trim()
    if (!wanted) return { failed: 'Nothing was named to play.' }

    const players = await running()
    if (players.length === 0) return { failed: NOTHING_OPEN }

    const player = players.find(({ id }) => id === 'music')
    if (!player) {
      return {
        failed:
          'Only Spotify is open, and its AppleScript cannot search a library by name. ' +
          'Skip, pause and play work there; open Apple Music to ask for something by name.',
      }
    }

    const answer = String(await osascript(playNamedScript(player, { kind, name: wanted }))).trim()
    if (answer === 'none') return { failed: `Apple Music has no ${kind} matching “${wanted}”.` }

    return { player: player.label, track: await settled(player) }
  }

  return {
    command: async (name) => {
      if (!MUSIC_COMMANDS[name]) {
        return { failed: `"${name}" is not something a player can be asked to do.` }
      }

      try {
        return await runCommand(name)
      } catch (error) {
        return explain(error)
      }
    },

    playNamed: async (request) => {
      try {
        return await runPlayNamed(request)
      } catch (error) {
        return explain(error)
      }
    },

    /** What is playing right now, asked once — so an act can say what it interrupted. */
    current: async () => {
      const players = await running().catch(() => [])
      const player = players.length > 0 ? await target(players) : null
      return player ? trackOn(player) : null
    },
  }
}

/**
 * One track as the line a model should quote: 'Blue Skies — Anna Calvi'.
 *
 * Without the player's name, because every caller has already said which player it spoke
 * to — and a sentence that names Spotify twice reads like a machine wrote it.
 */
export const describeTrack = (track) => (track ? `${track.title} — ${track.artist}` : null)
