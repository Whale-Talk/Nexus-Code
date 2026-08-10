# Changelog

> Nexus Code 修改日志 — 按版本分组，记录从项目开始至今的全部变更。
> 仓库: https://github.com/NexusAir-Technologies/agent_NexusCode

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

## 附录: 文档索引

- 知识库: `/mnt/e/MD知识库/Nexus-Code/`
- 模型配置指南: `Nexus-模型配置-三角色模型设置指南.md`
- 多厂商适配排查: `Nexus-模型适配-多厂商切换与显示Bug排查记录.md`
- 发布报告: `Nexus-发布报告-v0.2.0.md`
