import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const walk = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return walk(path)
      return entry.name.endsWith('.js') ? [path] : []
    }),
  )
  return files.flat()
}

const namedExports = (source) => {
  const names = new Set()
  for (const [, name] of source.matchAll(/^export\s+(?:const|function|class|let)\s+([A-Za-z0-9_$]+)/gm)) {
    names.add(name)
  }
  // `export { a, b }` and `export { a as b }`
  for (const [, group] of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of group.split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (name) names.add(name)
    }
  }
  return names
}

/**
 * Catches a missing export before it becomes a launch-time crash. Electron cannot be
 * imported outside Electron, so the module graph is checked statically instead — an
 * editing slip once removed two functions and the packaged app died on startup with
 * "does not provide an export named".
 */
test('every relative import resolves to a real named export', async () => {
  const files = [...(await walk(join(ROOT, 'src')))]
  const sources = new Map()
  for (const file of files) sources.set(file, await readFile(file, 'utf8'))

  const problems = []

  for (const [file, source] of sources) {
    const imports = source.matchAll(/^import\s*\{([^}]*)\}\s*from\s*'(\.[^']+)'/gm)

    for (const [, group, specifier] of imports) {
      const target = resolve(dirname(file), specifier)
      const targetSource = sources.get(target)
      if (targetSource === undefined) {
        problems.push(`${file.replace(ROOT, '')} imports missing module ${specifier}`)
        continue
      }

      const available = namedExports(targetSource)
      for (const part of group.split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0]?.trim()
        if (name && !available.has(name)) {
          problems.push(`${file.replace(ROOT, '')} imports "${name}" which ${specifier} does not export`)
        }
      }
    }
  }

  assert.deepEqual(problems, [], `\n${problems.join('\n')}`)
})
