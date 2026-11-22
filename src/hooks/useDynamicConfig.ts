import React from 'react'
import { readFeatureValue } from '../services/analytics/featureFlags.js'

/**
 * React hook for dynamic config values.
 * Returns the default value initially, then updates when the config is fetched.
 */
export function useDynamicConfig<T>(configName: string, defaultValue: T): T {
  const [configValue, setConfigValue] = React.useState<T>(defaultValue)

  React.useEffect(() => {
    if (process.env.NODE_ENV === 'test') {
      // Prevents a test hang when using this hook in tests
      return
    }
    void readFeatureValue<T>(configName, defaultValue).then(
      setConfigValue,
    )
  }, [configName, defaultValue])

  return configValue
}
