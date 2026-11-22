import { z } from 'zod/v4'

const serverConfigSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
})
const configurationOptionSchema = z.object({
  type: z.enum(['string', 'number', 'boolean', 'directory', 'file']),
  title: z.string(),
  description: z.string(),
  required: z.boolean().optional(),
  default: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
  multiple: z.boolean().optional(),
  sensitive: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
})

const manifestVersion = z.enum(['0.1', '0.2', '0.3', '0.4'])

// Validate the fields the loader uses. Bundle metadata remains available to consumers.
export const McpbManifestSchema = z.object({
  manifest_version: manifestVersion.optional(),
  dxt_version: manifestVersion.optional(),
  name: z.string().min(1),
  version: z.string().min(1),
  author: z.object({ name: z.string().min(1) }).passthrough(),
  server: z.object({
    type: z.enum(['node', 'python', 'binary', 'uv']),
    entry_point: z.string(),
    mcp_config: serverConfigSchema.extend({
      platform_overrides: z.record(z.string(), serverConfigSchema.partial()).optional(),
    }),
  }).passthrough(),
  user_config: z.record(z.string(), configurationOptionSchema).optional(),
}).passthrough().refine(manifest => Boolean(manifest.manifest_version || manifest.dxt_version), {
  message: 'A supported manifest_version or dxt_version is required',
})

export type McpbManifest = z.infer<typeof McpbManifestSchema>
export type McpbUserConfigurationOption = z.infer<typeof configurationOptionSchema>

export function buildBundleServerConfig(
  manifest: McpbManifest,
  extensionPath: string,
  systemDirs: Record<string, string>,
  userConfig: Record<string, string | number | boolean | string[]>,
  platform: NodeJS.Platform = process.platform,
) {
  const { platform_overrides, ...base } = manifest.server.mcp_config
  const config = { ...base, ...platform_overrides?.[platform] }
  const variables = new Map<string, string | string[]>(Object.entries({
    ...systemDirs, __dirname: extensionPath, pathSeparator: '/', '/': '/',
  }))
  for (const [key, option] of Object.entries(manifest.user_config ?? {})) {
    const value = Object.hasOwn(userConfig, key) ? userConfig[key] : option.default
    if (option.required && (value === undefined || value === '' ||
      (Array.isArray(value) && (!value.length || value.some(item => item === ''))))) {
      throw new Error(`Missing required bundle setting ${key}`)
    }
    if (value !== undefined) variables.set(`user_config.${key}`, Array.isArray(value) ? value : String(value))
  }
  // Older bundle configs may reference values added before the manifest declared them.
  for (const [key, value] of Object.entries(userConfig)) {
    variables.set(`user_config.${key}`, Array.isArray(value) ? value : String(value))
  }

  const expand = (value: string): string => value.replace(/\$\{([^}]+)\}/g, (placeholder, key: string) => {
    const replacement = variables.get(key)
    if (Array.isArray(replacement)) throw new Error(`Bundle setting ${key} must be a standalone argument`)
    return replacement ?? placeholder
  })
  const args = config.args?.flatMap(argument => {
    const key = /^\$\{([^}]+)\}$/.exec(argument)?.[1]
    const value = key ? variables.get(key) : undefined
    return Array.isArray(value) ? value : [expand(argument)]
  })
  const env = config.env && Object.fromEntries(Object.entries(config.env).map(([key, value]) => [key, expand(value)]))
  return { command: expand(config.command), ...(args && { args }), ...(env && { env }) }
}
