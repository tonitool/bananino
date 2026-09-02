import { execFileSync } from 'node:child_process'

/**
 * electron-builder with `"identity": null` skips signing entirely, leaving the
 * linker-signed Electron signature in place. That seal no longer matches the
 * modified bundle, so Gatekeeper reports a downloaded copy as "damaged" even
 * after its quarantine flag is removed. Re-signing ad-hoc regenerates a
 * seal consistent with the contents: still untrusted (unidentified developer),
 * but structurally valid, so `xattr -dr com.apple.quarantine` is enough to
 * launch it.
 */
export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
}
