import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { logError } from '../../utils/log.js'
import { createSignal } from '../../utils/signal.js'

type FeatureOverrides = Record<string, unknown>
const changed = createSignal()
let lastEnvironmentJSON: string | undefined
let environmentValues: FeatureOverrides = {}

function environmentOverrides(): FeatureOverrides {
  if (process.env.NEXUS_BUILD_FLAVOR !== 'development') return {}
  const json = process.env.NEXUS_INTERNAL_FC_OVERRIDES
  if (json !== lastEnvironmentJSON) {
    lastEnvironmentJSON = json
    environmentValues = {}
    if (json) {
      try {
        const parsed: unknown = JSON.parse(json)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          environmentValues = parsed as FeatureOverrides
        }
      } catch {
        logError(new Error('NEXUS_INTERNAL_FC_OVERRIDES must contain a JSON object'))
      }
    }
  }
  return environmentValues
}

export function getFeatureFlagOverrides(): FeatureOverrides {
  if (process.env.NEXUS_BUILD_FLAVOR !== 'development') return {}
  try {
    return getGlobalConfig().featureOverrides ?? {}
  } catch {
    // Some feature checks run before the user configuration becomes available.
    return {}
  }
}

export function onFeatureFlagsChanged(listener: () => void | Promise<void>): () => void {
  return changed.subscribe(() => {
    try { void Promise.resolve(listener()).catch(logError) }
    catch (error) { logError(error) }
  })
}

export function hasFeatureFlagEnvOverride(feature: string): boolean {
  return Object.hasOwn(environmentOverrides(), feature)
}

export function setFeatureFlagOverride(feature: string, value: unknown): void {
  if (process.env.NEXUS_BUILD_FLAVOR !== 'development') return
  saveGlobalConfig(config => {
    const overrides = { ...config.featureOverrides }
    if (value === undefined) delete overrides[feature]
    else Object.defineProperty(overrides, feature, { value, configurable: true, enumerable: true, writable: true })
    return { ...config, featureOverrides: Object.keys(overrides).length ? overrides : undefined }
  })
  changed.emit()
}

function readFeature<T>(feature: string, fallback: T): T {
  const env = environmentOverrides()
  if (Object.hasOwn(env, feature)) return env[feature] as T
  const config = getFeatureFlagOverrides()
  return Object.hasOwn(config, feature) ? config[feature] as T : fallback
}

export function getFeatureValue<T>(feature: string, fallback: T): T {
  return readFeature(feature, fallback)
}

export function getFeatureValueWithRefresh<T>(feature: string, fallback: T, _intervalMs: number): T {
  return readFeature(feature, fallback)
}

export async function readFeatureValue<T>(feature: string, fallback: T): Promise<T> {
  return readFeature(feature, fallback)
}

export function isFeatureEnabled(gate: string): boolean {
  return readFeature<unknown>(gate, false) === true
}

export async function checkFeatureEntitlement(gate: string): Promise<boolean> {
  return readFeature<unknown>(gate, false) === true
}

export async function checkSecurityRestrictionGate(gate: string): Promise<boolean> {
  // A malformed explicit restriction must never enable the restricted operation.
  return readFeature<unknown>(gate, false) !== false
}

export async function initializeFeatureFlags(): Promise<void> {
  environmentOverrides()
}

export function refreshFeatureFlags(): void {
  changed.emit()
}

export function resetFeatureFlags(): void {
  lastEnvironmentJSON = undefined
  environmentValues = {}
  changed.emit()
}
