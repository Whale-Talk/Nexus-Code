# AGENT.md

This file provides guidance to Nexus Code when working with code in this repository.

## Quick Commands

```bash
bun install                 # install dependencies (requires Bun ≥1.3.5, Node ≥24)
bun run dev                 # start CLI interactively
bun run start               # alias for dev
bun run version             # verify CLI boots and prints version
bun test                    # run all tests (co-located *.test.ts, no test/ dir)
bun test src/utils/Cursor.test.ts   # run a single test file
bun run typecheck           # CI baseline gate (see Testing & CI below)
bun run typecheck:raw       # plain tsc --noEmit (full strict run)
bun run audit:check         # dependency vuln baseline (fails only on new critical/high)
bun .github/scripts/check-native-names.ts  # verify Quark/Atom/Electron role + runtime names unchanged
```

Run `bun test` and `bun run typecheck`, then exercise the changed flow from the real CLI.

### Testing & CI Gates

- **Tests are co-located** `*.test.ts` files (bun:test) next to the module they cover; there is no dedicated test directory. Add tests near the feature.
- **`bun run typecheck` is a baseline gate, not a strict pass.** It runs tsc and compares error *signatures* against `.github/typecheck-baseline.json`; it fails only when new signatures appear. Use `bun run typecheck:raw` to see the full tsc output.
- **CI runs 5 always-on gates** (`.github/workflows/ci.yml`, PR + main push): gitleaks secret scan → install health + `bun.lock` drift check → typecheck baseline + native-name check → `bun test` → audit baseline. Each maps to a package.json script / `.github/scripts/` file, so all are locally reproducible.
- **Keep `bun.lock` in sync** with `package.json` (CI diff-fails on drift) — run `bun install` and commit the lockfile.
- There is no bundle/build step — distribution is clone + `bun run`; the import-graph smoke test (`bun run version`) covers compile health.

## Architecture Overview

This is a restored TypeScript source tree from `@anthropic-ai/claude-code` npm package source maps, rebranded as **Nexus** with a configurable backend. The original binary was a single bundled JS file; this tree was extracted from source maps and is being restored to a runnable state.

### Startup Flow

```
bin/nexus.cjs (Node launcher — manages ~/.nexus/ config, spawns bun)
  → bun run src/dev-entry.ts (import scanner; if 0 missing imports, forwards to CLI)
    → src/entrypoints/cli.tsx (Commander CLI, parses args)
      → src/main.tsx (heavy import graph, init, launches REPL via src/replLauncher.tsx)
        → src/setup.ts (session bootstrap: cwd, permissions, worktree, hooks, analytics)
          → src/QueryEngine.ts (conversation loop: user → API → tools → API → response)
            → src/query.ts (low-level API dispatch, streaming, message formatting)
```

### `bin/nexus.cjs` Launcher

The Node shim that bootstraps the runtime:
- Creates `~/.nexus/` with default `settings.json` (mode 0600) — defaults to DeepSeek API backend
- Loads the single-channel connection from `settings.json` and per-channel credentials by the variable named in `models.json`.
- Sets `NEXUS_CONFIG_DIR=~/.nexus`, generates a per-session `NEXUS_CONVERSATION_ID` (UUID)
- Starts in the normal tool approval mode. Bypass requires an explicit user selection.
- Spawns `bun run src/dev-entry.ts`, forwards signals (SIGINT/SIGTERM/SIGHUP)

### `src/dev-entry.ts` — Import Scanner

A restoration-scaffolding launcher. On startup it:
1. Recursively scans `src/` and `vendor/` for `.ts/.tsx/.js/.jsx/.mjs/.cjs` files
2. Regex-matches relative imports/exports/requires and resolves each target
3. If **missing imports > 0**: prints the count + top-20 missing modules and exits (restoration is incomplete)
4. If **missing imports == 0**: `await import('./entrypoints/cli.tsx')` — the real CLI takes over

This is the "build health" metric — the project is fully runnable only when this count reaches 0.

### Key Modules

| Module | Role |
|--------|------|
| `src/QueryEngine.ts` | Main conversation orchestrator — runs the agentic loop (prompt → API → tool calls → repeat) |
| `src/query.ts` | API request construction, streaming, message normalization, token tracking |
| `src/Tool.ts` | Base `Tool` class + `ToolUseContext` + permission interfaces (`checkPermissions`, `isReadOnly`, `isDestructive`) |
| `src/tools.ts` | Tool registry — `getAllBaseTools()` is source of truth; `getTools()` filters by permission context; `assembleToolPool()` merges built-ins + MCP |
| `src/commands.ts` | Slash-command registry — loads all commands from `src/commands/`, filtered by availability/auth |
| `src/services/api/inference.ts` | Nexus inference service — message streaming, tool calling, prompt caching, usage tracking |
| `src/services/api/provider/index.ts` | Selects a channel adapter and supplies its exact wire ID and credentials |
| `src/main.tsx` | CLI entrypoint — Commander arg parsing, model/provider config, REPL launch |
| `src/setup.ts` | Session initialization — permissions, worktree creation, hooks, analytics, env validation |

### Shims & Vendor

`shims/` — Local package stubs replacing dependencies that couldn't be restored from source maps. Each is a folder with `package.json` (`"version": "0.0.0-restored"`, `"main": "./index.ts"`) referenced via `"file:./shims/..."` in root `package.json`:

- **No-op API stubs**: `nexus-computer-use-mcp`, `nexus-computer-use-input`, `nexus-computer-use-swift`, `nexus-browser-companion` — export the same surface but with inert/no-op behavior
- **Re-export shims**: `color-diff-napi`, `modifiers-napi`, `url-handler-napi` — forward to pure-TS implementations in `src/native-ts/` or `vendor/`

`vendor/` — Pure-TS source for native modules (e.g., `modifiers-napi-src/` tries `require()` of a `.node` binary and gracefully returns null on unsupported platforms).

### Tool System (`src/tools/`, ~53 tools)

Each tool is a folder under `src/tools/` with its own `ToolNameTool.ts` (or `index.ts`). Core tools: `BashTool`, `FileEditTool`, `FileReadTool`, `FileWriteTool`, `GlobTool`, `GrepTool`, `WebFetchTool`, `WebSearchTool`, `AgentTool`, `SkillTool`, `TaskTool`, `MCPTool`, `TodoWriteTool`, `ExitPlanModeTool`, `EnterPlanModeTool`.

Feature-gated tools (e.g., `SleepTool`, `MonitorTool`, `RemoteTriggerTool`, `CronCreateTool`) use `require()` to enable dead code elimination in the original build. The `feature()` shim in `src/utils/featureFlags.ts` controls which are active. Many tools are also gated behind `USER_TYPE === 'ant'` (200+ checks in source) or GrowthBook remote flags.

### Command System (`src/commands/`, ~95 commands)

Each command is a folder exporting `description`, `isEnabled`, and either a React/Ink component (interactive) or options (non-interactive). Commands map to `/` slash-commands in the REPL. Key commands: `/init`, `/help`, `/agents`, `/plan`, `/permissions`, `/hooks`, `/config`, `/model`, `/mcp`, `/memory`, `/stats`, `/doctor`, `/review`, `/compact`, `/diff`, `/theme`, `/vim`, `/tasks`, `/statusline`.

### Agent / Subagent System (`src/tools/AgentTool/`)

The `Agent` tool spawns subagents with isolated tool pools:
- **Agent definitions** (`loadAgentsDir.ts`): loaded from markdown frontmatter or `.agents.json` — schema includes `tools`, `disallowedTools`, `permissionMode`, `mcpServers`, `hooks`, `maxTurns`, `skills`, `isolation`
- **Built-in agents** (`builtInAgents.ts`): `general-purpose`, `statusline-setup`, `Explore`, `Plan` (feature-gated), `nexus-guide`, `verification` (feature-gated)
- **Tool isolation**: `ALL_AGENT_DISALLOWED_TOOLS` blocks nested Agent/AskUserQuestion/TaskStop; `ASYNC_AGENT_ALLOWED_TOOLS` restricts background agents to read/search/edit tools
- **Execution** (`runAgent.ts`): spawns through `query()` with `createSubagentContext`, supports fork-mode (inherits parent system prompt for cache sharing), worktree isolation, and agent-specific MCP servers
- **Async agents**: triggered by `run_in_background`, agent `background:true`, or coordinator mode — streams to `LocalAgentTask`, fires handoff classifier on completion

### Permission System

Layered permission architecture:

1. **Modes** (`src/utils/permissions/PermissionMode.ts`): `default`, `plan`, `acceptEdits`, `bypassPermissions`, `dontAsk`, plus feature-gated `auto`/`bubble`
2. **Rule matching** (`src/utils/permissions/permissions.ts`): allow/deny/ask rules with wildcard content (e.g., `Bash(git *)`)
3. **PreToolUse hooks** (`src/utils/hooks.ts`): can force allow/deny before the normal flow
4. **Bash classifier** (`src/utils/permissions/yoloClassifier.ts`): local classifier for auto-approving safe shell commands (gated behind `BASH_CLASSIFIER` feature)
5. **Interactive prompts** (`src/hooks/useCanUseTool.tsx`): builds `PermissionContext` per tool use, resolves via classifier → hooks → user prompt UI
6. **Permission persistence**: `PermissionUpdate.ts` persists rules to settings sources

Tool approval is enabled by default. Bash gets a specialized pipeline with tree-sitter AST parsing and dangerous-pattern detection.

### MCP Integration (`src/services/mcp/`)

First-class Model Context Protocol support:
- **`client.ts`**: `connectToServer` (memoized, reconnect + exponential backoff), `getMcpToolsCommandsAndResources`, OAuth discovery
- **`config.ts`**: config sources — `.mcp.json` (project), `profile.json` in the user configuration directory, settings.json scopes, enterprise file, plugin-provided servers
- **`useManageMCPConnections.ts`**: React hook — initializes connections, listens for `ToolListChanged`/`ResourceListChanged`, drives `appState.mcp`
- MCP **never blocks REPL render** or turn-1 time-to-first-token — connections populate async

### Feature Flags

Build features use Bun's compile-time gates. Local runtime overrides and subscribers are defined in `src/services/analytics/featureFlags.ts`.

### State Management

Simple zustand-style store (`src/state/store.ts`): `createStore<T>` with getState/setState/subscribe. `AppStateStore` holds the full application state (settings, model, MCP clients/tools/commands, plugins, agent tasks, bridge state). React access via `useAppState(selector)` and `useSetAppState()` from `src/state/AppState.tsx`.

### Rendering

The TUI uses **React + Ink** (terminal React renderer). Components live in `src/components/`, hooks in `src/hooks/`. `src/screens/REPL.tsx` is the main interactive screen (~28k lines). Key components: `Messages.tsx`, `VirtualMessageList.tsx`, `TextInput.tsx`, `Markdown.tsx`, `StructuredDiff.tsx`. Design system components in `src/components/design-system/`.

### Key Hooks

- `useCanUseTool.tsx` — orchestrates the full permission flow per tool use
- `useTypeahead.tsx` — command/skill/path autocomplete engine
- `useVirtualScroll.ts` — virtualized message list rendering
- `useMergedTools.ts` / `useMergedCommands.ts` / `useMergedClients.ts` — merge built-ins with MCP/plugin-provided items
- `useManageMCPConnections.ts` — MCP connection lifecycle
- `useGlobalKeybindings.tsx` — keyboard shortcut handling
- `notifs/` — 17 notification hooks (rate limits, MCP connectivity, LSP init, IDE status, etc.)

### Model routing

Quark, Atom and Electron are native orchestration roles. Agent definitions select a role or inherit their parent's model. The catalog resolves each role directly to its configured channel and physical model. Keep wire model IDs opaque and preserve their spelling. Inference, limits and pricing use the selected model's configuration. External protocol headers and URL paths belong in the corresponding adapter.

The CLI uses `NEXUS_CONFIG_DIR` (default `~/.nexus`), `settings.json`, `models.json` and `profile.json`. An existing Nexus profile is upgraded at startup. Conversations remain in their original project directories.

### Coding Conventions

- TypeScript + ESM + `"jsx": "react-jsx"` (automatic JSX transform)
- No semicolons, single quotes, camelCase vars, PascalCase classes/components
- Import order is significant in some files — watch for `biome-ignore-all assist/source/organizeImports` comments
- `src/utils/` is massive (33+ subdirs) — prefer adding new utils near the feature that uses them
- Path aliases: `src/*` maps to `./src/*`
- Command folders use kebab-case (e.g., `src/commands/install-slack-app/`)
- Prefer small, focused modules; match surrounding file style exactly
- This is a reconstructed tree, not pristine upstream — prefer minimal, auditable changes, and document any workaround added because a module was restored with fallbacks or shim behavior
