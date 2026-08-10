// release 版本一致性校验 — tag (vX.Y.Z) 与 package.json version 必须匹配。
//
// 用法（由 release.yml 调用, 也可本地调试）:
//   bun run .github/scripts/check-version.ts [tagName]
//
// 规则:
//   - tag 形如 v0.1.0 / v0.2.0-rc.1; 剥掉 v 前缀后与 package.json version 严格比较
//   - 带 -dryrun / -test 后缀的 tag（本地排练用）先剥离后缀再比较, 供 dry-run 演练
//   - 缺参时从 GITHUB_REF (refs/tags/v*) 读取
//   - 不匹配 → exit 1（中断 release 流程）
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '../..')

function getTag(): string {
  const arg = process.argv[2]
  if (arg) return arg
  const ref = process.env.GITHUB_REF ?? ''
  const m = ref.match(/^refs\/tags\/(.+)$/)
  if (!m) {
    console.error('无法确定 tag: 未传参且 GITHUB_REF 不是 refs/tags/*')
    process.exit(2)
  }
  return m[1]!
}

function normalize(tag: string): string {
  let t = tag.startsWith('v') ? tag.slice(1) : tag
  // dry-run 排练 tag 剥离后缀: v0.1.0-dryrun → 0.1.0
  t = t.replace(/-(dryrun|test|debug).*$/i, '')
  return t
}

const tag = getTag()
const tagVersion = normalize(tag)
const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')) as {
  version: string
}

if (tagVersion === pkg.version) {
  console.log(`✓ 版本一致: tag ${tag} → ${pkg.version}`)
  process.exit(0)
}
console.error(
  `✗ 版本不一致: tag ${tag} (归一化 ${tagVersion}) ≠ package.json ${pkg.version}`,
)
console.error('发布前先 bump package.json 版本并提交, 再打对应 tag')
process.exit(1)
