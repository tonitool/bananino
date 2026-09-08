/**
 * Where the chat's words may go, decided from two facts alone: the mode the user set in
 * Settings → AI, and whether an OpenRouter key is saved.
 *
 * 'cloud' without a key is refused — not silently downgraded to the local model — because
 * quietly changing where a sentence goes is exactly what the engine line exists to prevent.
 * 'auto' prefers the key: a machine with one pasted chose the cloud, and a machine without
 * one lost nothing by staying local.
 */
export const chooseEngine = ({ mode, hasCloudKey }) => {
  if (mode === 'local') return 'local'
  if (!hasCloudKey) return mode === 'cloud' ? 'needs-key' : 'local'
  return 'cloud'
}
