import { withResolvers } from '../../../utils/withResolvers.js'
import { APIUserAbortError } from './errors.js'

type ResponseMetadata = { status: number; headers: Headers; requestID: string }

export function captureStreamMetadata(signal: AbortSignal) {
  const { promise, resolve, reject } = withResolvers<ResponseMetadata>()
  const abort = () => reject(new APIUserAbortError())
  if (signal.aborted) abort()
  else signal.addEventListener('abort', abort, { once: true })
  const cleanup = () => signal.removeEventListener('abort', abort)
  // Callers consuming only the events still receive errors via their iterator.
  void promise.then(cleanup, cleanup)
  return {
    metadata: promise,
    fail: reject,
    receive({ status, headers }: Response) {
      resolve({ status, headers, requestID: headers.get('x-request-id') ?? headers.get('request-id') ?? '' })
    },
  }
}
