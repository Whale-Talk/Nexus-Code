# CLAUDE.md

This file provides guidance to Nexus Code (claude.ai/code) when working with code in this repository.

## Quick Commands

```bash
bun install        # install dependencies (requires Bun ≥1.3.5, Node ≥24)
bun run dev        # start CLI interactively
bun run start      # alias for dev
bun run version    # verify CLI boots and prints version
```

No `lint` or `test` scripts exist. Verify changes by booting `bun run dev` and exercising the affected flow.

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
- Resolves API key from `ANTHROPIC_API_KEY` env → `settings.env`; existing user settings win on merge
- Sets `CLAUDE_CONFIG_DIR=~/.nexus`, generates a per-session `CLAUDE_CONVERSATION_ID` (UUID)
- Injects `--permission-mode bypassPermissions` by default (unless user passes a permission flag)
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
| `src/services/api/claude.ts` | Anthropic/DeepSeek API client — message streaming, tool calling, prompt caching, usage tracking |
| `src/services/api/client.ts` | Fetch-layer wrapper — injects `X-Conversation-ID`/`X-Message-ID`/`X-Parent-Message-ID` headers for relay capture |
| `src/main.tsx` | CLI entrypoint — Commander arg parsing, model/provider config, REPL launch |
| `src/setup.ts` | Session initialization — permissions, worktree creation, hooks, analytics, env validation |

### Shims & Vendor

`shims/` — Local package stubs replacing dependencies that couldn't be restored from source maps. Each is a folder with `package.json` (`"version": "0.0.0-restored"`, `"main": "./index.ts"`) referenced via `"file:./shims/..."` in root `package.json`:

- **No-op API stubs**: `ant-computer-use-mcp`, `ant-computer-use-input`, `ant-computer-use-swift`, `ant-claude-for-chrome-mcp` — export the same surface but with inert/no-op behavior
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
- **Built-in agents** (`builtInAgents.ts`): `general-purpose`, `statusline-setup`, `Explore`, `Plan` (feature-gated), `claude-code-guide`, `verification` (feature-gated)
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

Nexus default: `bin/nexus.cjs` injects `--permission-mode bypassPermissions`. Bash gets a specialized pipeline with tree-sitter AST parsing and dangerous-pattern detection.

### MCP Integration (`src/services/mcp/`)

First-class Model Context Protocol support:
- **`client.ts`**: `connectToServer` (memoized, reconnect + exponential backoff), `getMcpToolsCommandsAndResources`, OAuth discovery
- **`config.ts`**: config sources — `.mcp.json` (project), `.claude.json` per-project, settings.json scopes, enterprise file, plugin-provided servers, claude.ai connectors
- **`useManageMCPConnections.ts`**: React hook — initializes connections, listens for `ToolListChanged`/`ResourceListChanged`, drives `appState.mcp`
- MCP **never blocks REPL render** or turn-1 time-to-first-token — connections populate async

### Feature Flags (Three-Layer Gating)

1. **Compile-time `feature()`** (~50 flags): `BUDDY`, `KAIROS`, `ULTRAPLAN`, `COORDINATOR_MODE`, `BRIDGE_MODE`, `VOICE_MODE`, `PROACTIVE`, `BASH_CLASSIFIER`, etc. In this restored tree, `src/utils/featureFlags.ts` provides a shim — currently only `BUILTIN_EXPLORE_PLAN_AGENTS` and `VERIFICATION_AGENT` are enabled. Add flags to the `ENABLED` set to activate.
2. **Runtime `USER_TYPE`**: `'ant'` (internal) vs `'external'` — 200+ checks gating internal commands, debug tools, GrowthBook overrides
3. **GrowthBook remote flags** (`tengu_*`): runtime A/B test toggles from `src/services/analytics/growthbook.js`

### State Management

Simple zustand-style store (`src/state/store.ts`): `createStore<T>` with getState/setState/subscribe. `AppStateStore` holds the full application state (settings, model, MCP clients/tools/commands, plugins, agent tasks, bridge state). React access via `useAppState(selector)` and `useSetAppState()` from `src/state/AppState.tsx`.

### Rendering

The TUI uses **React + Ink** (terminal React renderer). Components live in `src/components/`, hooks in `src/hooks/`. `src/screens/REPL.tsx` is the main interactive screen (~28k lines). Key components: `Messages.tsx`, `VirtualMessageList.tsx`, `TextInput.tsx`, `Markdown.tsx`, `StructuredDiff.tsx`. Design system components in `src/components/design-system/`.

### Key Hooks

- `useCanUseTool.tsx` — orchestrates the full permission flow per tool use
- `useTypeahead.tsx` — command/skill/path autocomplete engine
- `useReplBridge.tsx` — remote bridge (claude.ai ↔ local REPL)
- `useVirtualScroll.ts` — virtualized message list rendering
- `useMergedTools.ts` / `useMergedCommands.ts` / `useMergedClients.ts` — merge built-ins with MCP/plugin-provided items
- `useManageMCPConnections.ts` — MCP connection lifecycle
- `useGlobalKeybindings.tsx` — keyboard shortcut handling
- `notifs/` — 17 notification hooks (rate limits, MCP connectivity, LSP init, IDE status, etc.)

### Backend Configuration

`bin/nexus.cjs` manages `~/.nexus/settings.json` and defaults to DeepSeek API as the backend. Key env vars: `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL`. The frontend API remains compatible with the Anthropic SDK shape. The API client (`src/services/api/client.ts`) injects Nexus-specific conversation tracking headers (`X-Conversation-ID`, `X-Message-ID`, `X-Parent-Message-ID`) for the relay's capture layer.

### Coding Conventions

- TypeScript + ESM + `"jsx": "react-jsx"` (automatic JSX transform)
- No semicolons, single quotes, camelCase vars, PascalCase classes/components
- Import order is significant in some files — watch for `biome-ignore-all assist/source/organizeImports` comments
- `src/utils/` is massive (33+ subdirs) — prefer adding new utils near the feature that uses them
- Path aliases: `src/*` maps to `./src/*`
- Command folders use kebab-case (e.g., `src/commands/install-slack-app/`)
- Prefer small, focused modules; match surrounding file style exactly
