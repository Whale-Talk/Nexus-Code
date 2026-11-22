import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getMainLoopModelOverride, setMainLoopModelOverride } from '../../bootstrap/state.js'
import { resetSettingsCache } from '../settings/settingsCache.js'
import { getAgentModel } from './agent.js'
import {
  getAtomModel, getElectronModel, getQuarkModel, getRuntimeMainLoopModel, isQuarkModel,
  normalizeModelStringForAPI, parseUserSpecifiedModel, renderModelName,
} from './model.js'
import { getModelOptions, getQuarkPlanOption } from './modelOptions.js'
import { getModelCapabilityOverride } from './modelSupportOverrides.js'

const models = {
  roles: { quark: 'a::Mix', atom: 'b::quark', electron: 'b::Mix' },
  channels: {
    a: { protocol: 'openai-compatible', baseURL: 'http://a.test', models: [
      { id: 'Mix', name: '主模型', contextWindow: 1_000_000, capabilities: { effort: true } },
      { id: 'light' }, { id: 'fast, experimental[1m]' }, { id: 'compat-tier' },
    ] },
    b: { protocol: 'openai-compatible', baseURL: 'http://b.test', models: [
      { id: 'quark' }, { id: 'Mix', capabilities: { effort: false } },
    ] },
  },
}

function withModelProfile(catalog: typeof models | undefined, run: (profile: string) => void) {
  const profile = mkdtempSync(join(tmpdir(), 'nexus-roles-'))
  const keys = ['NEXUS_CONFIG_DIR','NEXUS_MODEL','NEXUS_QUARK_MODEL','NEXUS_ATOM_MODEL','NEXUS_ELECTRON_MODEL',
    'NEXUS_SUBAGENT_MODEL','NEXUS_CUSTOM_MODEL_OPTION','NEXUS_BASE_URL','NEXUS_PROVIDER']
  const saved = keys.map(key => process.env[key])
  const previousOverride = getMainLoopModelOverride()
  try {
    for (const key of keys) delete process.env[key]
    process.env.NEXUS_CONFIG_DIR = profile
    setMainLoopModelOverride(undefined)
    resetSettingsCache()
    if (catalog) writeFileSync(join(profile, 'models.json'), JSON.stringify(catalog))
    run(profile)
  } finally {
    setMainLoopModelOverride(previousOverride)
    keys.forEach((key, i) => {
      if (saved[i] === undefined) delete process.env[key]
      else process.env[key] = saved[i]!
    })
    resetSettingsCache()
    rmSync(profile, { recursive: true, force: true })
  }
}

test('one configured model handles all three roles until a role is bound individually', () => {
  withModelProfile(undefined, () => {
    process.env.NEXUS_MODEL = 'Case-Sensitive'
    expect([getQuarkModel(), getAtomModel(), getElectronModel()]).toEqual(Array(3).fill('Case-Sensitive'))
    process.env.NEXUS_ELECTRON_MODEL = 'other'
    expect(parseUserSpecifiedModel('electron')).toBe('other')
    expect(getAgentModel(undefined, 'arbitrary::Parent')).toBe('arbitrary::Parent')
    expect(getAgentModel('atom', 'arbitrary::Parent')).toBe('Case-Sensitive')
    process.env.NEXUS_SUBAGENT_MODEL = 'single-channel-override'
    expect(getAgentModel('atom', 'arbitrary::Parent')).toBe('single-channel-override')
  })
})

test('role selection and model IDs use separate namespaces and preserve exact channel identity', () => {
  withModelProfile(models, () => {
    expect(parseUserSpecifiedModel('quark')).toBe(models.roles.quark)
    expect(parseUserSpecifiedModel('atom')).toBe('b::quark')
    expect(parseUserSpecifiedModel('b::quark')).toBe('b::quark')
    expect(parseUserSpecifiedModel('compat-tier')).toBe('a::compat-tier')
    expect(parseUserSpecifiedModel('UNKNOWN-id[1m]')).toBe('UNKNOWN-id[1m]')
    expect(normalizeModelStringForAPI('a::fast, experimental[1m]')).toBe('a::fast, experimental[1m]')
    expect(isQuarkModel('b::Mix')).toBe(false)
    expect(isQuarkModel('a::Mix')).toBe(true)
    expect(renderModelName('a::Mix')).toBe('主模型 (a)')
    const rows = getModelOptions().filter(row => row.role)
    expect(rows.map(row => [row.value, row.role])).toEqual([['quark','quark'],['atom','atom'],['electron','electron']])
    expect(rows[1]!.description).toContain('b / quark')
  })
})

test('official DeepSeek choices are available for the session without creating a catalog', () => {
  withModelProfile(undefined, profile => {
    process.env.NEXUS_MODEL = 'deepseek-v4-pro[1m]'
    process.env.NEXUS_BASE_URL = 'https://api.deepseek.com/anthropic'
    expect(getModelOptions().map(row => row.value)).toContain('deepseek-flash')
    expect(getModelOptions().map(row => row.value)).toContain('deepseek-v4-pro')
    expect(getQuarkModel()).toBe('deepseek-v4-pro[1m]')
    expect(existsSync(join(profile, 'models.json'))).toBe(false)
    for (const baseURL of ['http://api.deepseek.com', 'https://api.deepseek.com:8443', 'https://api.deepseek.com.relay.test']) {
      process.env.NEXUS_BASE_URL = baseURL
      expect(getModelOptions().map(row => row.value)).not.toContain('deepseek-flash')
    }
  })
})

test('session choices show qualified models and respect the allowlist', () => {
  withModelProfile(models, profile => {
    const routes = getModelOptions().filter(row => row.label === 'Mix' || row.label === '主模型')
    expect(routes.map(row => row.value)).toEqual(['a::Mix', 'b::Mix'])
    expect(routes.map(row => row.description)).toEqual(['a / Mix', '渠道 b'])
    writeFileSync(join(profile, 'settings.json'), JSON.stringify({ availableModels: ['b::Mix'] }))
    resetSettingsCache()
    expect(getModelOptions().map(row => row.value)).toEqual([null, 'electron', 'b::Mix'])
  })
})

test('plan mode and inherited agents follow the existing selection policy', () => {
  withModelProfile(models, () => {
    const runtime = (model: string, exceeds200kTokens = false) =>
      getRuntimeMainLoopModel({ permissionMode: 'plan', mainLoopModel: model, exceeds200kTokens })
    setMainLoopModelOverride('quarkplan')
    expect(parseUserSpecifiedModel('quarkplan')).toBe(models.roles.atom)
    expect(getQuarkPlanOption().value).toBe('quarkplan')
    expect(runtime(models.roles.atom)).toBe(models.roles.quark)
    expect(runtime(models.roles.atom, true)).toBe(models.roles.atom)
    expect(getAgentModel('inherit', models.roles.atom, undefined, 'plan')).toBe(models.roles.quark)
    setMainLoopModelOverride('electron')
    expect(runtime(models.roles.electron)).toBe(models.roles.atom)
    expect(getAgentModel('atom', models.roles.quark, 'electron')).toBe(models.roles.electron)
    expect(parseUserSpecifiedModel('quark[1m]')).toBe(models.roles.quark)
  })
})

test('capabilities are attached to a physical model on a specific channel', () => {
  withModelProfile(models, () => {
    expect(getModelCapabilityOverride('a::Mix', 'effort')).toBe(true)
    expect(getModelCapabilityOverride('b::Mix', 'effort')).toBe(false)
    expect(getModelCapabilityOverride('b::quark', 'effort')).toBeUndefined()
  })
})
