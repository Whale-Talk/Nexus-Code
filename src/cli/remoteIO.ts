import { PassThrough } from 'node:stream'
import type { StdoutMessage } from '../entrypoints/sdk/controlTypes.js'
import { getSessionId } from '../bootstrap/state.js'
import { registerCleanup } from '../utils/cleanupRegistry.js'
import { WebSocketTransport } from './transports/WebSocketTransport.js'
import { StructuredIO } from './structuredIO.js'

/** Stream SDK input/output over the WebSocket URL explicitly supplied by the caller. */
export class RemoteIO extends StructuredIO {
  private readonly transport: WebSocketTransport
  private readonly inputStream: PassThrough

  constructor(streamUrl: string, initialPrompt?: AsyncIterable<string>, replayUserMessages?: boolean) {
    const url = new URL(streamUrl)
    if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('SDK transport requires ws:// or wss://')
    const input = new PassThrough({ encoding: 'utf8' })
    super(input, replayUserMessages)
    this.inputStream = input
    this.transport = new WebSocketTransport(url, {}, getSessionId())
    this.transport.setOnData(data => { input.write(data) })
    this.transport.setOnClose(() => input.end())
    void this.transport.connect()
    registerCleanup(async () => this.close())
    if (initialPrompt) {
      void (async () => {
        for await (const chunk of initialPrompt) input.write(String(chunk).replace(/\n$/, '') + '\n')
      })()
    }
  }

  async write(message: StdoutMessage): Promise<void> {
    await this.transport.write(message)
  }

  close(): void {
    this.transport.close()
    this.inputStream.end()
  }
}
