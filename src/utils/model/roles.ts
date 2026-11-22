export const MODEL_ROLES = ['quark', 'atom', 'electron'] as const
export type ModelRole = typeof MODEL_ROLES[number]

export function isModelRole(value: string): value is ModelRole {
  return (MODEL_ROLES as readonly string[]).includes(value)
}

// Role selections, context modifiers and explicit shortcuts accepted by the CLI.
export const MODEL_SELECTIONS = [
  ...MODEL_ROLES, 'quarkplan',
  'quark[1m]', 'atom[1m]', 'electron[1m]',
] as const
export type ModelSelection = (typeof MODEL_SELECTIONS)[number]

export function isModelSelection(value: string): value is ModelSelection {
  return (MODEL_SELECTIONS as readonly string[]).includes(value)
}
