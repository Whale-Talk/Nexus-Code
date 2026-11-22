import { expect, test } from 'bun:test'
import { buildBundleServerConfig, McpbManifestSchema } from './manifest.js'

const manifest = McpbManifestSchema.parse({
  manifest_version: '0.3', name: 'offline-fixture', version: '1.0.0', author: { name: 'Test' },
  server: { type: 'node', entry_point: 'main.js', mcp_config: {
    command: 'node', args: ['main.js'],
    platform_overrides: { win32: { args: ['${__dirname}${/}main.js', '${user_config.files}'], env: { VALUE: '${user_config.value}' } } },
  } },
  user_config: {
    files: { type: 'string', title: 'Files', description: 'File paths', multiple: true, default: ['one', 'two'] },
    value: { type: 'string', title: 'Value', description: 'Literal value', required: true },
  },
})

test('loads MCP bundle platform overrides without expanding placeholders in user data', () => {
  const config = buildBundleServerConfig(manifest, 'C:/Bundle', {}, { value: '$&${HOME}' }, 'win32')
  expect(config).toEqual({ command: 'node', args: ['C:/Bundle/main.js', 'one', 'two'], env: { VALUE: '$&${HOME}' } })
})

test('an MCP bundle cannot start with an absent required setting', () => {
  expect(() => buildBundleServerConfig(manifest, '/bundle', {}, {}, 'linux')).toThrow(/required.*value/)
})
