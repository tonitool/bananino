/** Kept separate from the bubble so the character's voice is easy to rewrite. */
export const GREETINGS = Object.freeze([
  'hi hi!',
  'you rang?',
  'still here!',
  'peel-eased to see you',
  'boop',
  "what's up?",
  'i was just floating',
  'top of the bunch',
  'ready when you are',
])

export const GRUMBLES = Object.freeze([
  'weeee',
  'put me down!',
  'wheeee~',
  'flying!',
  'careful careful',
])

export const IDLE_MUSINGS = Object.freeze([
  'just vibing',
  'nice desktop',
  '*hums*',
  'take a break?',
  'zzz…',
])

export const pickFrom = (list, previous) => {
  if (list.length < 2) return list[0] ?? ''
  const options = list.filter((line) => line !== previous)
  return options[Math.floor(Math.random() * options.length)]
}
