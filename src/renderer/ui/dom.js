/** Tiny element factory: enough structure for a panel this size, no framework needed. */
export const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag)

  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value
    else if (key === 'dataset') Object.assign(node.dataset, value)
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
