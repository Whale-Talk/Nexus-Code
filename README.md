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
| Electron | 极速模式 | `deepseek-v4-flash[1m]` |

`atom/quark/electron` 别名直达，`--model glm-5.2` 等任意 relay 支持模型一键切换。

### 🛡️ 企业级 CICD
- 5 道 CI 门禁：gitleaks / 安装健康 / typecheck 基线(708) / 68 单元测试 / 漏洞基线
- main 分支保护 + strict checks + enforce_admins
- tag 一键发布 → GitHub Release 自动生成

### 🤖 OMN (Oh My Nexus) 多 Agent 编排
oh-my-claudecode 编排层已**全量原生化**为 OMN 内置模块（无需外部插件）：
- **37 个技能**：autopilot / ralph / team / ultrawork / ralplan / deep-interview 等
- **20 个专业代理**：executor / architect / critic / explore / debugger / security-reviewer / test-engineer 等
- **关键词原生触发**（v1.0.5+）：对话直接输入触发，不再依赖 CC 插件 hooks
  - "ralph 修这个 bug" → 持久执行循环；"autopilot 构建 xx" → 全自主执行
  - "什么是 ralph？" → **不触发**（意图过滤，提问不会误启动工作流）
  - 粘贴历史输出 → **不触发**（系统回声剥离，防自我强化循环）
  - Kill switch：`DISABLE_OMC=1` / `NEXUS_DISABLE_OMN=1` / `OMC_SKIP_HOOKS=keyword-detector`

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

## 🚀 安装教程

### 0. 环境准备

**Linux / WSL2**，安装 [Bun](https://bun.sh)（≥1.3.5）：

```bash
curl -fsSL https://bun.sh/install | bash
# 重启终端或执行 source ~/.bashrc
bun --version   # 应输出 1.3.x
```

> ⚠️ 提示 `bun: command not found` 时，把 `~/.bun/bin` 加入 PATH：
> ```bash
> echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc
> ```

**Windows 原生**（v1.0.5+ 支持），安装 bun：

```powershell
npm install -g bun
# 或: powershell -c "irm bun.sh/install.ps1 | iex"
bun --version   # 应输出 1.3.x
```

> ⚠️ npm 安装的 bun 可执行文件在 `%APPDATA%\npm\node_modules\bun\bin\bun.exe`，不在 PATH。
> 需要把以下两个目录加入系统 PATH（设置 → 系统 → 高级系统设置 → 环境变量）：
>
> ```
> %USERPROFILE%\.bun\bin
> %APPDATA%\npm\node_modules\bun\bin
> ```
>
> 或 PowerShell 一键添加（当前用户）：
> ```powershell
> setx PATH "$env:PATH;%USERPROFILE%\.bun\bin;%APPDATA%\npm\node_modules\bun\bin"
> ```
> 然后**重启终端**。启动器会自动定位 `bun.exe`（含 PATH 外常见安装位置探测），无需手动配置 `BUN_BINARY`。

### 1. 安装（3 步）

```bash
# 第 1 步：克隆固定发布分支
git clone --depth 1 --branch release/v1.0.5 https://github.com/NexusAir-Technologies/agent_NexusCode.git ~/nexus
cd ~/nexus

# 第 2 步：安装依赖（约 15 秒）
bun install

# 第 3 步：全局注册 nexus 命令
bun link
```

验证：

```bash
nexus --version   # 应输出 1.0.5
```

### 2. 配置 API 密钥

首次启动自动创建 `~/.nexus/settings.json`；或手动编辑（三角色完整配置）：

```json
{
  "env": {
    "NEXUS_BASE_URL": "http://192.168.77.162:8080",
    "NEXUS_API_KEY": "你的Token",
    "NEXUS_PROVIDER": "anthropic",
    "NEXUS_MODEL": "deepseek-v4-pro[1m]",
    "NEXUS_QUARK_MODEL": "deepseek-v4-pro[1m]",
    "NEXUS_ATOM_MODEL": "deepseek-v4-flash[1m]",
    "NEXUS_ELECTRON_MODEL": "deepseek-v4-flash[1m]"
  },
  "model": "deepseek-v4-pro[1m]"
}
```

> 只配 `NEXUS_MODEL` 时，三角色自动跟随它（单模型兼容）。
> ⚠️ Token **不要**加 `sk-` 前缀。修改后重启 `nexus` 生效。
> API Token 找管理员分配（团队成员见内部文档）。

### 3. 三角色模型

| 角色 | 说明 | 默认模型 | 别名 |
|------|------|---------|------|
| **Quark** | 深度推理 | `deepseek-v4-pro[1m]` (1M) | `nexus --model quark` |
| **Atom** | 日常主力 | `deepseek-v4-flash[1m]` (1M) | `nexus --model atom` |
| **Electron** | 极速模式 | `deepseek-v4-flash[1m]` | `nexus --model electron` |

三角色未配置时自动跟随 `NEXUS_MODEL`；支持 GLM 等任意厂商（见 `NEXUS_PROVIDER`）。

### 4. 常用命令

| 操作 | 命令 |
|------|------|
| 启动 | `nexus` |
| 查看版本 | `nexus --version` |
| 指定模型 | `nexus --model deepseek-v4-flash[1m]` |
| 继续上次对话 | `nexus -c` |
| 恢复指定会话 | `nexus -r` |
| 对话中切模型 | `/model` |

### 5. 升级

```bash
cd ~/nexus
git pull origin main
bun install
nexus --version   # 确认版本号变化
```

> 会话历史与配置在 `~/.nexus/`，升级不影响任何数据。

### 6. 常见问题

| 问题 | 解决 |
|------|------|
| `nexus: command not found` | `~/.bun/bin`（Windows: `%USERPROFILE%\.bun\bin`）不在 PATH，见步骤 0 |
| 启动报 `bun: command not found` | Bun 未安装，见步骤 0 |
| Windows 报 `spawn bun ENOENT` | npm 装 bun 的可执行文件不在 PATH，见步骤 0 的 Windows 说明 |
| 401 "Invalid token" | Token 加了 `sk-` 前缀，去掉 |
| 403 | Token 失效，联系管理员 |
| 回复很慢 | 高峰期限流，切 `--model electron` |
| `/deep`、`/ralph` 等 OMN 命令没有 | 项目根 `.nexus/skills/` 缺失，重新 clone |

---

## 📁 项目结构

```
src/                        # 核心源码
├── services/api/provider/  # Provider 抽象层（types/errors/adapters）
├── tools/                  # 53 个工具（Bash/FileEdit/Agent/MCP...）
├── commands/               # 斜杠命令（含 /nexus-config）
├── services/               # API / MCP / analytics
├── components/             # 终端 UI 组件（React + Ink）
├── skills/                 # OMN 技能（37 个）
├── agents/                 # OMN 专业代理（20 个）
└── ...
bin/nexus.cjs               # 启动器（配置隔离 + 环境桥接）
.nexus/                     # OMN 技能/代理定义
.github/                    # CI/CD（5 门禁 + release 自动化）
```

---

## 📊 关键数据

| 指标 | 值 |
|------|-----|
| 运行时 | Bun 1.3.14, TypeScript ESM |
| AI SDK | ai@7.0.58 + @ai-sdk/anthropic@4.0.36 + @ai-sdk/openai-compatible@3.0.27 |
| SDK import | 118 → 1 文件 |
| 单元测试 | 92 |
| typecheck 基线 | 708 签名（只拦新增） |
| OMN 技能 / 代理 | 37 / 20 |
| 分支保护 | 5 checks required |
