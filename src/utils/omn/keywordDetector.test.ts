import { describe, expect, test } from 'bun:test'
import { detectOmnKeywords } from './keywordDetector.js'

describe('detectOmnKeywords — 触发', () => {
  test('ralph 触发', () => {
    const r = detectOmnKeywords('用 ralph 修复这个 bug')
    expect(r.skills.map(s => s.name)).toContain('ralph')
    expect(r.stateActivations).toContain('ralph')
    // ralph 联动 ultrawork
    expect(r.stateActivations).toContain('ultrawork')
  })

  test('autopilot 触发', () => {
    const r = detectOmnKeywords('autopilot 帮我做一个天气应用')
    expect(r.skills.map(s => s.name)).toContain('autopilot')
  })

  test('ultrawork 缩写触发', () => {
    const r = detectOmnKeywords('ulw 全量重构')
    expect(r.skills.map(s => s.name)).toContain('ultrawork')
  })

  test('cancelomc 触发并独占', () => {
    const r = detectOmnKeywords('cancelomc 停止 ralph')
    expect(r.cancelled).toBe(true)
    expect(r.skills).toEqual([])
  })

  test('deep-interview 触发', () => {
    const r = detectOmnKeywords('deep interview 我想讨论需求')
    expect(r.skills.map(s => s.name)).toContain('deep-interview')
  })

  test('tdd 触发为模式消息（非技能）', () => {
    const r = detectOmnKeywords('用 tdd 方式写这个函数')
    expect(r.modeMessages.length).toBeGreaterThan(0)
    expect(r.skills).toEqual([])
  })

  test('ai-slop 清理触发', () => {
    const r = detectOmnKeywords('deslop 清理这个文件')
    expect(r.skills.map(s => s.name)).toContain('ai-slop-cleaner')
  })
})

describe('detectOmnKeywords — 意图过滤（不触发）', () => {
  test('提问不触发', () => {
    const r = detectOmnKeywords('什么是 ralph？它怎么用？')
    expect(r.skills).toEqual([])
    expect(r.stateActivations).toEqual([])
  })

  test('解释性提问不触发', () => {
    const r = detectOmnKeywords('explain how autopilot works')
    expect(r.skills).toEqual([])
  })

  test('诊断性提及不触发', () => {
    const r = detectOmnKeywords('ralph 好像有 bug 一直在循环')
    expect(r.skills).toEqual([])
  })

  test('引号内引用不触发（带追问）', () => {
    const r = detectOmnKeywords('他说 "用 ralph" 是什么意思？')
    expect(r.skills).toEqual([])
  })

  test('多模式引用对比不触发', () => {
    const r = detectOmnKeywords('ralph 和 autopilot 的区别是什么？')
    expect(r.skills).toEqual([])
  })
})

describe('detectOmnKeywords — 回声剥离（不触发）', () => {
  test('粘贴 [RALPH LOOP] 回声块不重新触发', () => {
    const echo = `[RALPH LOOP - ITERATION 3]
Task: 修复鉴权模块
When FULLY complete (after Architect verification)
run /oh-my-claudecode:cancel`
    const r = detectOmnKeywords(echo)
    expect(r.skills).toEqual([])
  })

  test('粘贴 [MAGIC KEYWORD: RALPH] 回声块不重新触发', () => {
    const echo = `[MAGIC KEYWORD: RALPH]

Skill routing detected: ralph`
    const r = detectOmnKeywords(echo)
    expect(r.skills).toEqual([])
  })
})

describe('detectOmnKeywords — 清洗（不误触发）', () => {
  test('代码块中的关键词不触发', () => {
    const r = detectOmnKeywords('看这段代码:\n```\n// ralph\nconst autopilot = true\n```\n帮我解释')
    expect(r.skills).toEqual([])
  })

  test('URL 中的关键词不触发', () => {
    const r = detectOmnKeywords('看 https://example.com/ralph 这个链接')
    expect(r.skills).toEqual([])
  })

  test('文件路径中的关键词不触发', () => {
    const r = detectOmnKeywords('打开 src/skills/ralph/SKILL.md')
    expect(r.skills).toEqual([])
  })

  test('空输入无触发', () => {
    const r = detectOmnKeywords('')
    expect(r.skills).toEqual([])
  })
})

describe('detectOmnKeywords — 激活意图覆盖', () => {
  test('"用 ralph 修" 是激活意图，尽管句子是陈述', () => {
    const r = detectOmnKeywords('请用 ralph 来修这个 500 错误')
    expect(r.skills.map(s => s.name)).toContain('ralph')
  })
})
