import memoize from 'lodash-es/memoize.js'
import { join } from 'path'
import { getPlatform } from '../platform.js'

/**
 * Get the path to the managed settings directory based on the current platform.
 */
export const getManagedFilePath = memoize(function (): string {
  // Allow override for testing/demos (Ant-only, eliminated from external builds)
  if (
    process.env.NEXUS_BUILD_FLAVOR === 'development' &&
    process.env.NEXUS_MANAGED_SETTINGS_PATH
  ) {
    return process.env.NEXUS_MANAGED_SETTINGS_PATH
  }

  switch (getPlatform()) {
    case 'macos':
      return '/Library/Application Support/NexusCode'
    case 'windows':
      return 'C:\\Program Files\\NexusCode'
    default:
      return '/etc/nexus-code'
  }
})

/**
 * Get the path to the managed-settings.d/ drop-in directory.
 * managed-settings.json is merged first (base), then files in this directory
 * are merged alphabetically on top (drop-ins override base, later files win).
 */
export const getManagedSettingsDropInDir = memoize(function (): string {
  return join(getManagedFilePath(), 'managed-settings.d')
})
