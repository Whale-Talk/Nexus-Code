import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

const root = resolve(import.meta.dir, '../..')
const failures: string[] = []
for (const area of ['src', 'bin', 'scripts', 'shims']) {
  const pattern = new Bun.Glob('**/*.{ts,tsx,js,jsx,cjs,mjs}')
  for (const relative of pattern.scanSync(resolve(root, area))) {
    const path = area + '/' + relative.replaceAll('\\', '/')
    if (/\.(test|spec)\.[^.]+$/.test(path) || path === 'scripts/upgrade-profile.cjs') continue
    const source = ts.createSourceFile(path, readFileSync(resolve(root, path), 'utf8'), ts.ScriptTarget.Latest, true)
    function visit(node: ts.Node) {
      // Literal protocol headers, third-party package IDs and historical attributions are external data.
      const invalidName = ts.isIdentifier(node) && /claude|anthropic|(?<!oct)opus|sonnet|haiku/i.test(node.text)
      const oldInternalKey = ts.isStringLiteralLike(node) &&
        /^(?:CLAUDE(?:_CODE)?_[A-Z0-9_]+|ANTHROPIC_[A-Z0-9_]+|(?:opus|sonnet|haiku)(?:plan|\[1m\])?)$/.test(node.text)
      if (invalidName || oldInternalKey) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
        failures.push(`${path}:${line + 1} ${node.getText(source)}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
}
if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('Nexus native runtime names verified')
