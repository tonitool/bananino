import assert from 'node:assert/strict'
import test from 'node:test'
import {
  INVERSE_COMMAND,
  commandScript,
  createMusicControl,
  playNamedScript,
  quoteApplescript,
} from '../src/main/music/control.js'
import { PLAYERS } from '../src/main/music/players.js'

const MUSIC = PLAYERS.find(({ id }) => id === 'music')
const SPOTIFY = PLAYERS.find(({ id }) => id === 'spotify')

/** A player that answers a script the way osascript would, keyed by what it was asked. */
const fakePlayer = ({ running = 'true,true', track = {}, onCommand = () => {} } = {}) => {
  const seen = []
  const osascript = async (script) => {
    seen.push(script)
    if (script.includes('is running')) return running
    if (script.includes('player state is playing')) {
      const app = /tell application "(\w+)"/.exec(script)[1]
      const playing = track[app]
      return playing ? `${playing.title}\t${playing.artist}\t10\t200` : ''
    }
    onCommand(script)
    return 'ok'
  }
  return { osascript, seen, pause: async () => {} }
}

test('a name with a quote or a newline in it is searched for, not run', () => {
  // osascript takes one -e per line, so a newline would end the argument the name travels
  // in — and an unescaped quote would close the AppleScript string early. Either one turns
  // "play the album Don't Stop" into a second statement.
  assert.equal(quoteApplescript('Don"t\nStop'), '"Don\\"t Stop"')
  assert.equal(quoteApplescript('back\\slash'), '"back\\\\slash"')

  const script = playNamedScript(MUSIC, { kind: 'album', name: 'The "Best" Of\nreturn 1' })
  assert.equal(script.split('\n').length, 6, 'the name added a line of its own')
  assert.match(script, /whose album contains "The \\"Best\\" Of return 1"/)
})

test('Spotify is told plainly that it cannot be searched by name', async () => {
  // Its AppleScript dictionary plays a URI and nothing else, so the honest answer is the
  // limit and the way round it — not a silent no-op.
  assert.equal(playNamedScript(SPOTIFY, { kind: 'album', name: 'Swim' }), null)

  const fake = fakePlayer({ running: 'true,false' })
  const control = createMusicControl(fake)
  const outcome = await control.playNamed({ kind: 'album', name: 'Swim' })
  assert.match(outcome.failed, /Only Spotify is open/)
  assert.match(outcome.failed, /open Apple Music/)
})

test('a closed player is never spoken to, so nothing is launched', async () => {
  const fake = fakePlayer({ running: 'false,false' })
  const control = createMusicControl(fake)

  const outcome = await control.command('next')
  assert.match(outcome.failed, /Neither Apple Music nor Spotify is open/)
  // Only the "is running" question was ever asked — no `tell application` reached a player.
  assert.equal(fake.seen.length, 1)
  assert.doesNotMatch(fake.seen[0], /next track/)
})

test('a command goes to the player you can actually hear', async () => {
  // Both open, one playing: skipping the silent one would leave the music alone and look
  // like the buddy did nothing.
  const commands = []
  const fake = fakePlayer({
    running: 'true,true',
    track: { Music: { title: 'Cloudbusting', artist: 'Kate Bush' } },
    onCommand: (script) => commands.push(script),
  })

  const outcome = await createMusicControl(fake).command('next')
  assert.equal(outcome.player, 'Apple Music')
  assert.deepEqual(commands, [commandScript(MUSIC, 'next')])
  assert.equal(outcome.track.title, 'Cloudbusting')
})

test('every command has an opposite, which is what Undo presses', () => {
  assert.deepEqual(INVERSE_COMMAND, {
    play: 'pause',
    pause: 'play',
    next: 'previous',
    previous: 'next',
  })
})

test('an album Apple Music does not have is reported, not silently played', async () => {
  const fake = fakePlayer({ running: 'false,true' })
  const control = createMusicControl({
    ...fake,
    osascript: async (script) => {
      if (script.includes('is running')) return 'false,true'
      if (script.includes('player state is playing')) return ''
      return 'none'
    },
  })

  const outcome = await control.playNamed({ kind: 'album', name: 'Nonesuch' })
  assert.match(outcome.failed, /no album matching “Nonesuch”/)
})

test('a refused Automation permission becomes the sentence that names the switch', async () => {
  // The first command a Mac sees puts up a permission dialog, and a refused one comes back
  // as -1743 for ever after. Thrown, it would reach the user as "the model could not
  // answer" and send them looking in the wrong place.
  const denied = Object.assign(new Error('Command failed: osascript'), {
    stderr: 'execution error: Not authorized to send Apple events to Music. (-1743)',
  })

  const control = createMusicControl({
    osascript: async () => {
      throw denied
    },
    pause: async () => {},
  })

  assert.match((await control.command('next')).failed, /Privacy & Security → Automation/)
  assert.match((await control.playNamed({ kind: 'album', name: 'Swim' })).failed, /Automation/)
  // And the read used to describe an Undo stays quiet rather than taking the turn down.
  assert.equal(await control.current(), null)
})
