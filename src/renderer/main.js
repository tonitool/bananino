import './ui/styles/index.css'
import { createRenderer, resizeRenderer } from './scene/createRenderer.js'
import { createScene } from './scene/createScene.js'
import { addLighting } from './scene/lighting.js'
import { loadCharacter } from './scene/loadCharacter.js'
import { measureAnchors } from './scene/anchors.js'
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

  const character = await loadCharacter(renderer)
  scene.add(character.root)

  // Measured from the mesh, so a swapped-in model still gets its hat on its head.
  const anchors = measureAnchors(character.model)
  console.log('[anchors]', JSON.stringify(anchors))
  const costumeRack = createCostumeRack({ slot: character.costumeSlot, anchors })

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

  /** Costume and dance live outside the snapshot, so the panel is painted from both. */
  const paintPanel = () => {
    if (!lastSnapshot) return
    panel.update({
      ...lastSnapshot,
      costume: costumeRack.current(),
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
      mocoConnect: (payload) => bridge.mocoConnect(payload),
      mocoDisconnect: () => bridge.mocoDisconnect(),
      mocoPush: () => bridge.mocoPush(),
      mocoRefresh: () => bridge.mocoRefresh(),
      mocoDiscard: (id) => bridge.mocoDiscard(id),
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

  let musicPresence = 0
  let isPlaying = false


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

  bridge.onCommand((command) => {
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
      case 'costume':
        costumeRack.wear(command.name)
        return paintPanel()
      case 'dance':
        state = withDance(state, command.name ?? null)
        return paintPanel()
      default:
        console.warn('Unknown command from the main process:', command)
    }
  })

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
