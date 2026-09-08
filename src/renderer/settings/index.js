import './settings.css'
import { el } from '../ui/dom.js'
import { createLayout } from './layout.js'
import { createAiPane } from './panes/ai.js'
import { createBuddyPane } from './panes/buddy.js'
import { createWardrobePane } from './panes/wardrobe.js'
import { createBehaviourPane } from './panes/behaviour.js'
import { createFilesPane } from './panes/files.js'
import { createAboutPane } from './panes/about.js'

const bridge = window.pet
const host = document.getElementById('settings-window')

if (!bridge) {
  host.replaceChildren(
    el('p', {
      class: 'bridge-error',
      text: 'Bananino is not answering — this window only makes sense inside the app. Open it by right-clicking the buddy.',
    }),
  )
} else {
  boot(bridge)
}

function boot(bridge) {
  const buddy = createBuddyPane({
    setCharacter: (id) => bridge.setCharacter(id),
    setSize: (key) => bridge.setSize(key),
  })
  const wardrobe = createWardrobePane({
    setLook: (id) => bridge.setLook(id),
    setCostume: (name) => bridge.setCostume(name),
    setShirt: (id) => bridge.setShirt(id),
    setDance: (name) => bridge.setDance(name),
  })
  const behaviour = createBehaviourPane({
    setAlwaysVisible: (on) => bridge.setAlwaysVisible(on),
    setCorner: (corner) => bridge.setCorner(corner),
    setCaptureClipboard: (on) => bridge.setCaptureClipboard(on),
    setShowNowPlaying: (on) => bridge.setShowNowPlaying(on),
  })
  const files = createFilesPane({
    revealData: () => bridge.revealData(),
    chooseDataFolder: () => bridge.chooseDataFolder(),
  })
  const about = createAboutPane({ openReleases: () => bridge.openReleases() })
  const ai = createAiPane({
    setEngine: (mode) => bridge.setAiEngine(mode),
    saveKey: (key) => bridge.saveAiKey(key),
    forgetKey: () => bridge.forgetAiKey(),
  })

  const sections = [
    {
      id: 'buddy',
      label: 'Buddy',
      blurb: 'Who lives on your desktop, and how big it stands.',
      tint: 'var(--tint-butter)',
      view: buddy,
    },
    {
      id: 'wardrobe',
      label: 'Wardrobe',
      blurb: 'What it wears — one look dresses cap and shirt together.',
      tint: 'var(--tint-blush)',
      view: wardrobe,
    },
    {
      id: 'ai',
      label: 'AI',
      blurb: 'Where the chat’s words go, and whose key pays for the cloud.',
      tint: 'var(--tint-coral)',
      view: ai,
    },
    {
      id: 'behaviour',
      label: 'Behaviour',
      blurb: 'When it appears, and what it keeps in mind.',
      tint: 'var(--tint-sky)',
      view: behaviour,
    },
    {
      id: 'files',
      label: 'Files',
      blurb: 'Where your notes and time logs live — plain files, yours to read.',
      tint: 'var(--tint-lilac)',
      view: files,
    },
    {
      id: 'about',
      label: 'About',
      blurb: 'Which Bananino this is, and where new ones come from.',
      tint: 'var(--tint-sage)',
      view: about,
    },
  ]

  const layout = createLayout({ sections })
  host.append(layout.root)

  // The window requests on open and gets every change after; controls repaint from the
  // snapshot alone, so the window never drifts from the menu bar's truth.
  bridge.onSnapshot((snapshot) => {
    for (const section of sections) section.view.update(snapshot)
  })
  bridge.requestSnapshot()
}
