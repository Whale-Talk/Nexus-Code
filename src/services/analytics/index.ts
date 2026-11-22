/**
 * Marker type for verifying analytics metadata doesn't contain sensitive data
 *
 * This type forces explicit verification that string values being logged
 * don't contain code snippets, file paths, or other sensitive information.
 *
 * Usage: `myString as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS`
 */
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = never

export type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED = never

/** Remove restricted fields before passing metadata to an explicitly attached consumer. */
export function stripProtoFields<V>(
  metadata: Record<string, V>,
): Record<string, V> {
  let result: Record<string, V> | undefined
  for (const key in metadata) {
    if (key.startsWith('_PROTO_')) {
      if (result === undefined) {
        result = { ...metadata }
      }
      delete result[key]
    }
  }
  return result ?? metadata
}

// Internal type for logEvent metadata - different from the enriched EventMetadata in metadata.ts
type LogEventMetadata = { [key: string]: boolean | number | undefined }

/**
 * Sink interface for the analytics backend
 */
export type AnalyticsSink = {
  logEvent: (eventName: string, metadata: LogEventMetadata) => void
  logEventAsync: (
    eventName: string,
    metadata: LogEventMetadata,
  ) => Promise<void>
}

// No account, exporter or queue is installed by the CLI. An embedding client
// can attach its own consumer. User-configured OpenTelemetry is independent.
let sink: AnalyticsSink | null = null

export function attachAnalyticsSink(newSink: AnalyticsSink): void {
  sink ??= newSink
}

export function logEvent(name: string, metadata: LogEventMetadata): void {
  sink?.logEvent(name, stripProtoFields(metadata))
}

export async function logEventAsync(name: string, metadata: LogEventMetadata): Promise<void> {
  await sink?.logEventAsync(name, stripProtoFields(metadata))
}

export function _resetForTesting(): void {
  sink = null
}
