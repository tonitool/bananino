import assert from 'node:assert/strict'
import test from 'node:test'
import { PLAYERS, parseRunning, parseTrack, runningScript, trackScript } from '../src/main/music/players.js'

test('the running probe names every player and coerces to text', () => {
  const script = runningScript()
  for (const { app } of PLAYERS) assert.ok(script.includes(`application "${app}" is running`), app)
  assert.ok(script.includes('as text'), 'AppleScript booleans must be coerced to concatenate')
})

test('the running reply maps onto player ids in order', () => {
  assert.deepEqual(parseRunning('false,true'), ['music'])
  assert.deepEqual(parseRunning('true,true'), ['spotify', 'music'])
  assert.deepEqual(parseRunning('false,false'), [])
  assert.deepEqual(parseRunning(''), [])
})

test('a track script only ever mentions its own player', () => {
  // One script naming both fails to compile on a Mac missing either app.
  const music = trackScript(PLAYERS.find((p) => p.id === 'music'))
  assert.ok(music.includes('application "Music"'))
  assert.ok(!music.includes('Spotify'))
})

test('durations are normalised to seconds per player', () => {
  assert.ok(trackScript(PLAYERS.find((p) => p.id === 'spotify')).includes('/ 1000'))
  assert.ok(trackScript(PLAYERS.find((p) => p.id === 'music')).includes('/ 1'))
})

test('a complete reply becomes a track', () => {
  const track = parseTrack('music', 'I Burned LA Down\tNoah Cyrus\t49\t178')
  assert.deepEqual(track, {
    player: 'music',
    playerLabel: 'Apple Music',
    title: 'I Burned LA Down',
    artist: 'Noah Cyrus',
    position: 49,
    duration: 178,
  })
})

test('nothing playing, or a partial reply, is not a track', () => {
  for (const output of ['', '   ', 'only a title', '\tArtist\t1\t2', 'a\tb\tc']) {
    assert.equal(parseTrack('music', output), null, JSON.stringify(output))
  }
})

test('unparseable numbers fall back to zero rather than NaN', () => {
  const track = parseTrack('music', 'Title\tArtist\tx\ty')
  assert.equal(track.position, 0)
  assert.equal(track.duration, 0)
})
