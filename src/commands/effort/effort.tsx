import * as React from 'react';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../../services/analytics/index.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { type EffortValue, getDisplayedEffortLevel, getEffortEnvOverride, getEffortValueDescription, getSupportedEffortLevels, isEffortLevel, toPersistableEffort } from '../../utils/effort.js';
import { updateSettingsForSource } from '../../utils/settings/settings.js';
const COMMON_HELP_ARGS = ['help', '-h', '--help'];
type EffortCommandResult = {
  message: string;
  effortUpdate?: {
    value: EffortValue | undefined;
  };
};
function setEffortValue(effortValue: EffortValue): EffortCommandResult {
  const persistable = toPersistableEffort(effortValue);
  if (persistable !== undefined) {
    const result = updateSettingsForSource('userSettings', {
      effortLevel: persistable
    });
    if (result.error) {
      return {
        message: `Failed to set effort level: ${result.error.message}`
      };
    }
  }
  logEvent('nexus_effort_command', {
    effort: effortValue as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  });

  // Env var wins at resolveAppliedEffort time. Only flag it when it actually
  // conflicts — if env matches what the user just asked for, the outcome is
  // the same, so "Set effort to X" is true and the note is noise.
  const envOverride = getEffortEnvOverride();
  if (envOverride !== undefined && envOverride !== effortValue) {
    const envRaw = process.env.NEXUS_EFFORT_LEVEL;
    if (persistable === undefined) {
      return {
        message: `Not applied: NEXUS_EFFORT_LEVEL=${envRaw} overrides effort this session, and ${effortValue} is session-only (nothing saved)`,
        effortUpdate: {
          value: effortValue
        }
      };
    }
    return {
      message: `NEXUS_EFFORT_LEVEL=${envRaw} overrides this session — clear it and ${effortValue} takes over`,
      effortUpdate: {
        value: effortValue
      }
    };
  }
  const description = getEffortValueDescription(effortValue);
  const suffix = persistable !== undefined ? '' : ' (this session only)';
  return {
    message: `Set effort level to ${effortValue}${suffix}: ${description}`,
    effortUpdate: {
      value: effortValue
    }
  };
}
export function showCurrentEffort(appStateEffort: EffortValue | undefined, model: string): EffortCommandResult {
  if (!getSupportedEffortLevels(model).length) {
    return { message: '当前渠道或模型不支持调节推理强度。' };
  }
  const envOverride = getEffortEnvOverride();
  const effectiveValue = envOverride === null ? undefined : envOverride ?? appStateEffort;
  const level = getDisplayedEffortLevel(model, appStateEffort);
  if (effectiveValue === undefined) {
    return {
      message: `Effort level: auto (currently ${level})`
    };
  }
  const description = getEffortValueDescription(level);
  return {
    message: `Current effort level: ${level} (${description})`
  };
}
function unsetEffortLevel(): EffortCommandResult {
  const result = updateSettingsForSource('userSettings', {
    effortLevel: undefined
  });
  if (result.error) {
    return {
      message: `Failed to set effort level: ${result.error.message}`
    };
  }
  logEvent('nexus_effort_command', {
    effort: 'auto' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  });
  // env=auto/unset (null) matches what /effort auto asks for, so only warn
  // when env is pinning a specific level that will keep overriding.
  const envOverride = getEffortEnvOverride();
  if (envOverride !== undefined && envOverride !== null) {
    const envRaw = process.env.NEXUS_EFFORT_LEVEL;
    return {
      message: `Cleared effort from settings, but NEXUS_EFFORT_LEVEL=${envRaw} still controls this session`,
      effortUpdate: {
        value: undefined
      }
    };
  }
  return {
    message: 'Effort level set to auto',
    effortUpdate: {
      value: undefined
    }
  };
}
export function executeEffort(args: string, model: string): EffortCommandResult {
  const normalized = args.toLowerCase();
  if (normalized === 'auto' || normalized === 'unset') {
    return unsetEffortLevel();
  }
  if (!isEffortLevel(normalized)) {
    return {
      message: `Invalid argument: ${args}. Valid options are: low, medium, high, max, auto`
    };
  }
  const levels = getSupportedEffortLevels(model);
  if (!levels.length) return { message: '当前渠道或模型不支持调节推理强度。' };
  if (!levels.includes(normalized)) {
    return { message: `当前模型支持的推理强度为 ${levels.join('、')}，或用 /effort auto 恢复默认。` };
  }
  return setEffortValue(normalized);
}
function ShowCurrentEffort(t0) {
  const {
    onDone
  } = t0;
  const effortValue = useAppState(_temp);
  const model = useMainLoopModel();
  const {
    message
  } = showCurrentEffort(effortValue, model);
  onDone(message);
  return null;
}
function _temp(s) {
  return s.effortValue;
}
function ApplyEffortAndClose({ args, onDone }: { args: string; onDone: LocalJSXCommandOnDone }) {
  const model = useMainLoopModel();
  const setAppState = useSetAppState();
  const applied = React.useRef(false);
  React.useEffect(() => {
    if (applied.current) return;
    applied.current = true;
    const { effortUpdate, message } = executeEffort(args, model);
    if (effortUpdate) setAppState(prev => ({ ...prev, effortValue: effortUpdate.value }));
    onDone(message);
  }, [args, model, onDone, setAppState]);
  return null;
}
export async function call(onDone: LocalJSXCommandOnDone, _context: unknown, args?: string): Promise<React.ReactNode> {
  args = args?.trim() || '';
  if (COMMON_HELP_ARGS.includes(args)) {
    onDone('用法 /effort [low|medium|high|max|auto]\n\n可选档位取决于当前渠道和模型。auto 使用模型默认强度。');
    return;
  }
  if (!args || args === 'current' || args === 'status') {
    return <ShowCurrentEffort onDone={onDone} />;
  }
  return <ApplyEffortAndClose args={args} onDone={onDone} />;
}
