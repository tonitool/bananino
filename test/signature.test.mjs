/*
 * The signature check exists because an unsigned build is a *green* build — so the check
 * failing open would be invisible in exactly the same way. These cover the two readings
 * that decide it: who signed, and whether the hardened runtime is on.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  gatekeeperSource,
  hasHardenedRuntime,
  isDeveloperIdSigned,
} from '../scripts/verifySignature.mjs'

const SIGNED = `Executable=/Applications/Bananino.app/Contents/MacOS/Bananino
Identifier=de.clueone.bananino
Format=app bundle with Mach-O thin (arm64)
CodeDirectory v=20500 size=2118 flags=0x10000(runtime) hashes=57+7 location=embedded
Signature size=8981
Authority=Developer ID Application: Jiranan Panlanatiyarak (6R7VM3W44A)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
Timestamp=7 Sep 2026 at 14:00:00
TeamIdentifier=6R7VM3W44A
`

const AD_HOC = `Executable=/Applications/Bananino.app/Contents/MacOS/Bananino
Identifier=de.clueone.bananino
Format=app bundle with Mach-O thin (arm64)
CodeDirectory v=20400 size=2118 flags=0x2(adhoc) hashes=57+7 location=embedded
Signature=adhoc
TeamIdentifier=not set
`

test('a Developer ID signature is recognised', () => {
  assert.equal(isDeveloperIdSigned(SIGNED), true)
})

test('an ad-hoc signature is not mistaken for a Developer ID', () => {
  assert.equal(isDeveloperIdSigned(AD_HOC), false)
})

test('the issuing authority alone does not count as a Developer ID', () => {
  // Every signed app lists the CA that issued the leaf, and its name also begins
  // "Developer ID" — matching that instead of the leaf would pass anything Apple signed.
  const caOnly = 'Authority=Developer ID Certification Authority\nAuthority=Apple Root CA\n'
  assert.equal(isDeveloperIdSigned(caOnly), false)
})

test('the hardened runtime flag is read from the code directory', () => {
  assert.equal(hasHardenedRuntime(SIGNED), true)
  assert.equal(hasHardenedRuntime(AD_HOC), false)
})

test('a signature with no code directory line is not assumed hardened', () => {
  assert.equal(hasHardenedRuntime(''), false)
})

test("Gatekeeper's reason is reported verbatim", () => {
  const accepted = `/Applications/Bananino.app: accepted
source=Notarized Developer ID
origin=Developer ID Application: Jiranan Panlanatiyarak (6R7VM3W44A)
`
  assert.equal(gatekeeperSource(accepted), 'Notarized Developer ID')
  assert.equal(gatekeeperSource('no source line here'), 'unknown')
})
