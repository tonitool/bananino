import { el } from '../../ui/dom.js'
import { group, row, button } from '../controls.js'

/**
 * Where the plain files live. The path is the star — shown as text you can read end to
 * end, not a breadcrumb — because "your notes are ordinary files on your disk" is the
 * app's whole promise, and hiding the path would make it a slogan.
 */
export const createFilesPane = ({ revealData, chooseDataFolder }) => {
  const pathEl = el('code', { class: 'path', text: '' })

  const root = el('div', { class: 'pane-body' }, [
    group(
      el('div', { class: 'row row--block' }, [
        el('div', { class: 'row-copy' }, [
          el('span', { class: 'row-title', text: 'Notes & time logs' }),
          el('div', { class: 'path-wrap' }, [pathEl]),
        ]),
      ]),
      row({
        label: 'Open the folder',
        description: 'Reveals it in Finder — notes are Markdown, time is plain text.',
        control: button({ text: 'Show in Finder', onclick: revealData }),
      }),
      row({
        label: 'Move it elsewhere',
        description: 'iCloud Drive, Dropbox, an external disk — wherever you keep files.',
        control: button({ text: 'Change folder…', onclick: chooseDataFolder }),
      }),
    ),
  ])

  const update = (snapshot) => {
    const dir = snapshot.settings?.dataDir
    if (dir) {
      pathEl.textContent = dir
      pathEl.title = dir
    }
  }

  return { root, update }
}
