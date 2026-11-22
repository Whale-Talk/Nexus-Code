import { feature } from 'bun:bundle'
import { basename, relative } from 'node:path'
import type { Command } from '../commands.js'
import { maybeMarkProjectOnboardingComplete } from '../projectOnboardingState.js'
import { getCwd } from '../utils/cwd.js'
import { isEnvTruthy } from '../utils/envUtils.js'
import { findGitRoot } from '../utils/git.js'
import {
  getInstructionFileName,
  getInstructionFilePath,
  getInstructionStarterContent,
  getInstructionWritePath,
  getProjectInstructionFiles,
  getProjectInstructionWritePath,
} from '../utils/instructionFiles.js'

const oldInitPrompt = (projectFile: string) => `Please analyze this codebase and create a ${projectFile} file, which will be given to future instances of Nexus Code to operate in this repository.

What to add:
1. Commands that will be commonly used, such as how to build, lint, and run tests. Include the necessary commands to develop in this codebase, such as how to run a single test.
2. High-level code architecture and structure so that future instances can be productive more quickly. Focus on the "big picture" architecture that requires reading multiple files to understand.

Usage notes:
- If there's already a ${projectFile}, suggest improvements to it.
- When you make the initial ${projectFile}, do not repeat yourself and do not include obvious instructions like "Provide helpful error messages to users", "Write unit tests for all new utilities", "Never include sensitive information (API keys, tokens) in code or commits".
- Avoid listing every component or file structure that can be easily discovered.
- Don't include generic development practices.
- If there are Cursor rules (in .cursor/rules/ or .cursorrules) or Copilot rules (in .github/copilot-instructions.md), make sure to include the important parts.
- If there is a README.md, make sure to include the important parts.
- Do not make up information such as "Common Development Tasks", "Tips for Development", "Support and Documentation" unless this is expressly included in other files that you read.
- Be sure to prefix the file with the following text:

\`\`\`
# ${basename(projectFile)}

This file provides guidance to Nexus Code when working with code in this repository.
\`\`\``

const newInitPrompt = (projectFile: string, localFile: string) => `Set up a minimal ${projectFile} (and optionally skills and hooks) for this repo. ${projectFile} is loaded into every Nexus Code session, so it must be concise — only include what Nexus would get wrong without it.

## Phase 1: Ask what to set up

Use AskUserQuestion to find out what the user wants:

- "Which ${projectFile} files should /init set up?"
  Options: "Project ${projectFile}" | "Personal ${localFile}" | "Both project + personal"
  Description for project: "Team-shared instructions checked into source control — architecture, coding standards, common workflows."
  Description for personal: "Your private preferences for this project (gitignored, not shared) — your role, sandbox URLs, preferred test data, workflow quirks."

- "Also set up skills and hooks?"
  Options: "Skills + hooks" | "Skills only" | "Hooks only" | "Neither, just ${projectFile}"
  Description for skills: "On-demand capabilities you or Nexus invoke with \`/skill-name\` — good for repeatable workflows and reference knowledge."
  Description for hooks: "Deterministic shell commands that run on tool events (e.g., format after every edit). Nexus can't skip them."

## Phase 2: Explore the codebase

Launch a subagent to survey the codebase, and ask it to read key files to understand the project: manifest files (package.json, Cargo.toml, pyproject.toml, go.mod, pom.xml, etc.), README, Makefile/build configs, CI config, existing ${projectFile}, .nexus/rules/, AGENTS.md, CLAUDE.md, GEMINI.md, .cursor/rules or .cursorrules, .github/copilot-instructions.md, .windsurfrules, .clinerules, .mcp.json.

Detect:
- Build, test, and lint commands (especially non-standard ones)
- Languages, frameworks, and package manager
- Project structure (monorepo with workspaces, multi-module, or single project)
- Code style rules that differ from language defaults
- Non-obvious gotchas, required env vars, or workflow quirks
- Existing .nexus/skills/ and .nexus/rules/ directories
- Formatter configuration (prettier, biome, ruff, black, gofmt, rustfmt, or a unified format script like \`npm run format\` / \`make fmt\`)
- Git worktree usage: run \`git worktree list\` to check if this repo has multiple worktrees (only relevant if the user wants a personal ${localFile})

Note what you could NOT figure out from code alone — these become interview questions.

## Phase 3: Fill in the gaps

Use AskUserQuestion to gather what you still need to write good ${projectFile} files and skills. Ask only things the code can't answer.

If the user chose project ${projectFile} or both: ask about codebase practices — non-obvious commands, gotchas, branch/PR conventions, required env setup, testing quirks. Skip things already in README or obvious from manifest files. Do not mark any options as "recommended" — this is about how their team works, not best practices.

If the user chose personal ${localFile} or both: ask about them, not the codebase. Do not mark any options as "recommended" — this is about their personal preferences, not best practices. Examples of questions:
  - What's their role on the team? (e.g., "backend engineer", "data scientist", "new hire onboarding")
  - How familiar are they with this codebase and its languages/frameworks? (so Nexus can calibrate explanation depth)
  - Do they have personal sandbox URLs, test accounts, API key paths, or local setup details Nexus should know?
  - Only if Phase 2 found multiple git worktrees: ask whether their worktrees are nested inside the main repo (e.g., \`.nexus/worktrees/<name>/\`) or siblings/external (e.g., \`../myrepo-feature/\`). If nested, the upward file walk finds the main repo's ${localFile} automatically — no special handling needed. If sibling/external, the personal content should live in a home-directory file (e.g., \`~/.nexus/<project-name>-instructions.md\`) and each worktree gets a one-line ${localFile} stub that imports it: \`@~/.nexus/<project-name>-instructions.md\`. Never put this import in the project ${projectFile} — that would check a personal reference into the team-shared file.
  - Any communication preferences? (e.g., "be terse", "always explain tradeoffs", "don't summarize at the end")

**Synthesize a proposal from Phase 2 findings** — e.g., format-on-edit if a formatter exists, a \`/verify\` skill if tests exist, a ${projectFile} note for anything from the gap-fill answers that's a guideline rather than a workflow. For each, pick the artifact type that fits, **constrained by the Phase 1 skills+hooks choice**:

  - **Hook** (stricter) — deterministic shell command on a tool event; Nexus can't skip it. Fits mechanical, fast, per-edit steps: formatting, linting, running a quick test on the changed file.
  - **Skill** (on-demand) — you or Nexus invoke \`/skill-name\` when you want it. Fits workflows that don't belong on every edit: deep verification, session reports, deploys.
  - **${projectFile} note** (looser) — influences Nexus's behavior but not enforced. Fits communication/thinking preferences: "plan before coding", "be terse", "explain tradeoffs".

  **Respect Phase 1's skills+hooks choice as a hard filter**: if the user picked "Skills only", downgrade any hook you'd suggest to a skill or a ${projectFile} note. If "Hooks only", downgrade skills to hooks (where mechanically possible) or notes. If "Neither", everything becomes a ${projectFile} note. Never propose an artifact type the user didn't opt into.

**Show the proposal via AskUserQuestion's \`preview\` field, not as a separate text message** — the dialog overlays your output, so preceding text is hidden. The \`preview\` field renders markdown in a side-panel (like plan mode); the \`question\` field is plain-text-only. Structure it as:

  - \`question\`: short and plain, e.g. "Does this proposal look right?"
  - Each option gets a \`preview\` with the full proposal as markdown. The "Looks good — proceed" option's preview shows everything; per-item-drop options' previews show what remains after that drop.
  - **Keep previews compact — the preview box truncates with no scrolling.** One line per item, no blank lines between items, no header. Example preview content:

    • **Format-on-edit hook** (automatic) — \`ruff format <file>\` via PostToolUse
    • **/verify skill** (on-demand) — \`make lint && make typecheck && make test\`
    • **${projectFile} note** (guideline) — "run lint/typecheck/test before marking done"

  - Option labels stay short ("Looks good", "Drop the hook", "Drop the skill") — the tool auto-adds an "Other" free-text option, so don't add your own catch-all.

**Build the preference queue** from the accepted proposal. Each entry: {type: hook|skill|note, description, target file, any Phase-2-sourced details like the actual test/format command}. Phases 4-7 consume this queue.

## Phase 4: Write ${projectFile} (if user chose project or both)

Write a minimal ${projectFile} at the project root. Every line must pass this test: "Would removing this cause Nexus to make mistakes?" If no, cut it.

**Consume \`note\` entries from the Phase 3 preference queue whose target is ${projectFile}** (team-level notes) — add each as a concise line in the most relevant section. These are the behaviors the user wants Nexus to follow but didn't need guaranteed (e.g., "propose a plan before implementing", "explain the tradeoffs when refactoring"). Leave personal-targeted notes for Phase 5.

Include:
- Build/test/lint commands Nexus can't guess (non-standard scripts, flags, or sequences)
- Code style rules that DIFFER from language defaults (e.g., "prefer type over interface")
- Testing instructions and quirks (e.g., "run single test with: pytest -k 'test_name'")
- Repo etiquette (branch naming, PR conventions, commit style)
- Required env vars or setup steps
- Non-obvious gotchas or architectural decisions
- Important parts from existing AI coding tool configs if they exist (AGENTS.md, .cursor/rules, .cursorrules, .github/copilot-instructions.md, .windsurfrules, .clinerules)

Exclude:
- File-by-file structure or component lists (Nexus can discover these by reading the codebase)
- Standard language conventions Nexus already knows
- Generic advice ("write clean code", "handle errors")
- Detailed API docs or long references — use \`@path/to/import\` syntax instead (e.g., \`@docs/api-reference.md\`) to inline content on demand without bloating ${projectFile}
- Information that changes frequently — reference the source with \`@path/to/import\` so Nexus always reads the current version
- Long tutorials or walkthroughs (move to a separate file and reference with \`@path/to/import\`, or put in a skill)
- Commands obvious from manifest files (e.g., standard "npm test", "cargo test", "pytest")

Be specific: "Use 2-space indentation in TypeScript" is better than "Format code properly."

Do not repeat yourself and do not make up sections like "Common Development Tasks" or "Tips for Development" — only include information expressly found in files you read.

Prefix the file with:

\`\`\`
# ${basename(projectFile)}

This file provides guidance to Nexus Code when working with code in this repository.
\`\`\`

If ${projectFile} already exists: read it, propose specific changes as diffs, and explain why each change improves it. Do not silently overwrite.

For projects with multiple concerns, suggest organizing instructions into \`.nexus/rules/\` as separate focused files (e.g., \`code-style.md\`, \`testing.md\`, \`security.md\`). These are loaded automatically alongside ${projectFile} and can be scoped to specific file paths using \`paths\` frontmatter.

For projects with distinct subdirectories (monorepos, multi-module projects, etc.): mention that subdirectory ${projectFile} files can be added for module-specific instructions (they're loaded automatically when Nexus works in those directories). Offer to create them if the user wants.

## Phase 5: Write ${localFile} (if user chose personal or both)

Write a minimal ${localFile} at the project root. This file is automatically loaded alongside ${projectFile}. After creating it, add \`${basename(localFile)}\` to the project's .gitignore so it stays private.

**Consume \`note\` entries from the Phase 3 preference queue whose target is ${localFile}** (personal-level notes) — add each as a concise line. If the user chose personal-only in Phase 1, this is the sole consumer of note entries.

Include:
- The user's role and familiarity with the codebase (so Nexus can calibrate explanations)
- Personal sandbox URLs, test accounts, or local setup details
- Personal workflow or communication preferences

Keep it short — only include what would make Nexus's responses noticeably better for this user.

If Phase 2 found multiple git worktrees and the user confirmed they use sibling/external worktrees (not nested inside the main repo): the upward file walk won't find a single ${localFile} from all worktrees. Write the actual personal content to \`~/.nexus/<project-name>-instructions.md\` and make ${localFile} a one-line stub that imports it: \`@~/.nexus/<project-name>-instructions.md\`. The user can copy this one-line stub to each sibling worktree. Never put this import in the project ${projectFile}. If worktrees are nested inside the main repo (e.g., \`.nexus/worktrees/\`), no special handling is needed — the main repo's ${localFile} is found automatically.

If ${localFile} already exists: read it, propose specific additions, and do not silently overwrite.

## Phase 6: Suggest and create skills (if user chose "Skills + hooks" or "Skills only")

Skills add capabilities Nexus can use on demand without bloating every session.

**First, consume \`skill\` entries from the Phase 3 preference queue.** Each queued skill preference becomes a SKILL.md tailored to what the user described. For each:
- Name it from the preference (e.g., "verify-deep", "session-report", "deploy-sandbox")
- Write the body using the user's own words from the interview plus whatever Phase 2 found (test commands, report format, deploy target). If the preference maps to an existing bundled skill (e.g., \`/verify\`), write a project skill that adds the user's specific constraints on top — tell the user the bundled one still exists and theirs is additive.
- Ask a quick follow-up if the preference is underspecified (e.g., "which test command should verify-deep run?")

**Then suggest additional skills** beyond the queue when you find:
- Reference knowledge for specific tasks (conventions, patterns, style guides for a subsystem)
- Repeatable workflows the user would want to trigger directly (deploy, fix an issue, release process, verify changes)

For each suggested skill, provide: name, one-line purpose, and why it fits this repo.

If \`.nexus/skills/\` already exists with skills, review them first. Do not overwrite existing skills — only propose new ones that complement what is already there.

Create each skill at \`.nexus/skills/<skill-name>/SKILL.md\`:

\`\`\`yaml
---
name: <skill-name>
description: <what the skill does and when to use it>
---

<Instructions for Nexus>
\`\`\`

Both the user (\`/<skill-name>\`) and Nexus can invoke skills by default. For workflows with side effects (e.g., \`/deploy\`, \`/fix-issue 123\`), add \`disable-model-invocation: true\` so only the user can trigger it, and use \`$ARGUMENTS\` to accept input.

## Phase 7: Suggest additional optimizations

Tell the user you're going to suggest a few additional optimizations now that ${projectFile} and skills (if chosen) are in place.

Check the environment and ask about each gap you find (use AskUserQuestion):

- **GitHub CLI**: Run \`which gh\` (or \`where gh\` on Windows). If it's missing AND the project uses GitHub (check \`git remote -v\` for github.com), ask the user if they want to install it. Explain that the GitHub CLI lets Nexus help with commits, pull requests, issues, and code review directly.

- **Linting**: If Phase 2 found no lint config (no .eslintrc, ruff.toml, .golangci.yml, etc. for the project's language), ask the user if they want Nexus to set up linting for this codebase. Explain that linting catches issues early and gives Nexus fast feedback on its own edits.

- **Proposal-sourced hooks** (if user chose "Skills + hooks" or "Hooks only"): Consume \`hook\` entries from the Phase 3 preference queue. If Phase 2 found a formatter and the queue has no formatting hook, offer format-on-edit as a fallback. If the user chose "Neither" or "Skills only" in Phase 1, skip this bullet entirely.

  For each hook preference (from the queue or the formatter fallback):

  1. Target file: default based on the Phase 1 ${projectFile} choice — project → \`.nexus/settings.json\` (team-shared, committed); personal → \`.nexus/settings.local.json\`. Only ask if the user chose "both" in Phase 1 or the preference is ambiguous. Ask once for all hooks, not per-hook.

  2. Pick the event and matcher from the preference:
     - "after every edit" → \`PostToolUse\` with matcher \`Write|Edit\`
     - "when Nexus finishes" / "before I review" → \`Stop\` event (fires at the end of every turn — including read-only ones)
     - "before running bash" → \`PreToolUse\` with matcher \`Bash\`
     - "before committing" (literal git-commit gate) → **not a hooks.json hook.** Matchers can't filter Bash by command content, so there's no way to target only \`git commit\`. Route this to a git pre-commit hook (\`.git/hooks/pre-commit\`, husky, pre-commit framework) instead — offer to write one. If the user actually means "before I review and commit Nexus's output", that's \`Stop\` — probe to disambiguate.
     Probe if the preference is ambiguous.

  3. **Load the hook reference** (once per \`/init\` run, before the first hook): invoke the Skill tool with \`skill: 'update-config'\` and args starting with \`[hooks-only]\` followed by a one-line summary of what you're building — e.g., \`[hooks-only] Constructing a PostToolUse/Write|Edit format hook for .nexus/settings.json using ruff\`. This loads the hooks schema and verification flow into context. Subsequent hooks reuse it — don't re-invoke.

  4. Follow the skill's **"Constructing a Hook"** flow: dedup check → construct for THIS project → pipe-test raw → wrap → write JSON → \`jq -e\` validate → live-proof (for \`Pre|PostToolUse\` on triggerable matchers) → cleanup → handoff. Target file and event/matcher come from steps 1–2 above.

Act on each "yes" before moving on.

## Phase 8: Summary and next steps

Recap what was set up — which files were written and the key points included in each. Remind the user these files are a starting point: they should review and tweak them, and can run \`/init\` again anytime to re-scan.

Then tell the user that you'll be introducing a few more suggestions for optimizing their codebase and Nexus Code setup based on what you found. Present these as a single, well-formatted to-do list where every item is relevant to this repo. Put the most impactful items first.

When building the list, work through these checks and include only what applies:
- If frontend code was detected (React, Vue, Svelte, etc.): \`/plugin install frontend-design@nexus-plugins-official\` gives Nexus design principles and component patterns so it produces polished UI; \`/plugin install playwright@nexus-plugins-official\` lets Nexus launch a real browser, screenshot what it built, and fix visual bugs itself.
- If you found gaps in Phase 7 (missing GitHub CLI, missing linting) and the user said no: list them here with a one-line reason why each helps.
- If tests are missing or sparse: suggest setting up a test framework so Nexus can verify its own changes.
- Browse official plugins with \`/plugin\` — these bundle skills, agents, hooks, and MCP servers that you may find helpful. You can also create your own custom plugins to share them with others. (Always include this one.)`

function usesExtendedInit(): boolean {
  if (feature('NEW_INIT')) {
    return process.env.NEXUS_BUILD_FLAVOR === 'development' || isEnvTruthy(process.env.NEXUS_NEW_INIT)
  }
  return false
}

const command = {
  type: 'prompt',
  name: 'init',
  get description() {
    const file = getInstructionFileName()
    return usesExtendedInit()
      ? `Set up ${file} and optional skills/hooks for this codebase`
      : `Set up ${file} with codebase documentation`
  },
  get userFacingDescription() {
    const file = getInstructionFileName()
    return usesExtendedInit()
      ? `根据代码库生成 ${file} 项目说明，并可选择配置技能和钩子`
      : `根据代码库生成 ${file} 项目说明`
  },
  contentLength: 0, // Dynamic content
  progressMessage: 'analyzing your codebase',
  source: 'builtin',
  async getPromptForCommand() {
    maybeMarkProjectOnboardingComplete()
    const cwd = getCwd()
    const root = findGitRoot(cwd) ?? cwd
    const toProjectPath = (path: string) => relative(cwd, path).replaceAll('\\', '/')
    const projectFile = toProjectPath(getProjectInstructionWritePath(root))
    const localFile = toProjectPath(getInstructionWritePath(root, 'local'))
    const extended = usesExtendedInit()
    const sources = getProjectInstructionFiles(root).map(toProjectPath).filter(path => path !== projectFile)
    const importLine = getInstructionStarterContent(root, true).trim()
    const oldLocalFile = toProjectPath(getInstructionFilePath(root, 'local'))
    const guidance = [
      `The shared instruction write target is ${JSON.stringify(projectFile)}. Use existing instruction files as references and keep them intact.`,
      sources.length ? `Read these current project instruction sources before writing: ${JSON.stringify(sources)}.` : '',
      importLine ? `When creating ${JSON.stringify(projectFile)}, retain the current shared instructions with this Markdown import on its own line: ${importLine}` : '',
      extended && oldLocalFile !== localFile
        ? `If the user chooses private instructions, read ${JSON.stringify(oldLocalFile)} and carry its applicable content into ${JSON.stringify(localFile)}. Keep the old file intact and add the new basename to .gitignore.`
        : '',
    ].filter(Boolean).join('\n')

    return [
      {
        type: 'text',
        text: `${guidance}\n\n${extended ? newInitPrompt(projectFile, localFile) : oldInitPrompt(projectFile)}`,
      },
    ]
  },
} satisfies Command

export default command
