/*
 * Checks that a packaged app is really signed with a Developer ID and really notarized.
 *
 * Worth a script of its own because electron-builder only *warns* when it cannot find a
 * certificate: it packages an unsigned app and exits 0. So the failure this guards against
 * is not a red build, it is a green one that produces a download macOS refuses — the exact
 * thing signing was added to fix. Nothing here trusts the build log; every claim is read
 * back off the bundle.
 *
 * Run it after `npm run dist`/`npm run release` on a Mac, and in the release workflow, so
 * a local signed build is checked the same way CI checks one.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_APP = 'release/mac-arm64/Bananino.app'

/*
 * `codesign --display` writes to stderr, and its exit status says nothing about *who*
 * signed — so the output is what has to be read, not the code.
 */
const run = (command, args) => {
  const { status, stdout, stderr } = spawnSync(command, args, { encoding: 'utf8' })
  return { status, output: `${stdout ?? ''}${stderr ?? ''}` }
}

/**
 * True only for a certificate issued by Apple's Developer ID authority.
 *
 * An ad-hoc signature satisfies `codesign --verify` perfectly happily — it is a valid
 * signature, just one that names nobody — so verification alone cannot tell the two
 * apart. This line can.
 */
export const isDeveloperIdSigned = (display) =>
  /^\s*Authority=Developer ID Application:/m.test(display)

/**
 * True when the hardened runtime is on, which notarization requires: without it Apple
 * rejects the submission, after the upload rather than before it.
 */
export const hasHardenedRuntime = (display) => {
  const flags = display.match(/^\s*CodeDirectory .*flags=(\S+)/m)?.[1]
  return flags != null && flags.includes('runtime')
}

/** The `source=` line, which is Gatekeeper's own words for why it allowed the app. */
export const gatekeeperSource = (assessment) =>
  assessment.match(/^\s*source=(.+)$/m)?.[1]?.trim() ?? 'unknown'

const verifySignature = (appPath) => {
  const failures = []
  const fail = (message) => failures.push(message)
  const check = (label) => console.log(`verify:signature: ${label}`)

  // The seal matches the contents, all the way down through every nested binary.
  const verified = run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
  if (verified.status !== 0) fail(`the signature does not match the bundle:\n${verified.output}`)
  else check('signature matches the bundle')

  const display = run('codesign', ['--display', '--verbose=2', appPath]).output
  if (!isDeveloperIdSigned(display)) {
    fail(
      'not signed with a Developer ID — an unsigned build is ad-hoc signed instead, ' +
        'which passes --verify but names nobody:\n' +
        display,
    )
  } else check('signed with a Developer ID')

  if (!hasHardenedRuntime(display)) {
    fail(`the hardened runtime is off, so notarization would be rejected:\n${display}`)
  } else check('hardened runtime on')

  /*
   * The native helpers sit outside the asar, because macOS cannot exec a file inside one.
   * That puts them outside the app's own code signature too — they are signed separately,
   * which makes them the likeliest thing to be missed.
   */
  const binDir = join(appPath, 'Contents/Resources/bin')
  let helpers = []
  try {
    helpers = readdirSync(binDir)
  } catch {
    fail(`no ${binDir} — the native helpers never reached the bundle`)
  }
  for (const name of helpers) {
    const helper = join(binDir, name)
    const helperVerified = run('codesign', ['--verify', '--strict', '--verbose=2', helper])
    const helperDisplay = run('codesign', ['--display', '--verbose=2', helper]).output
    if (helperVerified.status !== 0 || !isDeveloperIdSigned(helperDisplay)) {
      fail(`${name} is not signed with a Developer ID:\n${helperDisplay}`)
    } else check(`${name} signed with a Developer ID`)
  }

  /*
   * Notarized *and* stapled. Without the ticket in the bundle, first launch has to ask
   * Apple over the network — so an app that passes on this machine fails on one that is
   * offline when it is first opened.
   */
  const stapled = run('xcrun', ['stapler', 'validate', appPath])
  if (stapled.status !== 0) {
    fail(`no notarization ticket is stapled to the app:\n${stapled.output}`)
  } else check('notarization ticket stapled')

  /*
   * Last, the question the user's Mac will ask, asked the same way. Only the exit status
   * is a failure: the wording of `source=` has changed between macOS releases, and the
   * ticket has already been proved above, so it is reported rather than matched.
   */
  const assessed = run('spctl', ['--assess', '--type', 'exec', '--verbose=4', appPath])
  if (assessed.status !== 0) {
    fail(`Gatekeeper would refuse to open this app:\n${assessed.output}`)
  } else check(`Gatekeeper accepts it — source=${gatekeeperSource(assessed.output)}`)

  return failures
}

/* Exported for the tests below; only a direct run does the checking. */
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.platform !== 'darwin') {
    console.error('verify:signature: only a Mac can check a macOS signature')
    process.exit(1)
  }

  const appPath = process.argv[2] ?? DEFAULT_APP
  const failures = verifySignature(appPath)

  if (failures.length > 0) {
    console.error(`\nverify:signature: ${failures.length} problem(s) with ${appPath}:\n`)
    for (const failure of failures) console.error(`  ${failure}\n`)
    process.exit(1)
  }

  console.log(`\nverify:signature: ${appPath} is signed with a Developer ID and notarized`)
}
