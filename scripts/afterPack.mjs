import { execFileSync } from 'node:child_process'

/**
 * Gives an unsigned build a signature consistent with its own contents.
 *
 * With no Developer ID to hand, electron-builder skips signing and leaves the
 * linker-signed Electron signature in place. That seal no longer matches the
 * modified bundle, so Gatekeeper reports a downloaded copy as "damaged" even
 * after its quarantine flag is removed. Re-signing ad-hoc regenerates a seal
 * consistent with the contents: still untrusted (unidentified developer), but
 * structurally valid, so `xattr -dr com.apple.quarantine` is enough to launch it.
 *
 * When a certificate *is* available, electron-builder signs the bundle properly
 * a moment later — afterPack runs before signing — which would make this a wasted
 * deep re-sign of every binary in the app. So it stands aside.
 */
export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  if (process.env.CSC_LINK || process.env.CSC_NAME) {
    console.log('afterPack: a certificate is configured — leaving the signing to electron-builder')
    return
  }

  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
}
