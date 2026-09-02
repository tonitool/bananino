import { REACTIONS, isReactionName } from '../animation/reactions.js'
import { isDanceName } from '../animation/dances.js'

/** Seconds of no interaction before the character entertains itself. */
export const IDLE_FIDGET_DELAY = 14

export const createState = () => ({
  reactions: [],
  gaze: { x: 0, y: 0 },
  gazeTarget: { x: 0, y: 0 },
  dragVelocity: { x: 0, y: 0 },
  isDragging: false,
  isHovered: false,
  dance: null,
  // Eased in the render loop rather than by CSS: an unfocused, transparent, always-on-top
  // window is not composited by Chromium, so CSS transitions on it freeze at their start
  // value and the character appeared to pop in and out.
  presence: 1,
  presenceTarget: 1,
  timeSinceInteraction: 0,
  clock: 0,
})

export const withReaction = (state, name) => {
  if (!isReactionName(name)) {
    console.warn(`Unknown reaction "${name}" ignored.`)
    return state
  }
  return {
    ...state,
    // Restarting an in-flight reaction of the same name reads better than stacking it.
    reactions: [...state.reactions.filter((r) => r.name !== name), { name, elapsed: 0 }],
    timeSinceInteraction: 0,
  }
}

/** `null` stops dancing; an unknown name is refused rather than crashing the loop. */
export const withDance = (state, name) => {
  if (name === null) return { ...state, dance: null, timeSinceInteraction: 0 }
  if (!isDanceName(name)) {
    console.warn(`Unknown dance "${name}" ignored.`)
    return state
  }
  return { ...state, dance: { name, elapsed: 0 }, timeSinceInteraction: 0 }
}

export const withGazeTarget = (state, gazeTarget) => ({ ...state, gazeTarget })

export const withHover = (state, isHovered) =>
  state.isHovered === isHovered ? state : { ...state, isHovered }

export const withDrag = (state, isDragging) => ({
  ...state,
  isDragging,
  timeSinceInteraction: 0,
  dragVelocity: isDragging ? state.dragVelocity : { x: 0, y: 0 },
})

export const withDragVelocity = (state, dragVelocity) => ({ ...state, dragVelocity })

export const advance = (state, dt) => ({
  ...state,
  clock: state.clock + dt,
  timeSinceInteraction: state.timeSinceInteraction + dt,
  dance: state.dance ? { ...state.dance, elapsed: state.dance.elapsed + dt } : null,
  reactions: state.reactions
    .map((r) => ({ ...r, elapsed: r.elapsed + dt }))
    .filter((r) => r.elapsed < REACTIONS[r.name].duration),
})

export const isBusy = (state) => state.reactions.length > 0 || state.isDragging || state.dance !== null

export const withGaze = (state, gaze) => ({ ...state, gaze })

export const withPresenceTarget = (state, isOnScreen) => ({
  ...state,
  presenceTarget: isOnScreen ? 1 : 0,
})

export const withPresence = (state, presence) => ({ ...state, presence })

/** Still worth drawing while it fades, or the exit animation would never be seen. */
export const isVisible = (state) => state.presence > 0.004 || state.presenceTarget === 1
