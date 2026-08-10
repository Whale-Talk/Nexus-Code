// typecheck 错误签名基线 — 只拦截新增 (文件, 错误码) 组合。
//
// 背景: 还原版代码库存在 ~700 个存量类型错误（TS2339/2345/2307 等），
// "tsc 全绿"不成立。本脚本与 audit-baseline 同模式: 存量错误记录在案,
// 只拦截新增签名, 修复存量错误不视为失败。
//
// 用法:
//   bun run .github/scripts/typecheck-baseline.ts                # 检查: 新增签名 → exit 1
//   bun run .github/scripts/typecheck-baseline.ts --update-baseline  # 刷新基线
//
// 规则:
//   - 签名 = (相对路径, 错误码), 忽略行号/列号/数量 → 连锁错误不误报
//   - node_modules/ 下错误排除（依赖包内, 非项目代码, 改不了）
//   - 基线缺失或形状损坏 → exit 2
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const BASELINE_PATH = resolve(REPO_ROOT, '.github/typecheck-baseline.json')
const UPDATE = process.argv.includes('--update-baseline')

// 1. 运行 tsc（--pretty false 保证输出稳定可解析）
let out: string
try {
  out = execSync('bunx tsc --noEmit --pretty false', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString()
} catch (err) {
  // tsc 有错误时 exit 非 0, 输出在 stderr/stdout
  out = (err as { stdout?: Buffer; stderr?: Buffer }).stdout?.toString() ?? ''
  out += (err as { stderr?: Buffer }).stderr?.toString() ?? ''
}

// 2. 解析签名集合
const lineRe = /^(.+?)\(\d+,\d+\): error (TS\d+):/
const sigs = new Set<string>()
for (const line of out.split('\n')) {
  const m = line.match(lineRe)
  if (!m) continue
  const file = m[1]!.replace(/^\.\//, '')
  if (file.startsWith('node_modules/')) continue
  sigs.add(`${file} ${m[2]}`)
}

// 3. 更新模式
if (UPDATE) {
  writeFileSync(BASELINE_PATH, JSON.stringify([...sigs].sort(), null, 2) + '\n')
  console.log(`typecheck 基线已更新: ${sigs.size} 个签名 → ${BASELINE_PATH}`)
  process.exit(0)
}

// 4. 读取并校验基线
if (!existsSync(BASELINE_PATH)) {
  console.error(`基线文件不存在: ${BASELINE_PATH}`)
  console.error('首次运行: bun run .github/scripts/typecheck-baseline.ts --update-baseline')
  process.exit(2)
}
let baseline: unknown
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
} catch {
  console.error('基线文件损坏: 非法 JSON')
  process.exit(2)
}
if (!Array.isArray(baseline) || baseline.some((x) => typeof x !== 'string')) {
  console.error('基线文件损坏: 应为 string 数组')
  process.exit(2)
}

// 5. 对比
const baseSet = new Set(baseline as string[])
const added = [...sigs].filter((s) => !baseSet.has(s))
if (added.length > 0) {
  console.error(`✗ typecheck 拦截: ${added.length} 个新增错误签名`)
  for (const s of added.slice(0, 20)) console.error(`  ${s}`)
  if (added.length > 20) console.error(`  ... 共 ${added.length} 个`)
  console.error('修复这些错误, 或确认后运行 --update-baseline 刷新基线')
  process.exit(1)
}
console.log(`✓ typecheck 通过: ${sigs.size} 个存量签名, 0 新增`)
