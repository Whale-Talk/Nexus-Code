import React from 'react'
import { ConversationRolePicker } from '../../components/ConversationRolePicker.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { ROLE_BINDING_HINT, switchConversationRole } from '../../utils/model/conversationRole.js'
import { isModelRole, type ModelRole } from '../../utils/model/roles.js'

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const value = args?.trim().toLowerCase() || ''

  function selectRole(role: ModelRole) {
    const result = switchConversationRole(role, context)
    onDone(result.message, result.changed ? undefined : { display: 'system' })
  }

  if (!value) {
    return <ConversationRolePicker initial={context.getAppState().mainLoopModel}
      onSelect={selectRole} onCancel={() => onDone(undefined, { display: 'skip' })} />
  }
  if (!isModelRole(value)) {
    onDone(`/model 只切换当前对话的 Quark、Atom、Electron 角色。用法为 /model [quark | atom | electron]。${ROLE_BINDING_HINT}`, {
      display: 'system',
    })
    return
  }
  selectRole(value)
}
