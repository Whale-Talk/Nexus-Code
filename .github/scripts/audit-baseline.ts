// bun audit 漏洞基线 — 只拦截新增的 critical/high 漏洞。
//
// 背景: 仓库有 93 个上游传递漏洞（ajv→fast-uri 等）无法从本项目消除,
// "零漏洞"不成立。本脚本记录存量漏洞, 只拦截新增高危, 漏洞减少视为进步。
//
// 用法:
//   bun run .github/scripts/audit-baseline.ts                     # 检查: 新增高危 → exit 1
//   bun run .github/scripts/audit-baseline.ts --update-baseline   # 刷新基线（CI 中禁止）
//
// 规则:
//   - 键 = (包名, advisory id), severity 一并记录
//   - 新增 critical/high → exit 1; 新增 low/moderate → 警告不失败
//   - 基线缺失/形状损坏 → exit 2
//   - GITHUB_ACTIONS=true 时拒绝 --update-baseline（防 CI 误刷新基线）
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const BASELINE_PATH = resolve(REPO_ROOT, '.github/baseline-audit.json')
const UPDATE = process.argv.includes('--update-baseline')

if (UPDATE && process.env.GITHUB_ACTIONS === 'true') {
  console.error('CI 中禁止刷新审计基线 — 基线刷新须走 PR review')
  process.exit(2)
}

// 1. 运行 bun audit --json（有漏洞时 exit 非 0, 输出在 stdout）
let out: string
try {
  out = execSync('bun audit --json', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString()
} catch (err) {
  out = (err as { stdout?: Buffer }).stdout?.toString() ?? ''
  if (!out.trim()) throw err
}

// 2. 解析 (包名, advisory id, severity)
type Adv = { pkg: string; adv: number; severity: string }
let data: unknown
try {
  data = JSON.parse(out)
} catch {
  console.error('bun audit --json 输出不是合法 JSON（bun 版本升级可能改变格式）')
  process.exit(2)
}
if (typeof data !== 'object' || data === null || Array.isArray(data)) {
  console.error('bun audit --json 输出形状异常: 顶层应为 { 包名: [advisory...] }')
  process.exit(2)
}
const current: Adv[] = []
for (const [pkg, advs] of Object.entries(data as Record<string, unknown>)) {
  if (!Array.isArray(advs)) continue
  for (const a of advs) {
    if (typeof a !== 'object' || a === null) continue
    const adv = (a as Record<string, unknown>).id
    const severity = (a as Record<string, unknown>).severity
    if (typeof adv === 'number' && typeof severity === 'string') {
      current.push({ pkg, adv, severity })
    }
  }
}
current.sort((x, y) => (x.pkg + x.adv).localeCompare(y.pkg + y.adv))

// 3. 更新模式
if (UPDATE) {
  writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + '\n')
  const high = current.filter((a) => a.severity === 'critical' || a.severity === 'high').length
  console.log(`审计基线已更新: ${current.length} 条记录 (critical/high: ${high}) → ${BASELINE_PATH}`)
  process.exit(0)
}

// 4. 读取并校验基线
if (!existsSync(BASELINE_PATH)) {
  console.error(`基线文件不存在: ${BASELINE_PATH}`)
  console.error('首次运行: bun run .github/scripts/audit-baseline.ts --update-baseline')
  process.exit(2)
}
let baseline: unknown
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
} catch {
  console.error('基线文件损坏: 非法 JSON')
  process.exit(2)
}
if (
  !Array.isArray(baseline) ||
  baseline.some(
    (x) =>
      typeof x !== 'object' || x === null ||
      typeof (x as { pkg?: unknown }).pkg !== 'string' ||
      typeof (x as { adv?: unknown }).adv !== 'number' ||
      typeof (x as { severity?: unknown }).severity !== 'string',
  )
) {
  console.error('基线文件损坏: 应为 [{pkg, adv, severity}, ...]')
  process.exit(2)
}
const baseMap = new Map<string, string>()
for (const b of baseline as Array<{ pkg: string; adv: number; severity: string }>) {
  baseMap.set(`${b.pkg}::${b.adv}`, b.severity)
}

// 5. 对比
const added = current.filter((a) => !baseMap.has(`${a.pkg}::${a.adv}`))
const addedHigh = added.filter((a) => a.severity === 'critical' || a.severity === 'high')
const addedLow = added.filter((a) => a.severity !== 'critical' && a.severity !== 'high')

if (addedHigh.length > 0) {
  console.error(`✗ 审计拦截: ${addedHigh.length} 个新增 critical/high 漏洞`)
  for (const a of addedHigh.slice(0, 20)) console.error(`  ${a.pkg} (${a.severity}) advisory ${a.adv}`)
  if (addedHigh.length > 20) console.error(`  ... 共 ${addedHigh.length} 个`)
  console.error('升级依赖修复, 或确认后运行 --update-baseline 刷新基线（需 PR review）')
  process.exit(1)
}
for (const a of addedLow) {
  console.warn(`  ! 新增低危漏洞(不拦截): ${a.pkg} (${a.severity}) advisory ${a.adv}`)
}
const removed = [...baseMap.keys()].filter((k) => !current.some((a) => `${a.pkg}::${a.adv}` === k)).length
console.log(
  `✓ 审计通过: ${current.length} 条记录, 0 新增高危${removed > 0 ? `, 已修复 ${removed} 条(未计入基线, 建议 --update-baseline)` : ''}`,
)
