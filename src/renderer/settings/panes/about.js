import { el } from '../../ui/dom.js'
import { button } from '../controls.js'

/** The back page of the book: who made it, which copy this is, where the new ones live. */
export const createAboutPane = ({ openReleases }) => {
  const version = el('p', { class: 'about-version', text: '…' })

  const root = el('div', { class: 'pane-body pane-body--about' }, [
    el('div', { class: 'about-card' }, [
      el('img', { class: 'about-icon', src: './icon.png', alt: 'Bananino' }),
      el('p', { class: 'about-name', text: 'Bananino' }),
      version,
      el('p', { class: 'about-blurb', text: 'A desk buddy that takes notes, tracks time, and remembers your clipboard — as plain files, on your own disk.' }),
      el('div', { class: 'about-actions' }, [
        button({ text: 'See releases on GitHub', onclick: openReleases, primary: true }),
      ]),
      el('p', { class: 'about-copy', text: '© 2026 Clue One · MIT' }),
    ]),
  ])

  const update = (snapshot) => {
    const v = snapshot.app?.version
    version.textContent = v ? `Version ${v}` : 'Version — development build'
  }

  return { root, update }
}
