import { isAutoMemoryEnabled } from '../../memdir/paths.js'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { getMemoryPath } from '../../utils/config.js'
import { getInstructionWritePath, getProjectInstructionFiles } from '../../utils/instructionFiles.js'
import { registerBundledSkill } from '../bundledSkills.js'

export function registerRememberSkill(): void {
  if (process.env.NEXUS_BUILD_FLAVOR !== 'development') {
    return
  }

  const memoryReviewPrompt = (projects: string[], localFile: string, projectTarget: string, localTarget: string) => `# Memory Review

## Goal
Review the user's memory landscape and produce a clear report of proposed changes, grouped by action type. Do NOT apply changes — present proposals for user approval.

## Steps

### 1. Gather all memory layers
Review the current project instruction files ${JSON.stringify(projects)} and private local instructions ${JSON.stringify(localFile)} if they exist. Propose future changes in ${JSON.stringify(projectTarget)} for shared instructions or ${JSON.stringify(localTarget)} for private instructions. Your auto-memory content is already in your system prompt — review it there. Note which team memory sections exist, if any.

**Success criteria**: You have the contents of all memory layers and can compare them.

### 2. Classify each auto-memory entry
For each substantive entry in auto-memory, determine the best destination:

| Destination | What belongs there | Examples |
|---|---|---|
| **Project instructions** | Project conventions and instructions for Nexus that all contributors should follow | "use bun not npm", "API routes use kebab-case", "test command is bun test", "prefer functional style" |
| **Private local instructions** | Personal instructions for Nexus specific to this user, not applicable to other contributors | "I prefer concise responses", "always explain trade-offs", "don't auto-commit", "run tests before committing" |
| **Team memory** | Org-wide knowledge that applies across repositories (only if team memory is configured) | "deploy PRs go through #deploy-queue", "staging is at staging.internal", "platform team owns infra" |
| **Stay in auto-memory** | Working notes, temporary context, or entries that don't clearly fit elsewhere | Session-specific observations, uncertain patterns |

**Important distinctions:**
- Project and local instruction files describe how Nexus should work on the project. Keep preferences for external tools in their own settings.
- Workflow practices (PR conventions, merge strategies, branch naming) are ambiguous — ask the user whether they're personal or team-wide
- When unsure, ask rather than guess

**Success criteria**: Each entry has a proposed destination or is flagged as ambiguous.

### 3. Identify cleanup opportunities
Scan across all layers for:
- **Duplicates**: Auto-memory entries already captured in project or local instructions → propose removing from auto-memory
- **Outdated**: Project or local instructions contradicted by newer auto-memory entries → propose updating the older layer
- **Conflicts**: Contradictions between any two layers → propose resolution, noting which is more recent

**Success criteria**: All cross-layer issues identified.

### 4. Present the report
Output a structured report grouped by action type:
1. **Promotions** — entries to move, with destination and rationale
2. **Cleanup** — duplicates, outdated entries, conflicts to resolve
3. **Ambiguous** — entries where you need the user's input on destination
4. **No action needed** — brief note on entries that should stay put

If auto-memory is empty, say so and offer to review the project instructions for cleanup.

**Success criteria**: User can review and approve/reject each proposal individually.

## Rules
- Present ALL proposals before making any changes
- Do NOT modify files without explicit user approval
- Do NOT create new files unless the target doesn't exist yet
- Ask about ambiguous entries — don't guess
`

  registerBundledSkill({
    name: 'remember',
    description:
      'Review auto-memory and propose moving entries to project instructions, private local instructions, or shared memory. Detects outdated, conflicting, and duplicate entries.',
    whenToUse:
      'Use when the user wants to review auto-memory or reconcile it with project and local instructions.',
    userInvocable: true,
    isEnabled: () => isAutoMemoryEnabled(),
    async getPromptForCommand(args) {
      const cwd = getOriginalCwd()
      let prompt = memoryReviewPrompt(
        getProjectInstructionFiles(cwd), getMemoryPath('Local'),
        getMemoryPath('Project'), getInstructionWritePath(cwd, 'local'),
      )

      if (args) {
        prompt += `\n## Additional context from user\n\n${args}`
      }

      return [{ type: 'text', text: prompt }]
    },
  })
}
