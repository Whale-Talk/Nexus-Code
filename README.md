# Nexus Code

> 完全自主可控的 AI 编程终端 — DeepSeek relay 驱动，Vercel AI SDK 多提供商引擎，企业级 CICD。

<p align="center">
  <img src="preview.png?raw=true" alt="Nexus Code CLI" width="700">
</p>

---

## ✨ 核心特色

### 🔧 多提供商 SDK 引擎
用 Vercel AI SDK 替换 Anthropic SDK，2,028 行 Provider 抽象层：
- `@ai-sdk/anthropic` → DeepSeek relay (Anthropic 格式)
- `@ai-sdk/openai-compatible` → 任意 OpenAI 兼容后端
- 注册表 + 工厂模式，新提供商即插即用
- **SDK import: 118 → 1 文件**

### 🧠 DeepSeek Thinking 原生支持
- thinking 流式实时渲染，蓝色代码高亮，`ctrl+o` 展开/折叠
- budget 格式 `{type:'enabled', budget_tokens:N}`（DeepSeek 兼容）
- reasoning 块统一映射（含 signature）

### ⚛️ 粒子模型体系
| 角色 | 名称 | 说明 |
|------|------|------|
| Quark | 深度推理 | `deepseek-v4-pro[1m]`, 1M 上下文 |
| Atom | 日常主力 | `deepseek-v4-flash[1m]`, 1M 上下文 |
| Electron | 极速模式 | `deepseek-v4-flash` |

`atom/quark/electron` 别名直达，`--model glm-5.2` 等任意 relay 支持模型一键切换。

### 🛡️ 企业级 CICD
- 5 道 CI 门禁：gitleaks / 安装健康 / typecheck 基线(708) / 68 单元测试 / 漏洞基线
- main 分支保护 + strict checks + enforce_admins
- tag 一键发布 → GitHub Release 自动生成

### 🤖 OMC 多 Agent 编排
内置 oh-my-claudecode 编排层：
- **37 个技能**：autopilot / ralph / team / ultrawork / ralplan / deep-interview 等
- **20 个专业代理**：executor / architect / critic / explore / debugger / security-reviewer / test-engineer 等
- 关键词自动触发（如 "ralph" → 持久执行循环，"team" → 并行协调）

### 🚀 全新用户引导
- 无 API key 时自动进入**配置表单**（输入服务地址 + 密钥），替代 OAuth 登录
- 完整中文化：欢迎页 / 信任对话框 / 安全提示 / 主题选择

### 📊 状态栏双色监控
```
🤖 Nexus Quark (1M context) 1M | ⚡️ 5.1% · 51.2k | 📈 11.8% · 118.4k
```
- 绿色模型名 + 上下文窗口 · 青色当前用量 · 橙色会话累计

### 🎨 视觉特色
- Neon 随机调色板 ASCII Art Logo（粒子主题）
- thinking 蓝色代码高亮（ANSI 34）
- AgentBar 状态条（子代理进度）

---

## 🚀 快速开始

### 安装

```bash
git clone --depth 1 --branch release/v1.0.3 https://github.com/NexusAir-Technologies/agent_NexusCode.git ~/nexus
cd ~/nexus
bun install       # 需要 Bun ≥ 1.3.5
bun link          # 全局注册 nexus 命令
```

### 配置

首次启动自动引导配置；或手动编辑 `~/.nexus/settings.json`：

```json
{
  "env": {
    "NEXUS_BASE_URL": "http://192.168.77.162:8080",
    "NEXUS_API_KEY": "你的Token",
    "NEXUS_MODEL": "deepseek-v4-pro[1m]"
  },
  "model": "deepseek-v4-pro[1m]"
}
```

> ⚠️ Token **不要**加 `sk-` 前缀。

### 启动 / 升级

```bash
nexus                    # 启动

cd ~/nexus               # 升级
git pull origin main
bun install
nexus
```

> 会话历史与配置在 `~/.nexus/`，升级不影响任何数据。

---

## 📁 项目结构

```
src/                        # 核心源码
├── services/api/provider/  # Provider 抽象层（types/errors/adapters）
├── tools/                  # 53 个工具（Bash/FileEdit/Agent/MCP...）
├── commands/               # 斜杠命令（含 /nexus-config）
├── services/               # API / MCP / analytics
├── components/             # 终端 UI 组件（React + Ink）
├── skills/                 # OMC 技能（37 个）
├── agents/                 # OMC 专业代理（20 个）
└── ...
bin/nexus.cjs               # 启动器（配置隔离 + 环境桥接）
.claude/                    # OMC 技能/代理定义
.github/                    # CI/CD（5 门禁 + release 自动化）
```

---

## 📊 关键数据

| 指标 | 值 |
|------|-----|
| 运行时 | Bun 1.3.14, TypeScript ESM |
| AI SDK | ai@7.0.58 + @ai-sdk/anthropic@4.0.36 + @ai-sdk/openai-compatible@3.0.27 |
| SDK import | 118 → 1 文件 |
| 单元测试 | 68 |
| typecheck 基线 | 708 签名（只拦新增） |
| OMC 技能 / 代理 | 37 / 20 |
| 分支保护 | 5 checks required |
