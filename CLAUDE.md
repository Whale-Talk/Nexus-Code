# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Nexus Code — Claude Code 的"还原版"（reverse-engineered），用 Vercel AI SDK 替换 Anthropic SDK，支持多 AI 提供商后端。运行时为 Bun ≥ 1.3.5 + TypeScript ESM，终端 UI 基于 React + Ink。

## 构建 / 运行 / 测试

```bash
bun install          # 安装依赖（bun ≥ 1.3.5, Node ≥ 24）
bun run dev          # 启动开发模式（REPL）
bun run start        # 同上
bun run test         # 运行 68 个单元测试（bun test）
bun run typecheck    # typecheck 基线门（存量签名不拦，只拦新增）
bun run typecheck:raw    # 裸 tsc --noEmit（完整输出）
bun run audit:check  # 依赖漏洞基线检查
bun run version      # 打印版本号（导入图冒烟测试）

# 更新 typecheck / audit 基线：
bun run .github/scripts/typecheck-baseline.ts --update-baseline
bun run .github/scripts/audit-baseline.ts --update-baseline
```

本地复现 CI 的 5 道门禁：`bun run version` → `bun run typecheck` → `bun run test` → `bun run audit:check`，加上 gitleaks（见 `.gitleaks.toml`）。

## 架构

### 启动链

```
bin/nexus.cjs                   # 启动器：配置隔离 + 环境桥接（NEXUS_* ↔ ANTHROPIC_*）
  └─ bun run src/dev-entry.ts   # 缺失 import 检测 → 全绿后转发
       └─ src/entrypoints/cli.tsx  # bootstrap：多 fast-path，最终 → src/main.tsx
```

`bin/nexus.cjs` 管理 `~/.nexus/settings.json` 配置初始化、API key 解析、NEXUS_*/ANTHROPIC_* 环境变量桥接，然后 spawn `bun run` 进入 TypeScript 侧。

**关键环境变量**（全部 `NEXUS_*` 前缀）：
- `NEXUS_BASE_URL` — 后端地址（默认 DeepSeek relay `https://api.deepseek.com/anthropic`）
- `NEXUS_API_KEY` — API 密钥（不加 `sk-` 前缀）
- `NEXUS_MODEL` — 主循环模型（默认 `deepseek-v4-pro[1m]`）
- `NEXUS_SUBAGENT_MODEL` — 子代理模型（默认 `deepseek-v4-flash[1m]`）
- `NEXUS_QUARK_MODEL` / `NEXUS_ATOM_MODEL` / `NEXUS_ELECTRON_MODEL` — 三角色模型覆盖
- `NEXUS_PROVIDER` — Provider 类型（`anthropic` | `openai-compatible`）

`~/.nexus/settings.json` 中 `deepseek.effort` 控制推理 effort（`max`/`high`/`medium`/`low`）。

### Provider 抽象层（`src/services/api/provider/`）

2,028 行，核心设计模式：**注册表 + 工厂 + 适配器**。

```
types.ts          # 内部契约：ModelRequest / StreamEvent / ProviderAdapter / 错误类
index.ts          # 注册表：registerProvider(kind, factory) + getProvider(kind) 懒加载+缓存
errors.ts         # 6 类错误：APIError / APIConnectionError / AuthenticationError / NotFoundError / APIUserAbortError / APIConnectionTimeoutError
implementations/
  anthropic.ts    # P1-A：@ai-sdk/anthropic 适配（DeepSeek relay / 直连 Anthropic）
  openai-compatible.ts  # P1-B：@ai-sdk/openai-compatible 适配（任意 OpenAI 兼容后端）
```

两个 `ProviderKind`：`'anthropic'` 和 `'openai-compatible'`。Bedrock/Foundry/Vertex 保留 `@anthropic-ai/sdk` 路径，不走此抽象层。

适配器的两核心方法：
- `streamText(request, signal?) → StreamResponse` — 流式请求，返回 `AsyncIterable<StreamEvent>`
- `generateText(request, signal?) → WithResponse<AssistantMessage>` — 非流式请求

**关键映射决策**：
1. thinking budget 格式 `{type:'enabled', budget_tokens:N}` → providerOptions 透传，DeepSeek relay 兼容
2. DeepSeek relay 的 `stop_reason: 'tool_calls'` 归一化为 Anthropic 命名 `'tool_use'`
3. reasoning 块统一映射（DeepSeek 无 Anthropic signature → 置 `''`）
4. X-Conversation-ID / X-Message-ID / X-Parent-Message-ID 会话追踪头（仅对非 api.anthropic.com relay 注入）
5. AI SDK 内部重试关闭（`maxRetries: 0`），重试由 `withRetry` 层负责

### 核心 API 层（`src/services/api/claude.ts`）

3,639 行 — 主 API 客户端。管理消息规范化、系统提示词组装、工具 schema 转换、流事件处理、速率限制、错误恢复。通过 Provider 抽象层发送请求。

### 工具系统（`src/tools/`）

50+ 个工具，每个独立目录。核心工具：
- `BashTool/` — shell 命令执行
- `FileEditTool/` / `FileReadTool/` / `FileWriteTool/` — 文件操作
- `AgentTool/` — 子代理生成
- `MCPTool/` — MCP 协议集成
- `Task*Tool/` — 任务管理（Create/Get/List/Update/Stop/Output）
- `WebSearchTool/` / `WebFetchTool/` — 网络搜索/抓取
- `SkillTool/` — 技能调用
- `WorkflowTool/` — 多代理工作流编排

工具注册和调度见 `src/services/tools/`。

### 斜杠命令（`src/commands/`）

60+ 个命令，每个独立目录。与 Claude Code 命令体系对齐：`/model`、`/config`、`/mcp`、`/agents`、`/review`、`/compact` 等。Nexus 特有：`/nexus-config`。

### OMC 多代理编排（`.claude/`）

- `agents/` — 20 个专业代理定义（executor / architect / critic / explore / debugger / security-reviewer / test-engineer 等），Markdown frontmatter 驱动
- `CLAUDE.md` — 项目级 OMC 指令（技能路由表、代理目录、验证要求）

代理通过 `AgentTool` 以 `subagent_type` 调用，技能通过 `SkillTool` 调用。

### 关键目录速查

| 目录 | 用途 |
|------|------|
| `src/components/` | React + Ink 终端 UI 组件（消息渲染、权限对话框、设置面板等） |
| `src/screens/` | 终端页面级组件 |
| `src/utils/model/` | 模型解析、选择、别名映射（quark/atom/electron → 具体模型 ID） |
| `src/utils/settings/` | 配置文件读写 |
| `src/utils/git/` | Git 操作工具 |
| `src/utils/mcp/` | MCP 服务器管理 |
| `src/services/mcp/` | MCP 协议实现 |
| `src/constants/prompts.js` | 系统提示词 |
| `src/types/` | 共享类型定义 |

## CI/CD

5 道门禁（`.github/workflows/ci.yml`），无 paths-filter/skip 条件：
1. **L0** — gitleaks 密钥扫描
2. **L1** — `bun install` + 导入图冒烟（`bun run version`）+ lockfile 漂移检查
3. **L2** — typecheck 基线门（`bun run typecheck`）：存量 ~708 签名不拦，只拦 `(文件, TS错误码)` 新组合
4. **L3** — `bun test`（68 个单元测试）
5. **L4** — 依赖漏洞基线（`bun run audit:check`）：只拦新增 critical/high

Release：tag 推送触发 `.github/workflows/release.yml`，自动生成 GitHub Release。

## 代码约定

- **TypeScript ESM**，`tsconfig.json` 中 `strict: false`（存量代码宽松，新代码建议类型严格）
- **路径别名**：`src/*` → `./src/*`
- **动态 import** 优先：`cli.tsx` 中所有分支使用 `await import()` 懒加载，最小化模块求值
- **feature flag**：`bun:bundle` 的 `feature()` 用于 build-time DCE（`ABLATION_BASELINE`、`BRIDGE_MODE`、`DAEMON` 等）
- **环境变量前缀**：配置层统一 `NEXUS_*`，`bin/nexus.cjs` 负责桥接到 `ANTHROPIC_*`
- **无 bundle 产物**：分发方式是 `clone + bun run`，编译健康由导入图冒烟 + tsc + bun test 三重覆盖
