import * as React from 'react';
import type { LocalJSXCommandContext } from '../../commands.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { NexusConfigForm } from './NexusConfigForm.js';
import { getModelCatalog } from '../../services/api/provider/catalog.js';

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: LocalJSXCommandContext,
): Promise<React.ReactNode> {
  if (getModelCatalog()) {
    const { ChannelCredentials } = await import('../../components/Settings/ChannelCredentials.js')
    return <ChannelCredentials onClose={() => onDone()} />
  }
  return <NexusConfigForm onDone={() => onDone()} />
}
