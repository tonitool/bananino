import './ui/styles/index.css'
import { createRenderer, resizeRenderer } from './scene/createRenderer.js'
import { createScene } from './scene/createScene.js'
import { addLighting } from './scene/lighting.js'
import { createCharacter } from './scene/characterRig.js'
import { characterId } from './scene/characters.js'
import { createCostumeRack } from './scene/costumes.js'
import { randomDance } from './animation/dances.js'
import { createAlphaHitTester } from './interaction/alphaHitTest.js'
import { createPointerController } from './interaction/pointer.js'
import { createSpeechBubble } from './ui/speechBubble.js'
import { createShadow } from './ui/shadow.js'
import { createMicCapture } from './audio/micCapture.js'
import { createStatusPill } from './ui/statusPill.js'
import { createMusicBox } from './ui/musicBox.js'
import { loadMusicScene } from './scene/musicScene.js'
import { loadClockScene } from './scene/clockScene.js'
import { createPanel } from './ui/panel/panel.js'
import { GREETINGS, GRUMBLES, IDLE_MUSINGS } from './ui/phrases.js'
import { applyLayout, toCanvasCursor } from './layout.js'
import { applyPose, poseFor, settleGaze, settlePresence } from './animation/animator.js'
import { HOP_HEIGHT } from './animation/reactions.js'
import {
  IDLE_FIDGET_DELAY,
  advance,
  createState,
  withDance,
  withDrag,
  withDragVelocity,
  withGaze,
  withGazeTarget,
  withHover,
  withPresence,
  withPresenceTarget,
  withReaction,
  isVisible,
} from './state/petState.js'

const MAX_FRAME_DELTA = 0.05
const IDLE_FIDGETS = ['stretch', 'wobble', 'hop']
const IDLE_MUSING_CHANCE = 0.3
const GREETING_CHANCE = 0.28

const bridge = window.pet

/**
 * Commands can arrive before boot finishes — the character model takes seconds to load,
 * and a focus-tab sent in that window used to drop on the floor, leaving the panel on the
 * wrong tab. Buffer until the real handler exists, then replay in order.
 */
const earlyCommands = []
const captureEarlyCommands = bridge?.onCommand((command) => earlyCommands.push(command))

const elements = {
  stage: document.getElementById('stage'),
  canvas: document.getElementById('scene'),
  bubble: document.getElementById('bubble'),
  shadow: document.getElementById('shadow'),
}

boot().catch((error) => {
  console.error('Bananino failed to start:', error)
  elements.bubble.textContent = 'i could not wake up 😵'
  elements.bubble.classList.add('is-visible')
})

async function boot() {
  if (!bridge) throw new Error('Preload bridge missing — the renderer cannot reach the app.')

  const renderer = createRenderer(elements.canvas)
  const { scene, camera } = createScene()
  addLighting(scene, renderer)

  const character = createCharacter(renderer)
  scene.add(character.root)

  /*
   * Which character to boot as arrives in the URL from the main process, so the saved
   * choice is on stage from the first frame instead of a banana that turns into a cat a
   * few seconds later.
   */
  let anchors = await character.load(
    characterId(new URLSearchParams(location.search).get('character')),
  )
  console.log('[anchors]', character.current(), JSON.stringify(anchors))
  const costumeRack = createCostumeRack({ slot: character.costumeSlot, anchors })

  /**
   * The character asked for, which is only the one on stage between swaps. Declared here
   * so the panel can be painted with it from the moment there is a character at all.
   */
  let wanted = character.current()

  const bubble = createSpeechBubble(elements.bubble)
  const shadow = createShadow(elements.shadow)
  const readAlphaAt = createAlphaHitTester({ renderer, canvas: elements.canvas })

  let state = createState()
  let isPanelOpen = false
  let wasRevealed = false
  // The main process decides when the character is on screen. `document.hidden` cannot be
  // trusted here: macOS reports transparent always-on-top windows as occluded, so it goes
  // true while the window is plainly visible, which froze the character and left every CSS
  // transition stuck at its start value.

  let lastSnapshot = null

  /**
   * Costume, dance and who is on stage live outside the snapshot, so the panel is painted
   * from both. The character is the renderer's, not the setting's: the setting is written
   * the instant a card is pressed and the model lands seconds later, so the panel is told
   * both — who is here, and who is on the way.
   */
  const paintPanel = () => {
    if (!lastSnapshot) return
    panel.update({
      ...lastSnapshot,
      costume: costumeRack.current(),
      character: character.current(),
      wantedCharacter: wanted,
      dance: state.dance?.name ?? null,
    })
  }

  const toggleDance = () => {
    state = withDance(state, state.dance ? null : randomDance())
    paintPanel()
  }

  const panel = createPanel({
    actions: {
      startMeeting: (payload) => bridge.startMeeting(payload),
      stopMeeting: () => bridge.stopMeeting(),
      saveNote: (text) => bridge.saveNote(text),
      noteMenu: (index) => bridge.noteMenu(index),
      deleteNote: (index) => bridge.deleteNote(index),
      startTimer: (task, binding, description) => bridge.startTimer({ task, binding, description }),
      stopTimer: () => bridge.stopTimer(),
      describeTimer: (text) => bridge.describeTimer(text),
      nudgeTimer: (minutes) => bridge.nudgeTimer(minutes),
      addManualTime: (payload) => bridge.addManualTime(payload),
      copyClip: (id) => bridge.copyClip(id),
      pinClip: (id) => bridge.pinClip(id),
      deleteClip: (id) => bridge.deleteClip(id),
      clearClips: () => bridge.clearClips(),
      revealData: () => bridge.revealData(),
      setPanelHeight: (height) => bridge.setPanelHeight(height),
      setCostume: (name) => {
        // Applied at once and persisted in the background: waiting for the round trip
        // would make the buttons feel broken.
        costumeRack.wear(name)
        bridge.setCostume(name)
        paintPanel()
      },
      toggleDance,
      setCharacter: (id) => {
        // Persisted first, swapped as the model arrives: the store is what the next
        // launch reads, and the load is far too slow to hold the click on.
        bridge.setCharacter(id)
        void swapCharacter(id)
      },
      mocoConnect: (payload) => bridge.mocoConnect(payload),
      mocoDisconnect: () => bridge.mocoDisconnect(),
      mocoPush: () => bridge.mocoPush(),
      mocoRefresh: () => bridge.mocoRefresh(),
      mocoDiscard: (id) => bridge.mocoDiscard(id),
      calendarConnect: (payload) => bridge.calendarConnect(payload),
      calendarDisconnect: () => bridge.calendarDisconnect(),
      calendarJoin: (url) => bridge.calendarJoin({ url }),
      calendarRefresh: () => bridge.calendarRefresh(),
      calendarAcknowledge: (id) => bridge.calendarAcknowledge({ id }),
      calendarSkip: (id) => bridge.calendarSkip({ id }),
    },
  })
  elements.stage.append(panel.root)

  // On the stage, not in the panel: the point is to be readable with the panel shut.
  const micCapture = createMicCapture({
    onChunk: (samples) => bridge.sendMicChunk(samples),
    onState: (state) => bridge.sendMicState(state),
  })

  const statusPill = createStatusPill()
  elements.stage.append(statusPill.root)

  const musicBox = createMusicBox()
  elements.stage.append(musicBox.root)

  // Charm, not function: if either prop fails to load the app carries on without them.
  const musicScene = await loadMusicScene({ anchors }).catch((error) => {
    console.warn('[music] props unavailable:', error.message)
    return null
  })
  if (musicScene) character.pivot.add(musicScene.root)

  // The meeting clock: same load-and-ease contract as the radio, driven by the calendar.
  const clockScene = await loadClockScene({ anchors }).catch((error) => {
    console.warn('[calendar] clock prop unavailable:', error.message)
    return null
  })
  if (clockScene) character.pivot.add(clockScene.root)

  let musicPresence = 0
  let isPlaying = false
  let clockPresence = 0
  let meetingSoon = false

  /**
   * Swaps who is on stage. The rig, the pose and the props are all kept — only the mesh
   * changes — but every measured placement is re-taken against the new body: a hat fitted
   * to a banana would hang beside a cat's head, and the radio would stand inside it.
   *
   * Comparing against the character *asked for* rather than the one that arrived is what
   * makes the main process's echo of a swap the panel started a no-op — and what keeps a
   * second press from starting the same load twice while the first is still in flight.
   */
  const swapCharacter = async (id) => {
    const requested = characterId(id)
    if (requested === wanted) return
    wanted = requested
    // Painted before the await: this is what puts the spinner on the card that was
    // pressed, and it is the only feedback until the mesh arrives.
    paintPanel()

    let measured
    try {
      measured = await character.load(requested)
    } catch (error) {
      console.error(`[character] could not load "${requested}":`, error)
      bubble.say('i could not find that body 😵', { tone: 'sad' })
      wanted = character.current()
      paintPanel()
      return
    }
    // Null means a later swap got there first, and owns the rig and the anchors now.
    if (!measured) return

    anchors = measured
    console.log('[anchors]', character.current(), JSON.stringify(anchors))
    costumeRack.refit(anchors)
    musicScene?.place(anchors)
    clockScene?.place(anchors)
    // A hop on arrival: the new body says hello, and it covers the frame it appears on.
    state = withReaction(state, 'hop')
    paintPanel()
  }


  const setInteractive = (value) => {
    // With the panel open the whole window is a target, not just the silhouette.
    bridge.setInteractive(isPanelOpen || value)
  }

  /**
   * Cursor samples only record where to look; the test itself happens in the render loop,
   * straight after a render, because that is when the drawing buffer holds the frame.
   */
  let pendingCursor = null

  /**
   * The canvas is a square box around the character, most of which is empty air. With the
   * panel open the whole window accepts clicks, so presses are checked against the
   * silhouette too — otherwise clicking beside the character starts a phantom drag.
   *
   * Uses the hover state the render loop keeps fresh, rather than testing again here: a
   * press outside the loop has no guaranteed frame to read from.
   */
  const isOverCharacter = () => state.isHovered

  const pointer = createPointerController({
    hitTest: (cursor) => {
      pendingCursor = toCanvasCursor(cursor, elements.canvas)
      // The answer from the last frame; the loop refreshes it within ~16ms.
      return state.isHovered
    },
    handlers: {
      onGaze: (gazeTarget) => {
        state = withGazeTarget(state, gazeTarget)
      },
      onDragVelocity: (velocity) => {
        state = withDragVelocity(state, velocity)
      },
      onGrab: () => {
        state = withDrag(withReaction(state, 'squish'), true)
        elements.stage.dataset.dragging = 'true'
        bridge.startDrag()
      },
      onRelease: ({ wasClick, isSecondClick }) => {
        state = withDrag(state, false)
        elements.stage.dataset.dragging = 'false'
        bridge.endDrag()

        if (!wasClick) {
          state = withReaction(state, 'wobble')
          bubble.say(GRUMBLES)
          return
        }
        // A double click spins instead; skipping the toggle keeps that reading clearly.
        if (isSecondClick) return
        bridge.togglePanel()
      },
      onMenu: () => bridge.openMenu(),
    },
  })

  bridge.onCursorMoved(pointer.onCursorMoved)
  bridge.onMocoCatalogue((tasks) => panel.setMocoTasks(tasks))

  bridge.onSnapshot((snapshot) => {
    lastSnapshot = snapshot

    const saved = snapshot.settings?.costume ?? 'none'
    if (saved !== costumeRack.current()) costumeRack.wear(saved)

    paintPanel()
    statusPill.update(snapshot)
    musicBox.update(snapshot.nowPlaying)
    isPlaying = Boolean(snapshot.nowPlaying)

    const next = snapshot.calendar?.upcoming?.[0] ?? null
    const leadMs = (snapshot.settings?.calendarClockLeadMinutes ?? 15) * 60_000
    // The clock stands by the character from lead time until the meeting is over.
    meetingSoon = Boolean(next && next.startMs <= Date.now() + leadMs && next.endMs > Date.now())
  })

  bridge.onPanelState((panelState) => {
    const wasOpen = isPanelOpen
    isPanelOpen = panelState.isPanelOpen
    state = withPresenceTarget(state, panelState.isRevealed !== false)

    // A greeting every single time the corner is brushed would wear thin fast.
    if (panelState.isRevealed && !wasRevealed && !isPanelOpen && Math.random() < GREETING_CHANCE) {
      bubble.say(GREETINGS)
    }
    wasRevealed = panelState.isRevealed
    applyLayout(elements.stage, panelState)
    resizeRenderer(renderer, camera)
    shadow.anchor(camera, elements.canvas)
    setInteractive(state.isHovered)

    if (isPanelOpen && !wasOpen) {
      state = withReaction(state, 'hop')
      panel.focusActive()
    }
  })

  bridge.onCommand((command) => handleCommand(command))

  const handleCommand = (command) => {
    switch (command?.type) {
      case 'toast':
        return bubble.say(command.text, { tone: command.tone })
      case 'react':
        return void (state = withReaction(state, command.name))
      case 'focus-tab':
        return panel.focusTab(command.tab)
      case 'mic-start':
        return void micCapture.start()
      case 'mic-stop':
        return void micCapture.stop()
      case 'note-saved':
        return panel.clearNoteInput()
      case 'manual-added':
        return panel.resetManual()
      case 'moco-error':
        return bubble.say(command.message, { tone: 'sad', duration: 5000 })
      case 'calendar-error':
        return bubble.say(command.message, { tone: 'sad', duration: 5000 })
      case 'costume':
        costumeRack.wear(command.name)
        return paintPanel()
      case 'character':
        // Sent by the menu bar, and echoed back for a swap the panel started — which
        // swapCharacter drops, since that character is the one already asked for.
        return void swapCharacter(command.id)
      case 'dance':
        state = withDance(state, command.name ?? null)
        return paintPanel()
      default:
        console.warn('Unknown command from the main process:', command)
    }
  }

  captureEarlyCommands?.()
  for (const queued of earlyCommands.splice(0)) handleCommand(queued)

  /**
   * Captured on the stage rather than the canvas, and only claimed when the pointer is
   * actually over the character. Anywhere else — including the part of the panel the
   * character overlaps — the event carries on to the control underneath.
   */
  const claimIfOverCharacter = (handler) => (event) => {
    if (!isOverCharacter(event)) return
    event.stopPropagation()
    event.preventDefault()
    handler(event)
  }

  elements.stage.addEventListener('pointerdown', claimIfOverCharacter(pointer.onPointerDown), true)
  elements.stage.addEventListener('contextmenu', claimIfOverCharacter(pointer.onContextMenu), true)
  elements.stage.addEventListener(
    'dblclick',
    claimIfOverCharacter(() => {
      state = withReaction(state, 'spin')
    }),
    true,
  )
  window.addEventListener('pointerup', pointer.onPointerUp)
  window.addEventListener('pointercancel', pointer.onPointerUp)
  window.addEventListener('dragstart', (event) => event.preventDefault())
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') bridge.closePanel()
  })

  resizeRenderer(renderer, camera)
  shadow.anchor(camera, elements.canvas)
  window.addEventListener('resize', () => {
    resizeRenderer(renderer, camera)
    shadow.anchor(camera, elements.canvas)
  })

  bridge.requestSnapshot()

  // Written straight to the element: a CSS transition here would not run at all.
  let paintedOpacity = 1
  const setCanvasOpacity = (presence) => {
    const next = Math.min(1, Math.max(0, presence))
    if (Math.abs(next - paintedOpacity) < 0.003) return
    paintedOpacity = next
    elements.canvas.style.opacity = String(next)
  }

  let lastFrame = performance.now()

  const frame = (now) => {
    // Clamped so a hidden window does not resume with one enormous time step.
    const dt = Math.min((now - lastFrame) / 1000, MAX_FRAME_DELTA)
    lastFrame = now

    // Tucked away in the corner means no GPU work at all — but the exit animation has to
    // finish playing first.
    if (!isVisible(state)) return requestAnimationFrame(frame)

    state = advance(state, dt)
    state = withPresence(state, settlePresence(state.presence, state.presenceTarget, dt))
    state = withGaze(state, settleGaze(state.gaze, state.gazeTarget, dt))
    state = maybeFidget(state, bubble, isPanelOpen)

    // Eased in the loop for the same reason the character is: CSS transitions do not run
    // on this window when it is unfocused.

    // Eased in the loop for the same reason the character is: CSS transitions do not run
    // on this window while it is unfocused.
    musicPresence = settlePresence(musicPresence, isPlaying ? 1 : 0, dt)
    // Folded together with the character's own presence: the props belong to the
    // character, so they must leave with it rather than linger on an empty desktop.
    musicScene?.update({ clock: state.clock, presence: musicPresence * state.presence })
    clockPresence = settlePresence(clockPresence, meetingSoon ? 1 : 0, dt)
    clockScene?.update({ presence: clockPresence * state.presence })
    musicBox.tick(state.clock)

    const pose = poseFor(state)
    applyPose(character, pose)
    setCanvasOpacity(state.presence)
    shadow.update(pose.offsetY / HOP_HEIGHT)

    renderer.render(scene, camera)

    // Read after rendering, while the frame is still in the drawing buffer.
    if (pendingCursor) {
      const isOver = readAlphaAt(pendingCursor)
      pendingCursor = null
      if (isOver !== state.isHovered) {
        state = withHover(state, isOver)
        elements.stage.dataset.hovered = String(isOver)
        setInteractive(isOver)
      }
    }

    requestAnimationFrame(frame)
  }

  requestAnimationFrame(frame)
}

/** Left alone long enough, the character does something small on its own. */
function maybeFidget(state, bubble, isPanelOpen) {
  if (isPanelOpen || state.dance) return state
  if (state.timeSinceInteraction < IDLE_FIDGET_DELAY) return state
  if (state.reactions.length > 0 || state.isDragging) return state

  if (Math.random() < IDLE_MUSING_CHANCE) bubble.say(IDLE_MUSINGS)
  const fidget = IDLE_FIDGETS[Math.floor(Math.random() * IDLE_FIDGETS.length)]
  return withReaction(state, fidget)
}
