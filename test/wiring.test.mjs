import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const sources = async (dir, out = []) => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await sources(path, out)
    else if (/\.(js|cjs|mjs)$/.test(entry.name)) out.push(path)
  }
  return out
}

test('nothing is imported and then left uncalled', async () => {
  /*
   * The failure this closes, twice over in one release:
   *
   * `updateMenuEntry` was imported at the top of menu.js and never called. The menu built
   * its update line inline instead, from an older idea of it — "Download v1.6.6…", fired
   * whatever state the download was in — while the helper that says "Restart Bananino for
   * v1.6.6" only when the download is staged sat unused beside it, with three passing
   * tests of its own. A module can be correct, tested, and reach nobody.
   *
   * `promisify` was the same shape and worse: imported, never called, and the name it was
   * supposed to produce — execFileAsync — used anyway. Every Spotlight search threw a
   * ReferenceError before reaching Spotlight, for as long as the feature has existed.
   *
   * Both are no-unused-vars findings, which is why `npm test` now runs eslint first. This
   * test exists so the rule cannot be quietly turned off: it asserts the config still
   * carries the two rules that would have caught these, and that the suite runs it.
   */
  const config = await readFile(join(ROOT, 'eslint.config.mjs'), 'utf8')
  assert.match(config, /'no-undef':\s*'error'/, 'no-undef is what catches a name that exists nowhere')
  assert.match(config, /'no-unused-vars':/, 'no-unused-vars is what catches a helper nobody calls')

  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  assert.match(pkg.scripts.test, /eslint/, 'npm test must lint: CI runs the tests, not the linter')
})

test('every module under src is reachable from another one', async () => {
  /*
   * The other half of the same problem: a file nobody imports at all. Checked by name
   * rather than by resolving every path, which is enough to catch a module that has been
   * orphaned by a rename or a rewrite — and cheap enough to run on every commit.
   */
  const files = await sources(join(ROOT, 'src'))
  const all = await Promise.all(files.map((file) => readFile(file, 'utf8')))
  const corpus = all.join('\n')

  /*
   * Reached without an import, so not orphans: electron's own two entry points, and
   * everything the renderer build names — read from the build script rather than listed
   * here, so a new entry point does not have to be remembered in two places.
   */
  const build = await readFile(join(ROOT, 'scripts', 'build-renderer.mjs'), 'utf8')
  const entries = new Set([
    'src/main/index.js',
    'src/preload/index.cjs',
    ...[...build.matchAll(/join\(ROOT,\s*((?:'[^']*',?\s*)+)\)/g)]
      .map(([, parts]) => parts.match(/'[^']*'/g).map((part) => part.slice(1, -1)).join('/'))
      .filter((path) => path.endsWith('.js') || path.endsWith('.cjs')),
  ])

  const orphans = files.filter((file) => {
    const path = file.slice(ROOT.length + 1)
    if (entries.has(path)) return false
    const stem = path.split('/').pop().replace(/\.(js|cjs|mjs)$/, '')
    // Imported by any relative path ending in this file's own name.
    return !new RegExp(`from '[^']*${stem}\\.(js|cjs|mjs)'`).test(corpus)
  })

  assert.deepEqual(orphans, [], `nothing imports: ${orphans.join(', ')}`)
})
