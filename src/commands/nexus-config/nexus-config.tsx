import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import type { LocalJSXCommandContext } from '../../commands.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { NexusConfigForm } from './NexusConfigForm.js';

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: LocalJSXCommandContext,
): Promise<React.ReactNode> {
  return <NexusConfigForm onDone={() => onDone()} />
}
