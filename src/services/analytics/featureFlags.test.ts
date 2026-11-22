import { expect, test } from 'bun:test'
import {
  checkFeatureEntitlement, checkSecurityRestrictionGate, getFeatureValue, initializeFeatureFlags,
  onFeatureFlagsChanged, readFeatureValue, refreshFeatureFlags, resetFeatureFlags,
} from './featureFlags.js'

test('local feature settings preserve defaults, explicit restrictions, and change notifications', async () => {
  const previousFlavor = process.env.NEXUS_BUILD_FLAVOR
  const previousOverrides = process.env.NEXUS_INTERNAL_FC_OVERRIDES
  let notifications = 0
  const unsubscribe = onFeatureFlagsChanged(() => { notifications++ })
  try {
    process.env.NEXUS_BUILD_FLAVOR = 'development'
    process.env.NEXUS_INTERNAL_FC_OVERRIDES = JSON.stringify({ enabled: true, restricted: true, malformed: 'false' })
    await initializeFeatureFlags()
    expect(await checkFeatureEntitlement('enabled')).toBe(true)
    expect(await checkFeatureEntitlement('malformed')).toBe(false)
    expect(await checkSecurityRestrictionGate('restricted')).toBe(true)
    expect(await checkSecurityRestrictionGate('malformed')).toBe(true)
    expect(await readFeatureValue('missing_fixture_value', 17)).toBe(17)
    process.env.NEXUS_BUILD_FLAVOR = 'external'
    refreshFeatureFlags()
    expect(getFeatureValue('enabled', false)).toBe(false)
    expect(notifications).toBe(1)
  } finally {
    unsubscribe()
    if (previousFlavor === undefined) delete process.env.NEXUS_BUILD_FLAVOR
    else process.env.NEXUS_BUILD_FLAVOR = previousFlavor
    if (previousOverrides === undefined) delete process.env.NEXUS_INTERNAL_FC_OVERRIDES
    else process.env.NEXUS_INTERNAL_FC_OVERRIDES = previousOverrides
    resetFeatureFlags()
  }
})
