import globals from 'globals'

/*
 * One rule, and the reason for it is in the release notes for 1.6.7.
 *
 * `const { stdout } = await execFileAsync('mdfind', args, …)` — a name that existed
 * nowhere in the project. `execFile` and `promisify` were both imported at the top of the
 * same file and never brought together, so every Spotlight search since the feature
 * shipped threw a ReferenceError before reaching Spotlight. Nothing caught it: the search
 * takes `mdfind` as an argument, so its tests hand in a fake one and never execute that
 * line, and `node --check` only parses. It took a user pressing a button in Settings.
 *
 * This is not a style config and deliberately turns nothing else on. Formatting opinions
 * would bury the one rule that matters under a thousand findings nobody reads, and the
 * point here is a check that is always worth running and never worth arguing with: a name
 * that is not defined anywhere is a bug in every codebase, whatever its house style.
 */
export default [
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ignores: ['dist/**', 'build/**', 'node_modules/**', 'src/renderer/**/*.bundle.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    linterOptions: { reportUnusedDisableDirectives: true },
    rules: {
      'no-undef': 'error',
      /*
       * The other half of the same mistake: `promisify` sat imported and unused for as
       * long as the call beside it was broken, which is the tell that would have found
       * this without anyone running the app.
       */
      'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
  },
  /*
   * The PCM worklet runs on the audio thread, in its own scope: no window, no document,
   * and two globals nothing else in the app has. It is copied rather than bundled — see
   * scripts/build-renderer.mjs — which is the same reason it needs saying here.
   */
  {
    files: ['src/renderer/audio/pcmWorklet.js'],
    languageOptions: { globals: globals.audioWorklet },
  },
]
