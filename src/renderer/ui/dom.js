/** Tiny element factory: enough structure for a panel this size, no framework needed. */
export const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag)

  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value
    else if (key === 'dataset') Object.assign(node.dataset, value)
    /*
     * Custom properties go through the CSSOM, never a style attribute. The app's CSP is
     * `style-src 'self'`, which refuses an inline style attribute outright — a swatch
     * coloured that way renders with no colour at all and only says so in the console.
     * Setting the property programmatically is not an inline style, so it is allowed.
     */
    else if (key === 'vars') {
      for (const [name, custom] of Object.entries(value)) node.style.setProperty(name, custom)
    }
    else if (key === 'text') node.textContent = value
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value)
    else if (value === true) node.setAttribute(key, '')
    else if (value !== false && value != null) node.setAttribute(key, String(value))
  }

  for (const child of [children].flat()) {
    if (child != null) node.append(child)
  }
  return node
}

export const clear = (node) => {
  node.replaceChildren()
  return node
}

export const setHidden = (node, hidden) => node.toggleAttribute('hidden', hidden)
