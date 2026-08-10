import { describe, expect, test } from 'bun:test'
import {
  createOpenAICompatibleAdapter,
  normalizeOpenAICompatibleBaseURL,
} from './openai-compatible.js'

describe('normalizeOpenAICompatibleBaseURL', () => {
  test('裸域名自动补 /v1（relay 场景）', () => {
    expect(normalizeOpenAICompatibleBaseURL('https://api.deepseek.com')).toBe(
      'https://api.deepseek.com/v1/',
    )
    expect(normalizeOpenAICompatibleBaseURL('https://api.deepseek.com/')).toBe(
      'https://api.deepseek.com/v1/',
    )
  })

  test('含 API 版本段的路径原样使用（智谱直连）', () => {
    expect(normalizeOpenAICompatibleBaseURL('https://open.bigmodel.cn/api/paas/v4')).toBe(
      'https://open.bigmodel.cn/api/paas/v4/',
    )
  })

  test('自定义路径原样使用，不追加 /v1', () => {
    expect(normalizeOpenAICompatibleBaseURL('https://relay.example.com/openai')).toBe(
      'https://relay.example.com/openai/',
    )
  })

  test('Ollama 本地端口补 /v1', () => {
    expect(normalizeOpenAICompatibleBaseURL('http://localhost:11434')).toBe(
      'http://localhost:11434/v1/',
    )
  })
})

describe('createOpenAICompatibleAdapter', () => {
  test('可正常创建适配器', () => {
    const adapter = createOpenAICompatibleAdapter({
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'test-key',
      name: 'zhipu-test',
    } as never)
    expect(typeof adapter.streamText).toBe('function')
    expect(typeof adapter.generateText).toBe('function')
  })
})
