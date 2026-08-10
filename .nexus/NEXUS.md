# Nexus OMC — 多 Agent 编排

Nexus 内置 oh-my-claudecode（OMC）多 Agent 编排层。技能和代理定义在本目录的 `skills/` 和 `agents/` 中。

## 核心原则

- 委派专业工作给最合适的 agent（executor / architect / critic / explore）
- 优先证据而非假设：最终声明前先验证结果
- 选择最轻量的路径同时保证质量
- 关键决策前先探索再计划

## 技能调用

通过 `/oh-my-claudecode:<name>` 调用，或关键词自动触发：

| 关键词 | 技能 | 用途 |
|--------|------|------|
| `ralph` | ralph | PRD 驱动的持久执行循环，直到所有验收标准通过 |
| `team` | team | N 个协调 Agent 并行执行共享任务 |
| `autopilot` | autopilot | 从想法到代码的全自主流程 |
| `ralplan` | ralplan | 共识规划（Planner/Architect/Critic 循环）|
| `deep interview` | deep-interview | Socratic 需求澄清（数学化模糊度评分）|
| `ultrawork` | ultrawork | 高吞吐并行执行引擎 |
| `ulw` | ultrawork | 同上缩写 |
| `ccg` | ccg | Claude/Codex/Gemini 三模型编排 |
| `deep-analyze` | analysis mode | 深度分析模式 |
| `tdd` | TDD mode | 测试驱动开发模式 |
| `cancel` / `cancelomc` | cancel | 取消活动执行模式 |

## Agent 目录

`agents/` 下定义 20 个专业代理（executor、architect、critic、explore、debugger、security-reviewer、test-engineer 等）。通过 Task 工具按 `subagent_type` 调用。

## 验证要求

- 完成前验证：小改动 → haiku；标准 → sonnet；大/安全 → opus
- 验证失败则继续迭代，不停止
- 作者和审查分离：writer 创建内容，reviewer/verifier 单独审查
- 结束前：零待办任务、测试通过、验证器证据已收集

## 执行协议

- 广泛请求：先探索，再计划
- 2+ 独立任务并行执行（run_in_background）
- 构建/测试用后台运行
- 危险操作（git push、删除、生产变更）需明确确认

## 取消

`/oh-my-claudecode:cancel` 结束执行模式。完成并验证后取消；工作未完成不取消。
