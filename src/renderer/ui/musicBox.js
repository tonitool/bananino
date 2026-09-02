import { el, setHidden } from './dom.js'

/**
 * A small card beside the character naming the track, with the album cover when the player
 * will give one and a turning disc when it will not.
 *
 * Kept separate from the status pill: a track and a running timer are different kinds of
 * information, and sharing one badge meant whichever came second was never seen.
 */
export const createMusicBox = () => {
  const cover = el('img', { class: 'music-cover', alt: '' })
  const disc = el('span', { class: 'music-disc', 'aria-hidden': 'true' })
  const title = el('span', { class: 'music-title' })
  const artist = el('span', { class: 'music-artist' })

  const root = el('div', { class: 'music-box', 'aria-live': 'polite' }, [
    el('span', { class: 'music-art' }, [cover, disc]),
    el('span', { class: 'music-text' }, [title, artist]),
  ])

  let spinning = false

  const update = (nowPlaying) => {
    setHidden(root, !nowPlaying)
    spinning = Boolean(nowPlaying)
    if (!nowPlaying) return

    title.textContent = nowPlaying.title
    artist.textContent = nowPlaying.artist
    root.title = `${nowPlaying.title} — ${nowPlaying.artist} (${nowPlaying.playerLabel})`

    const hasCover = Boolean(nowPlaying.artwork)
    if (hasCover && cover.getAttribute('src') !== nowPlaying.artwork) {
      cover.setAttribute('src', nowPlaying.artwork)
    }
    setHidden(cover, !hasCover)
    setHidden(disc, hasCover)
  }

  /**
   * Turned from the render loop rather than by a CSS animation: this window is not
   * composited while unfocused, so a CSS animation simply never advances.
   */
  const tick = (clock) => {
    if (!spinning || !disc.isConnected) return
    disc.style.rotate = `${(clock * 90) % 360}deg`
  }

  return { root, update, tick }
}
