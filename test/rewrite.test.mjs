import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_SELECTION, PRESETS, buildPrompt, parseVariants, preview } from '../src/main/rewrite/prompt.js'
import {
  ACCESSIBILITY_HINT,
  activateScript,
  createSelection,
  explain,
  keystrokeScript,
  parseFrontmost,
} from '../src/main/rewrite/selection.js'
import { createRewrite } from '../src/main/rewrite/controller.js'

/** A Mac with a clipboard, a frontmost app, and a selection that ⌘C can reach. */
const fakeMac = ({ selected = 'hi there', clipboard = 'something I copied earlier', front = 'com.apple.mail\tMail' } = {}) => {
  const log = []
  let board = clipboard

  return {
    log,
    board: () => board,
    selection: createSelection({
      osascript: async (script) => {
        if (script.includes('frontmost is true')) return front
        if (script.includes('keystroke "c"')) {
          log.push('copy')
          // ⌘C only changes the clipboard when something is selected.
          if (selected !== null) board = selected
          return 'ok'
        }
        if (script.includes('keystroke "v"')) return (log.push(`paste:${board}`), 'ok')
        if (script.includes('activate')) return (log.push('activate'), 'ok')
        return ''
      },
      clipboard: {
        readText: async () => board,
        writeText: async (text) => {
          board = text
          log.push(`write:${text.slice(0, 24)}`)
        },
      },
      pauseClips: () => {
        log.push('clips-paused')
        return () => log.push('clips-resumed')
      },
      sleep: async () => {},
    }),
  }
}

test('a reply is reduced to the versions and nothing else', () => {
  // This text goes straight over someone's selection, so the preamble, the numbering and
  // the quotes a model wraps things in are all damage.
  const variants = parseVariants(
    [
      'Sure! Here are three versions:',
      '1. Thanks — could you send the deck by Friday?',
      '---',
      '2. "Could you get the deck over to me by Friday?"',
      '---',
      '```',
      'Deck by Friday, please!',
      '```',
    ].join('\n'),
  )

  assert.deepEqual(variants, [
    'Thanks — could you send the deck by Friday?',
    'Could you get the deck over to me by Friday?',
    'Deck by Friday, please!',
  ])
})

test('a reply the model would not split is one version, not three invented ones', () => {
  assert.deepEqual(parseVariants('Deck by Friday, please.'), ['Deck by Friday, please.'])
  // Identical versions are one choice however often they are repeated.
  assert.deepEqual(parseVariants('Same line\n---\nSame line'), ['Same line'])
  assert.deepEqual(parseVariants('   \n---\n  '), [])
})

test('a quotation the user actually wrote keeps its quotes', () => {
  // Stripping the wrapper is only safe when the whole thing is wrapped and there are no
  // other quotes — otherwise `he said "no"` comes back mangled.
  assert.deepEqual(parseVariants('"He said "no" twice."'), ['"He said "no" twice."'])
  assert.deepEqual(parseVariants('"Just this once."'), ['Just this once.'])
})

test('the brief and the prompt keep the text and the instruction apart', () => {
  const prompt = buildPrompt({ text: 'make it so', instruction: 'Make it shorter.' })
  assert.match(prompt, /^Rewrite this text\. Make it shorter\./)
  assert.match(prompt, /The text:\nmake it so$/)

  // An empty instruction is still a rewrite, not an empty order.
  assert.match(buildPrompt({ text: 'x', instruction: '  ' }), /Improve it\./)
  assert.ok(PRESETS.every((preset) => preset.id && preset.label && preset.instruction))
})

test('the frontmost app is read as a bundle id, and anything odd is refused', () => {
  assert.deepEqual(parseFrontmost('com.apple.mail\tMail'), { bundleId: 'com.apple.mail', name: 'Mail' })
  // A bundle id is a name, not a script: it ends up inside `tell application id "…"`.
  assert.equal(parseFrontmost('" & (do shell script "boom") & "\tEvil'), null)
  assert.equal(parseFrontmost(''), null)
  assert.equal(activateScript('com.apple.mail'), 'tell application id "com.apple.mail" to activate\nreturn "ok"')
  assert.match(keystrokeScript('c'), /keystroke "c" using command down/)
})

test('a refused Accessibility permission names the pane to open', () => {
  const denied = { stderr: 'osascript is not allowed to send keystrokes (-1719)' }
  assert.equal(explain(denied), ACCESSIBILITY_HINT)
  assert.match(explain({ stderr: 'Not authorized to send Apple events (-1743)' }), /Automation/)
})

test('copying the selection borrows the clipboard and gives it back', async () => {
  const mac = fakeMac({ selected: 'hi there', clipboard: 'my bank details' })
  const captured = await mac.selection.capture()

  assert.equal(captured.text, 'hi there')
  // What was on the clipboard is handed back with the capture, so the paste can restore it.
  assert.equal(captured.yours, 'my bank details')
  // And the history never sees any of it.
  assert.equal(mac.log[0], 'clips-paused')
  assert.equal(mac.log.at(-1), 'clips-resumed')
})

test('nothing selected is noticed, instead of rewriting an old clipboard', async () => {
  // The failure that makes this feature dangerous: ⌘C with no selection leaves the
  // clipboard alone, so a naive read comes back with whatever was copied an hour ago.
  const mac = fakeMac({ selected: null, clipboard: 'a password I copied earlier' })
  const captured = await mac.selection.capture()

  assert.equal(captured.empty, true)
  assert.equal(captured.text, undefined)
  // And the clipboard is exactly as it was found.
  assert.equal(mac.board(), 'a password I copied earlier')
})

test('the paste goes back to the app the text came from, then the clipboard is restored', async () => {
  const mac = fakeMac()
  const captured = await mac.selection.capture()

  await mac.selection.replace({
    text: 'Hello there.',
    target: { bundleId: 'com.apple.mail', name: 'Mail' },
    yours: captured.yours,
  })

  // Activate before paste: the popup has focus by now, and pasting into it (or into
  // whatever else is in front) is the one mistake this must never make.
  const order = mac.log.filter((entry) => entry === 'activate' || entry.startsWith('paste:'))
  assert.deepEqual(order, ['activate', 'paste:Hello there.'])
  assert.equal(mac.board(), 'something I copied earlier', 'the clipboard was not given back')
})

/** The controller, over a selection that reports what it was asked to do. */
const fakeFlow = ({ capture, reply = 'One\n---\nTwo' } = {}) => {
  const replaced = []
  const states = []
  const restored = []
  let open = false
  let held = 0

  const rewrite = createRewrite({
    selection: {
      frontmost: async () => ({ bundleId: 'com.apple.mail', name: 'Mail' }),
      capture: async () => capture ?? { text: 'hi there', yours: 'old clip' },
      replace: async ({ text }) => (replaced.push(text), { replaced: true }),
      restore: async (text) => restored.push(text),
    },
    askModel: async () => reply,
    onState: (state) => states.push(state),
    openWindow: () => (open = true),
    closeWindow: () => (open = false),
    holdWindow: () => (held += 1),
  })

  return {
    rewrite,
    replaced,
    restored,
    states,
    held: () => held,
    isOpen: () => open,
    last: () => states.at(-1),
  }
}

test('nothing is replaced until a version is clicked', async () => {
  // The rule the whole feature rests on, and the same one the chat's cards follow.
  const flow = fakeFlow()

  await flow.rewrite.start()
  assert.equal(flow.last().stage, 'ready')
  assert.equal(flow.last().app, 'Mail')

  await flow.rewrite.ask('Make it friendlier')
  assert.equal(flow.last().stage, 'options')
  assert.deepEqual(flow.last().variants, ['One', 'Two'])
  assert.deepEqual(flow.replaced, [], 'asking for versions was enough to paste one')

  await flow.rewrite.use(1)
  assert.deepEqual(flow.replaced, ['Two'])
  assert.equal(flow.last().stage, 'replaced')
})

test('put it back pastes the original, while the popup still holds it', async () => {
  const flow = fakeFlow()
  await flow.rewrite.start()
  await flow.rewrite.ask('Shorter')
  await flow.rewrite.use(0)
  await flow.rewrite.undo()

  assert.deepEqual(flow.replaced, ['One', 'hi there'])

  // Closing lets the text go: holding someone's paragraph after they have moved on is a
  // leak waiting to turn up in a crash log.
  flow.rewrite.close()
  await flow.rewrite.undo()
  assert.deepEqual(flow.replaced, ['One', 'hi there'])
  assert.equal(flow.isOpen(), false)
})

test('a version the page invented cannot be pasted', async () => {
  // The renderer sends an index, and an index that is not one of the versions this process
  // produced does nothing at all.
  const flow = fakeFlow()
  await flow.rewrite.start()
  await flow.rewrite.ask('Shorter')

  await flow.rewrite.use(9)
  await flow.rewrite.use('wat')
  assert.deepEqual(flow.replaced, [])
})

test('an empty selection and an enormous one both explain themselves', async () => {
  const empty = fakeFlow({ capture: { empty: true, yours: 'x' } })
  await empty.rewrite.start()
  assert.equal(empty.last().stage, 'failed')
  assert.match(empty.last().error, /Nothing was selected/)
  assert.equal(empty.isOpen(), true, 'the popup has to open to say so')

  const huge = fakeFlow({ capture: { text: 'x'.repeat(MAX_SELECTION + 1), yours: '' } })
  await huge.rewrite.start()
  assert.match(huge.last().error, /more than I can rewrite/)
})

test('a model that answers with nothing usable does not become an empty paste', async () => {
  const flow = fakeFlow({ reply: '   ' })
  await flow.rewrite.start()
  await flow.rewrite.ask('Shorter')

  assert.equal(flow.last().stage, 'failed')
  assert.deepEqual(flow.replaced, [])
})

test('the preview is one readable line, however the selection was laid out', () => {
  assert.equal(preview('two\n\nlines   here'), 'two lines here')
  assert.equal(preview('x'.repeat(300)).length, 241)
})

test('the popup is held open across a paste, and hands the clipboard back on close', async () => {
  // Pasting has to make another app frontmost, which blurs this window — and a blurred
  // popup is normally a dismissed one. Without the hold, the popup vanishes at the exact
  // moment it has something to say, and "Put it back" is never reachable.
  const flow = fakeFlow()
  await flow.rewrite.start()
  await flow.rewrite.ask('Shorter')
  await flow.rewrite.use(0)
  assert.equal(flow.held(), 1)

  await flow.rewrite.undo()
  assert.equal(flow.held(), 2)

  // And a rewrite must not leave your selection sitting on the clipboard in place of
  // whatever you had copied: the buddy pressed ⌘C, not you.
  flow.rewrite.close()
  assert.deepEqual(flow.restored, ['old clip'])
})
