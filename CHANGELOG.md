# Changelog

> Nexus Code 修改日志 — 按版本分组，记录从项目开始至今的全部变更。
> 仓库: https://github.com/NexusAir-Technologies/agent_NexusCode

---

## [1.0.6] - 2026-08-13

### 修复
- **Windows 原生环境适配**（按 Windows 适配问题报告逐项修复）：
  - `checkBunAvailable` → `resolveBunBinary()`：按平台解析扩展名（win32 检查 `bun.exe`/`bun.cmd`，POSIX 裸名）
  - 搜索范围扩至 PATH + `~/.bun/bin` + npm bun bin（Windows npm 安装的 bun 不在 PATH）
  - `BUN_BINARY` 语义统一：绝对路径直接使用，裸名经搜索目录解析
  - `spawn` 改用解析后的绝对路径（`spawn bun ENOENT` 根因修复）
  - 报错信息平台化（Windows 提示 `npm install -g bun`）
  - postinstall：PATH 分隔符用 `path.delimiter`（修复硬编码 `:`）；Windows PATH 配置提示（setx 一键命令）
  - README：Windows 原生安装章节 + FAQ

---

## [1.0.5] - 2026-08-11

### 新增
- **OMN (Oh My Nexus) — 关键词原生触发**：官方 oh-my-claudecode keyword-detector 全量移植为 Nexus 内置模块，不再依赖 CC 插件 hooks
  - `src/utils/omn/keywordDetector.ts`：14 种模式检测（cancel/ralph/autopilot/ultrawork/ccg/ralplan/deep-interview/ai-slop-cleaner/tdd/code-review/security-review/ultrathink/deepsearch/analyze）
  - `src/utils/omn/invocation.ts`：紧凑技能引导块（不内联 SKILL.md，防 token 爆炸）
  - `src/utils/omn/state.ts`：`.omc/state/` 模式状态激活/清理（原子写入）
  - `processUserInput` 挂载：命中关键词 → 注入引导文本 + 激活状态
  - 意图过滤：提问/诊断/引用对比不触发（"什么是 ralph" 不会启动 ralph）
  - 系统回声剥离：粘贴 [RALPH LOOP]/[MAGIC KEYWORD] 历史输出不会重新触发
  - 清洗：代码块/URL/路径/XML/角色块/diff 中的关键词不误触发
  - 中英文意图模式（中文诊断/追问/对比补齐）
  - Kill switch：`DISABLE_OMC=1` / `NEXUS_DISABLE_OMN=1` / `OMC_SKIP_HOOKS=keyword-detector`

### 修复
- 技能 typeahead 重复（去重从 inode 改为按名称：legacy 回退目录是物理副本，inode 去重失效）

### 文档
- README：OMN 编排层说明 + 关键词触发行为 + kill switch

---

## [1.0.4] - 2026-08-11

### 修复（全项目 5 维审查发现）
- **启动器**：shebang 改回 `#!/usr/bin/env node`（bun 缺失时友好提示真正可达）；子代理模型缺省跟随 `NEXUS_MODEL`（非 DeepSeek 厂商子代理可用）；effort 默认值统一
- **改名回退对称**：项目级 `.claude/{skills,agents,commands}` legacy 回退；`rules` 路径改为 `.nexus/rules` 优先 + `.claude/rules` 回退；`--add-dir` 技能监听路径修正；危险目录保护补 `.nexus`
- **安全**：删除 WebSearchTool/ModelPicker 遗留 `/tmp` 调试日志（PII）；`@include` symlink 跨界防护（realpath 后判定外部）；gitleaks 路径级豁免改为精确 key 字面量豁免
- **配置**：dev/launcher 模式全局配置统一（`getGlobalClaudeFile` 回退 `getNexusConfigHomeDir`）；`NEXUS_PROVIDER` 非法值 fail-fast
- **Provider**：openai-compatible baseURL 智能 `/v1` 归一化（已含版本段则不追加）；VERTEX_REGION 文档键名修正
- **技能**：settings 变更时清 skills/commands 缓存
- **模型**：ModelPicker 用 `lastIndexOf('::')` 防模型 ID 含 `::` 截断；`deepseek`/`flash` 别名补解析 case

### 文档
- 安装教程迁移至 README（Bun 安装 / 3 步安装 / 密钥配置 / 三角色 / 常见问题）
- 知识库仅保留成员 API Token 分配 + settings.json 参考

---

## [1.0.3] - 2026-08-10

### 变更
- **`CLAUDE_CODE_SUBAGENT_MODEL` → `NEXUS_SUBAGENT_MODEL` 改名**（settings.json 不再出现 CLAUDE 字样）：
  - launcher 默认值 + 透传、`agent.ts` 读取、`managedEnvConstants.ts` 保护列表
  - 旧键保留兼容回退（`NEXUS_SUBAGENT_MODEL || CLAUDE_CODE_SUBAGENT_MODEL`）
  - launcher 同时同步设置 `CLAUDE_CODE_SUBAGENT_MODEL` 以兼容 SDK 内部读取

---

## [1.0.2] - 2026-08-10

### 变更
- **CLAUDE.md → NEXUS.md 全量改名**：86 文件跨层级迁移
  - 核心模块 `claudemd.ts` → `nexusmd.ts`（内存文件发现/加载/注入）
  - 导出符号：`getClaudeMds` → `getNexusMds` 等 15+ 符号全量改名
  - 组件 `ClaudeMdExternalIncludesDialog` → `NexusMdExternalIncludesDialog`
  - 用户可见文案：`/init` 提示词、新手引导、remember 技能、insights、设置描述
  - 旧 `claudemd.ts` 保留为重导出 shim，`isMemoryFilePath` 兼容识别旧 `CLAUDE.md` 文件名
  - 遥测事件名和 `CLAUDE_CODE_*` 环境变量有意保留不变

### 修复
- **安装后 "nexus: command not found"**（3 项修复）：
  - shebang `#!/usr/bin/env node` → `#!/usr/bin/env bun`（消除 Node.js 依赖，项目本身 bun-first）
  - 新增 pre-flight 检查：启动前检测 bun 是否可用，缺失时打印安装引导
  - 新增 `scripts/postinstall.cjs`：安装后自动检测 PATH 配置，按场景给出指南
  - `spawn` ENOENT 时给出 "bun was removed or PATH changed" 清晰提示

---

## [1.0.1] - 2026-08-09

### 新增
- **多厂商通用适配**：`NEXUS_PROVIDER`（anthropic / openai-compatible），三角色模型 ID 配置化（`NEXUS_QUARK_MODEL` / `NEXUS_ATOM_MODEL` / `NEXUS_ELECTRON_MODEL`）
- **GLM 支持**：智谱 API 适配（thinking 流、1M 上下文识别、裸名 `[1m]` 剥离）
- **本地 WebSearch**：Exa MCP 搜索（`mcp.exa.ai/mcp`），厂商无关，任何模型可用
- **本地 WebFetch**：HTTP + turndown 转 Markdown，`skipWebFetchPreflight` 跳过域名校验
- **双搜索 Provider**：Exa（默认）/ Parallel 备选，`NEXUS_SEARCH_PROVIDER` 切换 + API key 支持
- **nexus-config 引导**：无 API key 时表单配置 URL + 密钥，替代 OAuth 登录

### 修复
- 503 错误：模型 env 保护（`PROVIDER_MANAGED_ENV_VARS` 防旧 settings 覆盖）
- OAuth 彻底禁用（Nexus 无账号概念）
- 模型菜单：双光标 / 嵌套后缀 / 缺 Electron / "Custom model" 显示
- 默认模型解析：`NEXUS_MODEL` 优先于角色默认
- 单模型兼容：三角色缺省跟随 `NEXUS_MODEL`
- openai-compatible 适配器 metadata 扩展

### 变更
- 品牌化：全量中文 UI（欢迎页 / 信任对话框 / 安全提示 / 主题选择 / Bypass 警告）
- `ANTHROPIC_*` → `NEXUS_*` 环境变量改名（46 文件）
- opus/sonnet/haiku → quark/atom/electron 全量改名（注释 + 文案）
- README 重写（Nexus 定位，去除上游引用）
- WebFetch 域名校验可选跳过（企业 egress 场景）

---

## [0.2.0] - 2026-08-09

### 新增
- **CICD 基建**：5 道 CI 门禁（gitleaks / 安装健康 / typecheck 基线 / 单元测试 / 漏洞基线）
- **分支保护**：main 5 checks required + strict + enforce_admins
- **release.yml**：tag 触发自动发布（changelog + GitHub Release）
- **68 个单元测试**：aliases / providers / thinking / modelOptions / sessionRestore
- **typecheck 基线门**：713 → 708 存量签名，只拦新增
- **audit 基线门**：93 漏洞基线，只拦新增 critical/high
- **Provider 抽象层**：Vercel AI SDK 替换 Anthropic SDK（118 → 1 文件）
  - `types.ts`（49 符号 × 3 语义组）
  - `errors.ts`（6 错误类）
  - `anthropic.ts` / `openai-compatible.ts` 双适配器
- **API key 对话框**：默认 Yes（recommended）+ 中文

### 修复
- `scheduleRemoteAgents.ts` 反引号语法 bug（23 连锁 TS1005）
- 状态栏 current_usage 对象 → 数字
- thinking 显示：折叠 + 蓝色代码高亮
- AUTH_TOKEN 冲突警告（launcher 清理继承变量）

### 变更
- 启动器 `bin/nexus.cjs`：配置隔离 `~/.nexus/`、originalCwd 会话隔离修复
- 粒子模型体系：Quark / Atom / Electron（映射 deepseek 模型）
- OMC 集成：37 技能 + 20 代理
- Neon 随机调色板 Logo
- X-Conversation-ID 会话追踪

---

## [0.1.0] - 2026-08-08

### 新增
- **项目初始化**：从 Claude Code source map 还原可运行 TypeScript 源码
- **Nexus launcher**：`bin/nexus.cjs`（命令 `nexus`，配置隔离）
- **DeepSeek relay 接入**：ANTHROPIC_BASE_URL → DeepSeek
- **品牌化**：全局改名 Claude Code → Nexus Code（196 文件）

---

## 附录: 关键版本节点

| 版本 | 日期 | 里程碑 |
|------|------|--------|
| 0.1.0 | 2026-08-08 | 项目初始化 + 还原源码 + Nexus 品牌化 |
| 0.2.0 | 2026-08-09 | CICD 基建 + SDK 替换 + 单元测试 |
| 1.0.1 | 2026-08-09 | 多厂商适配 + GLM + 本地搜索 + 中文 UI |
| 1.0.2 | 2026-08-10 | CLAUDE.md→NEXUS.md 全量改名 + 安装问题修复 |
| 1.0.3 | 2026-08-10 | NEXUS_SUBAGENT_MODEL 环境变量改名 |
| 1.0.4 | 2026-08-11 | 全项目审查修复（回退对称/安全/启动器/文档重构） |
| 1.0.5 | 2026-08-11 | OMN 关键词原生触发 + 技能去重修复 |
| 1.0.6 | 2026-08-13 | Windows 原生环境适配（bun 定位 + PATH） |

## 附录: 文档索引

- 知识库: `/mnt/e/MD知识库/Nexus-Code/`
- 模型配置指南: `Nexus-模型配置-三角色模型设置指南.md`
- 多厂商适配排查: `Nexus-模型适配-多厂商切换与显示Bug排查记录.md`
- 发布报告: `Nexus-发布报告-v0.2.0.md`
