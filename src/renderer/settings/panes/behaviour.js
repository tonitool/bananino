import { el } from '../../ui/dom.js'
import { group, row, toggle, segmented } from '../controls.js'
import { CORNERS } from '../../../main/constants.js'

const CORNER_LABELS = {
  'bottom-right': 'Bottom right',
  'bottom-left': 'Bottom left',
  'top-right': 'Top right',
  'top-left': 'Top left',
}

/**
 * When the buddy appears and what it remembers. These used to be bare menu items; here
 * each one gets the one line of "why" a menu never had room for.
 */
export const createBehaviourPane = ({ setAlwaysVisible, setCorner, setCaptureClipboard, setShowNowPlaying }) => {
  const pin = toggle({ label: 'Keep the buddy on screen', onChange: setAlwaysVisible })
  const clips = toggle({ label: 'Remember the clipboard', onChange: setCaptureClipboard })
  const music = toggle({ label: "Show what's playing", onChange: setShowNowPlaying })

  const corner = segmented({
    label: 'Wake corner',
    options: Object.keys(CORNERS).map((key) => [key, CORNER_LABELS[key]]),
    onChange: setCorner,
  })

  const root = el('div', { class: 'pane-body' }, [
    group(
      row({
        label: 'Keep the buddy on screen',
        description: 'Stays where you drag it. Off, it sleeps in the corner below until your cursor rests there.',
        control: pin.root,
      }),
      row({
        label: 'Wake in corner',
        description: 'The screen corner that summons a hidden buddy — picking one unpins it.',
        control: corner.root,
      }),
    ),
    group(
      row({
        label: 'Remember the clipboard',
        description: 'Keeps a short history of things you copy, a ⌃⌥V away.',
        control: clips.root,
      }),
      row({
        label: "Show what’s playing",
        description: 'Asks Music and Spotify for the current track and sets the radio beside the buddy.',
        control: music.root,
      }),
    ),
  ])

  const update = (snapshot) => {
    const settings = snapshot.settings ?? {}
    pin.set(settings.alwaysVisible)
    clips.set(settings.captureClipboard !== false)
    music.set(settings.showNowPlaying)
    if (settings.corner) corner.set(settings.corner)
    // The corner only matters while the buddy can hide; pinned means it never does.
    corner.root.dataset.disabled = String(Boolean(settings.alwaysVisible))
  }

  return { root, update }
}
