import type { ComputerUseAPI } from '@nexus-local/computer-use-swift'

let cached: ComputerUseAPI | undefined

function unwrapDefaultExport<T>(mod: T | { default: T }): T {
  return (
    typeof mod === 'object' &&
    mod !== null &&
    'default' in mod &&
    mod.default !== undefined
      ? mod.default
      : mod
  ) as T
}

/**
 * Package's js/index.js reads COMPUTER_USE_SWIFT_NODE_PATH (baked by
 * build-with-plugins.ts on darwin targets, unset otherwise — falls through to
 * the node_modules prebuilds/ path). We cache the loaded native module.
 *
 * The four @MainActor methods (captureExcluding, captureRegion,
 * apps.listInstalled, resolvePrepareCapture) dispatch to DispatchQueue.main
 * and will hang under libuv unless CFRunLoop is pumped — call sites wrap
 * these in drainRunLoop().
 */
export function requireComputerUseSwift(): ComputerUseAPI {
  if (process.platform !== 'darwin') {
    throw new Error('@nexus-local/computer-use-swift is macOS-only')
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (cached ??=
    unwrapDefaultExport(
      require('@nexus-local/computer-use-swift') as ComputerUseAPI | {
        default: ComputerUseAPI
      },
    ))
}

export type { ComputerUseAPI }
