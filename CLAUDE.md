# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
bin/nexus.cjs
  → spawns: bun run src/dev-entry.ts
    → src/dev-entry.ts (scans for missing imports; if 0 missing, imports entrypoints/cli.tsx)
      → src/entrypoints/cli.tsx (Commander CLI, parses args)
        → src/main.tsx (heavy import graph, init, launches REPL via src/replLauncher.tsx)
          → src/setup.ts (session bootstrap: cwd, permissions, worktree, hooks, analytics)
            → src/QueryEngine.ts (conversation loop: user → API → tools → API → response)
              → src/query.ts (low-level API dispatch, streaming, message formatting)
```

### Key Modules

| Module | Role |
|--------|------|
| `src/QueryEngine.ts` | Main conversation orchestrator — runs the agentic loop (prompt → API → tool calls → repeat) |
| `src/query.ts` | API request construction, streaming, message normalization, token tracking |
| `src/Tool.ts` | Base `Tool` class + `ToolUseContext` + permission interfaces |
| `src/tools.ts` | Tool registry — instantiates all tools, many gated behind `feature()` / `USER_TYPE` |
| `src/commands.ts` | Slash-command registry — loads all commands from `src/commands/` |
| `src/services/api/claude.ts` | Anthropic/DeepSeek API client — message streaming, tool calling, usage tracking |
| `src/main.tsx` | CLI entrypoint — Commander arg parsing, model/provider config, REPL launch |
| `src/setup.ts` | Session initialization — permissions, worktree creation, analytics, env validation |

### Tool System (`src/tools/`, ~53 tools)

Each tool is a folder under `src/tools/` with its own `ToolNameTool.ts` (or `index.ts`). Core tools: `BashTool`, `FileEditTool`, `FileReadTool`, `FileWriteTool`, `GlobTool`, `GrepTool`, `WebFetchTool`, `WebSearchTool`, `AgentTool`, `SkillTool`, `TaskTool`, `MCPTool`, `TodoWriteTool`, `ExitPlanModeTool`, `EnterPlanModeTool`.

Feature-gated tools (e.g., `SleepTool`, `MonitorTool`, `RemoteTriggerTool`) use `require()` to enable dead code elimination in the original build. The `feature()` shim in `src/utils/featureFlags.ts` controls which are active.

### Command System (`src/commands/`, ~87 commands)

Each command is a folder exporting `description`, `isEnabled`, and either a React/Ink component (interactive) or options (non-interactive). Commands map to `/` slash-commands in the REPL.

### Feature Flags

The original codebase had ~50 `feature('FLAG_NAME')` calls — these were build-time constants eliminated by Bun's bundler. In this restored tree, `src/utils/featureFlags.ts` provides a shim that enables a curated subset. To enable a feature, add it to the `ENABLED` set.

GrowthBook remote flags (`tengu_*`) are separate — they're runtime A/B test toggles from `src/services/analytics/growthbook.js`.

### Backend Configuration

`bin/nexus.cjs` manages `~/.nexus/settings.json` and defaults to DeepSeek API as the backend. Key env vars: `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL`. The frontend API remains compatible with the Anthropic SDK shape.

### Rendering

The TUI uses **React + Ink** (terminal React renderer). Components live in `src/components/`, hooks in `src/hooks/`. `src/screens/REPL.tsx` is the main interactive screen.

### Coding Conventions

- TypeScript + ESM + `"jsx": "react-jsx"` (automatic JSX transform)
- No semicolons, single quotes, camelCase vars, PascalCase classes/components
- Import order is significant in some files — watch for `biome-ignore-all assist/source/organizeImports` comments
- `src/utils/` is massive (33+ subdirs) — prefer adding new utils near the feature that uses them
- Path aliases: `src/*` maps to `./src/*`
