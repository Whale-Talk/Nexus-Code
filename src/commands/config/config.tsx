import * as React from 'react';
import { SettingsCenter } from '../../components/Settings/SettingsCenter.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
export const call: LocalJSXCommandCall = async (onDone, context) => {
  return <SettingsCenter onClose={onDone} context={context} />;
};
