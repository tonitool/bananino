import assert from 'node:assert/strict'
import test from 'node:test'
import { AI_TARGETS, buildHandoff, isAiTarget } from '../src/main/ai/handoff.js'

test('targets that support prefilling get the note in the URL', () => {
  const chatgpt = buildHandoff('chatgpt', 'What did I commit to?')
  assert.equal(chatgpt.needsClipboard, false)
  assert.match(chatgpt.url, /^https:\/\/chatgpt\.com\/\?q=What%20did%20I%20commit%20to%3F$/)

  const claude = buildHandoff('claude', 'hello world')
  assert.equal(claude.url, 'https://claude.ai/new?q=hello%20world')
})

test('Gemini cannot prefill, so the note goes via the clipboard', () => {
  const gemini = buildHandoff('gemini', 'some note')
  assert.equal(gemini.url, 'https://gemini.google.com/app')
  assert.equal(gemini.needsClipboard, true)
})

test('a note too long for a URL falls back to the clipboard', () => {
  // Silently truncating someone's note in a URL would be worse than asking them to paste.
  const long = buildHandoff('chatgpt', 'x'.repeat(8000))
  assert.equal(long.url, 'https://chatgpt.com/')
  assert.equal(long.needsClipboard, true)
})

test('every URL stays on its own documented host', () => {
  for (const [name, target] of Object.entries(AI_TARGETS)) {
    const { url } = buildHandoff(name, 'note')
    assert.ok(url.startsWith(target.base), `${name} must stay on ${target.base}`)
  }
})

test('an unknown target falls back rather than building a bogus URL', () => {
  assert.equal(isAiTarget('nope'), false)
  assert.match(buildHandoff('nope', 'hi').url, /^https:\/\/chatgpt\.com\//)
})

test('an empty note opens the tool without a prompt or a clipboard nag', () => {
  const empty = buildHandoff('chatgpt', '   ')
  assert.equal(empty.url, 'https://chatgpt.com/')
  assert.equal(empty.needsClipboard, false)
})
