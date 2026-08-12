/**
 * OMN (Oh My Nexus) — 原生 keyword 触发器。
 *
 * 从官方 oh-my-claudecode 的 keyword-detector hook 全量移植，
 * 适配为 Nexus 原生模块：不再依赖外部插件 hooks，直接在
 * processUserInput 流程内检测关键词并引导技能调用。
 *
 * 核心语义（与官方一致）：
 * - 清洗：剥离代码块/URL/路径/XML/角色回声/diff，防误触发
 * - 意图过滤：提问/引用/诊断性提及不触发（"什么是 ralph" 不启动 ralph）
 * - 回声剥离：粘贴历史 [RALPH LOOP] 等系统输出不会重新触发模式
 * - 状态激活：ralph/autopilot/ultrawork/ralplan 命中时写 .omc/state/
 */

export type OmnModeName =
  | 'cancel'
  | 'ralph'
  | 'autopilot'
  | 'ultrawork'
  | 'ccg'
  | 'ralplan'
  | 'deep-interview'
  | 'ai-slop-cleaner'
  | 'tdd'
  | 'code-review'
  | 'security-review'
  | 'ultrathink'
  | 'deepsearch'
  | 'analyze'

/** 需写 .omc/state 状态文件的模式（与 state.ts 的 OmnStateName 一致） */
export type OmnStateMode = 'ralph' | 'autopilot' | 'ultrawork' | 'ralplan'

export type SkillMatch = { name: OmnModeName; args: string }

export type OmnDetectionResult = {
  /** 需写状态文件的模式（按优先级排序） */
  stateActivations: OmnStateMode[]
  /** 直接注入上下文的模式消息（ultrathink/tdd/deepsearch 等） */
  modeMessages: string[]
  /** 最终要引导的技能（已 resolveConflicts） */
  skills: SkillMatch[]
  /** cancel 命中时为 true（清理状态后无技能引导） */
  cancelled: boolean
}

const INFORMATIONAL_CONTEXT_WINDOW = 80

const INFORMATIONAL_INTENT_PATTERNS = [
  /\b(?:what(?:'s|\s+is)|what\s+are|how\s+(?:to|do\s+i)\s+use|explain|explanation|tell\s+me\s+about|describe)\b/i,
  /(?:什么是|什麼是|怎(?:么|樣)用|如何使用|解释|說明|说明)/u,
]

const QUOTED_SPAN_PATTERN =
  /"[^"\n]{1,400}"|'[^'\n]{1,400}'|“[^”\n]{1,400}”|‘[^’\n]{1,400}’/g

const REFERENCE_META_PATTERNS = [
  /\b(?:vs\.?|versus|compared\s+to|comparison|compare|article|blog\s+post|documentation|docs?|reference)\b/i,
  /\b(?:this\s+(?:article|comparison|guide|documentation|doc)|quoted|quote(?:d)?)\b/i,
  /(?:区别|比较|对比|差异)/u,
]

const REFERENCE_EXPLANATION_PATTERNS = [
  /\b(?:summary|conclusion|key\s+points?|example|examples|pros|cons|overview)\s*:/i,
  /[^\n]{1,80}=\s*["“]/,
  /[→⇒]/,
]

const QUESTION_FOLLOWUP_PATTERNS = [
  /\b(?:how\s+many|how\s+much|why|what\s+happened|what\s+went\s+wrong|token\s+budget|cost|pricing)\b/i,
  /(?:为什么|為何|是什么意思|是什麼意思|怎么回事|怎麼回事|怎么识别|怎麼識別|多少|区别|區別)/u,
]

// 系统回声块（persistent-mode / keyword-detector 自身输出）——
// 粘贴这些块不应重新触发模式（防自我强化循环）
const ECHO_CONTINUATION =
  '(?:\\r?\\n[ \\t]*(?:Task:\\s|When FULLY complete \\(after Architect verification\\)|run\\s+\\/oh-my-claudecode:cancel).*)*'

function buildEchoBlockRegex(headerBody: string): RegExp {
  return new RegExp(`^[ \\t]*${headerBody}.*${ECHO_CONTINUATION}$`, 'gim')
}

const SYSTEM_ECHO_BLOCK_PATTERNS = [
  buildEchoBlockRegex('\\[RALPH LOOP\\s*-\\s*ITERATION[^\\]\\n]*\\]'),
  buildEchoBlockRegex('\\[RALPH LOOP\\s*-\\s*(?:HARD LIMIT|EXTENDED)\\]'),
  buildEchoBlockRegex('\\[TEAM\\s*-\\s*Phase:[^\\]\\n]*\\]'),
  buildEchoBlockRegex('\\[AUTOPILOT[^\\]\\n]*\\]'),
  buildEchoBlockRegex('\\[ULTRAPILOT[^\\]\\n]*\\]'),
  buildEchoBlockRegex('\\[ULTRAWORK[^\\]\\n]*\\]'),
  buildEchoBlockRegex('\\[ULTRAQA[^\\]\\n]*\\]'),
  buildEchoBlockRegex('\\[PIPELINE[^\\]\\n]*\\]'),
  buildEchoBlockRegex('\\[SWARM[^\\]\\n]*\\]'),
  buildEchoBlockRegex('\\[TOOL ERROR[^\\]\\n]*\\]'),
  buildEchoBlockRegex('\\[MAGIC KEYWORD:[^\\]\\n]*\\]'),
  buildEchoBlockRegex('\\[MAGIC KEYWORDS DETECTED:[^\\]\\n]*\\]'),
  buildEchoBlockRegex('Stop hook (?:blocking error|feedback|stopped continuation)'),
  buildEchoBlockRegex('PreToolUse:[^\\n]*hook additional context:'),
  buildEchoBlockRegex('PostToolUse:[^\\n]*hook additional context:'),
]

const SYSTEM_ECHO_SIGNATURES = [
  /\bWhen FULLY complete \(after Architect verification\)\b/i,
  /\brun\s+\/oh-my-claudecode:cancel\b/i,
  /\[RALPH LOOP\s*-\s*ITERATION\b/i,
]

const MODE_REFERENCE_PATTERN =
  /\b(?:ralph|autopilot|auto[\s-]?pilot|ultrawork|ulw|ralplan|ultrathink|deepsearch|deep[\s-]?analyze|deepanalyze|deep[\s-]interview|ouroboros|ccg|claude-codex-gemini|deerflow)\b/gi

const ANTI_SLOP_EXPLICIT_PATTERN = /\b(ai[\s-]?slop|anti[\s-]?slop|deslop|de[\s-]?slop)\b/i
const ANTI_SLOP_ACTION_PATTERN = /\b(clean(?:\s*up)?|cleanup|refactor|simplify|dedupe|de-duplicate|prune)\b/i
const ANTI_SLOP_SMELL_PATTERN = /\b(slop|duplicate(?:d|s)?|duplication|dead\s+code|unused\s+code|over[\s-]?abstract(?:ion|ed)?|wrapper\s+layers?|boundary\s+violations?|needless\s+abstractions?|unnecessary\s+abstractions?|ai[\s-]?generated|generated\s+code|tech\s+debt)\b/i

function isAntiSlopCleanupRequest(text: string): boolean {
  return (
    ANTI_SLOP_EXPLICIT_PATTERN.test(text) ||
    (ANTI_SLOP_ACTION_PATTERN.test(text) && ANTI_SLOP_SMELL_PATTERN.test(text))
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripSystemEchoes(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return ''
  let cleaned = text
  for (const pattern of SYSTEM_ECHO_BLOCK_PATTERNS) {
    cleaned = cleaned.replace(pattern, ' ')
  }
  return cleaned
}

function looksLikeSystemEcho(text: string): boolean {
  if (typeof text !== 'string' || text.length === 0) return false
  if (SYSTEM_ECHO_SIGNATURES.some(p => p.test(text))) return true
  for (const pattern of SYSTEM_ECHO_BLOCK_PATTERNS) {
    const probe = new RegExp(pattern.source, pattern.flags.replace('g', ''))
    if (probe.test(text)) return true
  }
  return false
}

/**
 * 剥离粘贴的系统回声块（官方 stripPastedCommandPayloads 移植）。
 * 覆盖三类回声：MAGIC KEYWORD 头块、角色边界块（<user>/<assistant>）、
 * git diff 块、shell 转录行。这些内容里出现的关键词不应重新触发模式。
 */
const PASTED_MAGIC_KEYWORD_HEADER_PATTERN = /^\s*\[MAGIC KEYWORDS?(?: DETECTED)?:.*$/i
const ROLE_BOUNDARY_PATTERN =
  /^<\s*\/?\s*(system|human|assistant|user|tool_use|tool_result)\b[^>]*>/i
const SKILL_TRANSCRIPT_LINE_PATTERN = /^\s*Skill:\s+oh-my-(?:claudecode|codex):/i
const USER_REQUEST_LINE_PATTERN = /^\s*User request(?:\s*\([^)]*\))?:\s*$/i
const SHELL_TRANSCRIPT_LINE_PATTERN = /^\s*[$%❯]\s+/
const GIT_DIFF_START_PATTERNS = [
  /^diff\s+--git\s+a\//,
  /^index\s+[0-9a-f]+\.\.[0-9a-f]+(?:\s+\d+)?$/i,
  /^(?:---|\+\+\+)\s+[ab]\//,
  /^@@\s+-\d+/,
]
const GIT_DIFF_CONTINUATION_PATTERNS = [
  /^new file mode\s+\d+$/i,
  /^deleted file mode\s+\d+$/i,
  /^similarity index\s+\d+%$/i,
  /^rename (?:from|to)\s+/i,
  /^Binary files .+ differ$/i,
  /^(?:diff\s+--git\s+a\/|index\s+[0-9a-f]+\.\.[0-9a-f]+|(?:---|\+\+\+)\s+[ab]\/|@@\s+-\d+)/i,
  /^[ +\-].*/,
]

function stripPastedCommandPayloads(text: string): string {
  const lines = text.split('\n')
  const sanitized: string[] = []
  let insideRoleBlock = false
  let insideDiffBlock = false
  let insideMagicKeywordBlock = false
  let magicBlockSawUserRequest = false
  let magicBlockSawRequestPayload = false
  let previousLineWasUserRequest = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (insideMagicKeywordBlock) {
      if (ROLE_BOUNDARY_PATTERN.test(trimmed)) {
        insideRoleBlock = !/^<\s*\//.test(trimmed)
        insideMagicKeywordBlock = false
        magicBlockSawUserRequest = false
        magicBlockSawRequestPayload = false
        continue
      }
      if (USER_REQUEST_LINE_PATTERN.test(line)) {
        magicBlockSawUserRequest = true
        magicBlockSawRequestPayload = false
        continue
      }
      if (magicBlockSawUserRequest) {
        if (trimmed) {
          magicBlockSawRequestPayload = true
          continue
        }
        if (magicBlockSawRequestPayload) {
          insideMagicKeywordBlock = false
          magicBlockSawUserRequest = false
          magicBlockSawRequestPayload = false
          sanitized.push(line)
          continue
        }
      }
      continue
    }

    if (PASTED_MAGIC_KEYWORD_HEADER_PATTERN.test(line)) {
      insideMagicKeywordBlock = true
      magicBlockSawUserRequest = false
      magicBlockSawRequestPayload = false
      continue
    }

    if (ROLE_BOUNDARY_PATTERN.test(trimmed)) {
      insideRoleBlock = !/^<\s*\//.test(trimmed)
      continue
    }

    if (insideRoleBlock) continue

    if (!trimmed) {
      sanitized.push(line)
      insideDiffBlock = false
      previousLineWasUserRequest = false
      continue
    }

    if (previousLineWasUserRequest) {
      previousLineWasUserRequest = false
      continue
    }

    if (USER_REQUEST_LINE_PATTERN.test(line) || SKILL_TRANSCRIPT_LINE_PATTERN.test(line)) {
      previousLineWasUserRequest = USER_REQUEST_LINE_PATTERN.test(line)
      continue
    }

    if (SHELL_TRANSCRIPT_LINE_PATTERN.test(line) && !/^\s*\$\w/.test(line)) {
      continue
    }

    if (insideDiffBlock) {
      if (GIT_DIFF_CONTINUATION_PATTERNS.some(p => p.test(trimmed))) {
        continue
      }
      insideDiffBlock = false
    }

    if (GIT_DIFF_START_PATTERNS.some(p => p.test(trimmed))) {
      insideDiffBlock = true
      continue
    }

    sanitized.push(line)
  }

  return sanitized.join('\n')
}

/**
 * 关键词检测前的清洗：剥离代码块、URL、文件路径、XML 标签、引用行等，
 * 防止代码/路径/粘贴内容中的关键词造成误触发。
 */
function sanitizeForKeywordDetection(text: string): string {
  return (
    stripPastedCommandPayloads(text)
      // HTML/markdown 注释
      .replace(/<!--[\s\S]*?-->/g, '')
      // XML 标签块（成对）
      .replace(/<(\w[\w-]*)[\s>][\s\S]*?<\/\1>/g, '')
      // 自闭合 XML 标签
      .replace(/<\w[\w-]*(?:\s[^>]*)?\s*\/>/g, '')
      // URL
      .replace(/https?:\/\/[^\s)>\]]+/g, '')
      // 引用行与 markdown 表格
      .replace(/^\s*>\s.*$/gm, '')
      .replace(/^\s*\|(?:[^|\n]*\|){2,}\s*$/gm, '')
      .replace(/^\s*\|?(?:\s*:?-{3,}:?\s*\|){1,}\s*$/gm, '')
      // 文件路径
      .replace(/(?<=^|[\s"'`(])(?:\/)?(?:[\w.-]+\/)+[\w.-]+/gm, '')
      // 代码块 + 行内代码
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`]+`/g, '')
  )
}

function stripQuotedSpans(text: string): string {
  return text.replace(QUOTED_SPAN_PATTERN, ' ')
}

function countDistinctModeReferences(text: string): number {
  const matches = text.match(MODE_REFERENCE_PATTERN) ?? []
  const normalized = new Set(
    matches.map(m => m.toLowerCase().replace(/\s+/g, '').replace(/-/g, '')),
  )
  return normalized.size
}

function isWithinQuotedSpan(text: string, position: number): boolean {
  for (const match of text.matchAll(QUOTED_SPAN_PATTERN)) {
    if (match.index === undefined) continue
    if (position >= match.index && position < match.index + match[0].length) {
      return true
    }
  }
  return false
}

function getLineBounds(text: string, position: number): { start: number; end: number } {
  const start = text.lastIndexOf('\n', Math.max(0, position - 1)) + 1
  const nextNewline = text.indexOf('\n', position)
  const end = nextNewline === -1 ? text.length : nextNewline
  return { start, end }
}

function looksLikeReferenceContent(text: string): boolean {
  const hasReferenceMeta = REFERENCE_META_PATTERNS.some(p => p.test(text))
  const hasExplanationShape = REFERENCE_EXPLANATION_PATTERNS.some(p => p.test(text))
  const hasAnyModeMention = countDistinctModeReferences(text) >= 1
  const hasMultipleModeMentions = countDistinctModeReferences(text) >= 2
  const hasQuestionOutsideQuotes = QUESTION_FOLLOWUP_PATTERNS.some(p =>
    p.test(stripQuotedSpans(text)),
  )
  return (
    (hasReferenceMeta &&
      (hasExplanationShape || hasAnyModeMention || hasQuestionOutsideQuotes)) ||
    (hasExplanationShape && (hasMultipleModeMentions || hasQuestionOutsideQuotes)) ||
    (hasMultipleModeMentions && hasQuestionOutsideQuotes)
  )
}

function hasActivationIntentNearKeyword(context: string, keyword: string): boolean {
  const escaped = escapeRegExp(keyword.trim())
  if (!escaped) return false
  const patterns = [
    new RegExp(
      `\\b(?:use|run|start|enable|activate|invoke|trigger|launch)\\b[^\\n]{0,28}\\b${escaped}\\b`,
      'i',
    ),
    new RegExp(
      `\\b(?:fix|debug|investigate|resolve|handle|patch|address)\\b[^\\n]{0,28}\\b(?:issue|bug|problem|error)\\b[^\\n]{0,12}\\b(?:with|in)\\s+\\b${escaped}\\b`,
      'i',
    ),
  ]
  return patterns.some(p => p.test(context))
}

function hasDiagnosticIntentNearKeyword(context: string, keyword: string): boolean {
  const escaped = escapeRegExp(keyword.trim())
  if (!escaped) return false
  const patterns = [
    new RegExp(
      `\\b${escaped}\\b[^\\n]{0,48}\\b(?:keeps?\\s+(?:looping|re-?running)|has\\s+(?:a\\s+)?(?:bug|issue|problem|error)|is\\s+(?:stuck|broken|failing)|loop(?:ing)?)\\b`,
      'i',
    ),
    new RegExp(
      `\\b(?:bug|issue|problem|error)\\b[^\\n]{0,16}\\b(?:with|in)\\s+\\b${escaped}\\b`,
      'i',
    ),
    // 中文/韩文诊断：keyword 后跟 "有 bug/问题/卡住/一直循环" 等
    new RegExp(
      `${escaped}[^\\n]{0,20}(?:好像|似乎|一直|总是|老是|经常)[^\\n]{0,20}(?:有(?:个)?(?:bug|问题|错误)|出错|失败|卡住|循环|反复|重复)`,
      'u',
    ),
    new RegExp(
      `${escaped}[^\\n]{0,20}(?:有(?:个)?(?:bug|问题|错误)|出错|失败|卡住|循环|反复)`,
      'u',
    ),
  ]
  return patterns.some(p => p.test(context))
}

function isInformationalKeywordContext(
  text: string,
  position: number,
  keywordLength: number,
  keywordText: string,
): boolean {
  const start = Math.max(0, position - INFORMATIONAL_CONTEXT_WINDOW)
  const end = Math.min(text.length, position + keywordLength + INFORMATIONAL_CONTEXT_WINDOW)
  const context = text.slice(start, end)
  const lineBounds = getLineBounds(text, position)
  const line = text.slice(lineBounds.start, lineBounds.end)
  const questionOutsideQuotes = stripQuotedSpans(text)
  const keywordInsideQuotes = isWithinQuotedSpan(text, position)

  if (keywordText) {
    // 明确的激活意图（"用 ralph 修这个"）→ 不视为信息性提问
    if (hasActivationIntentNearKeyword(context, keywordText)) return false
    // 诊断性提及（"ralph 一直在循环"）→ 视为提问，不触发
    if (hasDiagnosticIntentNearKeyword(context, keywordText)) return true
  }

  if (/^\s*>\s/.test(line) || /^\s*\|(?:[^|\n]*\|){2,}\s*$/.test(line)) {
    return true
  }

  if (
    keywordInsideQuotes &&
    QUESTION_FOLLOWUP_PATTERNS.some(p => p.test(questionOutsideQuotes))
  ) {
    return true
  }

  if (looksLikeReferenceContent(text)) return true

  return INFORMATIONAL_INTENT_PATTERNS.some(p => p.test(context))
}

function hasActionableKeyword(text: string, pattern: RegExp): boolean {
  const searchText = looksLikeSystemEcho(text) ? stripSystemEchoes(text) : text
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  const globalPattern = new RegExp(pattern.source, flags)
  for (const match of searchText.matchAll(globalPattern)) {
    if (match.index === undefined) continue
    if (
      isInformationalKeywordContext(
        searchText,
        match.index,
        match[0].length,
        match[0],
      )
    ) {
      continue
    }
    return true
  }
  return false
}

// ralplan 需要显式调用语境（避免文档/提及误触发），比通用关键词更严格
function hasActionableRalplanKeyword(text: string, pattern: RegExp): boolean {
  const searchText = looksLikeSystemEcho(text) ? stripSystemEchoes(text) : text
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  const globalPattern = new RegExp(pattern.source, flags)
  for (const match of searchText.matchAll(globalPattern)) {
    if (match.index === undefined) continue
    if (
      isInformationalKeywordContext(
        searchText,
        match.index,
        match[0].length,
        match[0],
      )
    ) {
      continue
    }
    // 显式调用语境：行首直接调用（$ / ! 或 "force:"）或邻近激活意图词
    const prefix = searchText.slice(0, match.index)
    const directPrefix = /^\s*(?:[$/!]\s*|force:\s*|oh-my-(?:claudecode|codex):\s*)?$/i.test(prefix)
    if (directPrefix) return true
    const start = Math.max(0, match.index - INFORMATIONAL_CONTEXT_WINDOW)
    const end = Math.min(
      searchText.length,
      match.index + match[0].length + INFORMATIONAL_CONTEXT_WINDOW,
    )
    if (hasActivationIntentNearKeyword(searchText.slice(start, end), match[0])) {
      return true
    }
    continue
  }
  return false
}

// 模式消息关键词（ultrathink/tdd 等）：命中后直接注入上下文消息，不引导技能调用
const ULTRATHINK_MESSAGE = `<think-mode>

**ULTRATHINK MODE ENABLED** - Extended reasoning activated.

You are now in deep thinking mode. Take your time to:
1. Thoroughly analyze the problem from multiple angles
2. Consider edge cases and potential issues
3. Think through the implications of each approach
4. Reason step-by-step before acting

Use your extended thinking capabilities to provide the most thorough and well-reasoned response.

</think-mode>

---
`

const SEARCH_MESSAGE = `<search-mode>
MAXIMIZE SEARCH EFFORT. Launch multiple background agents IN PARALLEL:
- explore agents (codebase patterns, file structures)
- document-specialist agents (remote repos, official docs, GitHub examples)
Plus direct tools: Grep, Glob
NEVER stop at first result - be exhaustive.
</search-mode>

---
`

const ANALYZE_MESSAGE = `<analyze-mode>
ANALYSIS MODE. Gather context before diving deep:
- Search relevant code paths first
- Compare working vs broken behavior
- Synthesize findings before proposing changes
</analyze-mode>

---
`

const TDD_MESSAGE = `<tdd-mode>
[TDD MODE ACTIVATED]
Write or update tests first when practical, confirm they fail for the right reason, then implement the minimal fix and re-run verification.
</tdd-mode>

---
`

const CODE_REVIEW_MESSAGE = `<code-review-mode>
[CODE REVIEW MODE ACTIVATED]
Perform a comprehensive code review of the relevant changes or target area. Focus on correctness, maintainability, edge cases, regressions, and test adequacy before recommending changes.
</code-review-mode>

---
`

const SECURITY_REVIEW_MESSAGE = `<security-review-mode>
[SECURITY REVIEW MODE ACTIVATED]
Perform a focused security review of the relevant changes or target area. Check trust boundaries, auth/authz, data exposure, input validation, command/file access, secrets handling, and escalation risks before recommending changes.
</security-review-mode>

---
`

const MODE_MESSAGE_KEYWORDS: ReadonlyMap<OmnModeName, string> = new Map([
  ['ultrathink', ULTRATHINK_MESSAGE],
  ['deepsearch', SEARCH_MESSAGE],
  ['analyze', ANALYZE_MESSAGE],
  ['tdd', TDD_MESSAGE],
  ['code-review', CODE_REVIEW_MESSAGE],
  ['security-review', SECURITY_REVIEW_MESSAGE],
])

const PRIORITY_ORDER: readonly OmnModeName[] = [
  'cancel',
  'ralph',
  'autopilot',
  'ultrawork',
  'ccg',
  'ralplan',
  'deep-interview',
  'ai-slop-cleaner',
  'tdd',
  'code-review',
  'security-review',
  'ultrathink',
  'deepsearch',
  'analyze',
]

/** cancel 独占；其余按优先级排序（与官方 resolveConflicts 一致） */
function resolveConflicts(matches: SkillMatch[]): SkillMatch[] {
  const names = matches.map(m => m.name)
  if (names.includes('cancel')) {
    const cancelMatch = matches.find(m => m.name === 'cancel')!
    return [cancelMatch]
  }
  const resolved = [...matches]
  resolved.sort((a, b) => PRIORITY_ORDER.indexOf(a.name) - PRIORITY_ORDER.indexOf(b.name))
  return resolved
}

const REVIEW_SEED_OUTCOME_RES = [
  /\bapprove\b/i,
  /\brequest[- ]changes\b/i,
  /\bmerge[- ]ready\b/i,
  /\bblocked\b/i,
]

/** 注入的评审指令回声（approve/request-changes 菜单）不是真实评审意图 */
function isReviewSeedContext(text: string): boolean {
  const preview = text.split('\n').slice(0, 20).join('\n')
  return REVIEW_SEED_OUTCOME_RES.filter(re => re.test(preview)).length >= 2
}

/**
 * OMN 关键词检测主入口。
 *
 * @param rawPrompt 用户输入（未清洗）
 * @returns 检测结果；无命中时 skills/modeMessages/stateActivations 均为空
 */
export function detectOmnKeywords(rawPrompt: string): OmnDetectionResult {
  if (!rawPrompt || rawPrompt.trim() === '') {
    return { stateActivations: [], modeMessages: [], skills: [], cancelled: false }
  }

  // 官方语义：先剥回声，再清洗，再小写匹配
  const cleanPrompt = stripSystemEchoes(
    sanitizeForKeywordDetection(rawPrompt).toLowerCase(),
  )

  const matches: SkillMatch[] = []

  // Cancel
  if (hasActionableKeyword(cleanPrompt, /\b(cancelomc|stopomc)\b/i)) {
    matches.push({ name: 'cancel', args: '' })
  }

  // Ralph
  if (
    hasActionableKeyword(
      cleanPrompt,
      /\b(ralph|don't stop|must complete|until done)\b/i,
    )
  ) {
    matches.push({ name: 'ralph', args: '' })
  }

  // Autopilot（"autonomous" 有意排除——技术行文太常见，官方同款决策）
  if (
    hasActionableKeyword(
      cleanPrompt,
      /\b(autopilot|auto pilot|auto-pilot|full auto|fullsend)\b/i,
    ) ||
    hasActionableKeyword(
      cleanPrompt,
      /\b(build|create|make)\s+me\s+(an?\s+)?(app|feature|project|tool|plugin|website|api|server|cli|script|system|service|dashboard|bot|extension)\b/i,
    ) ||
    hasActionableKeyword(cleanPrompt, /\bi\s+want\s+a\s+/i) ||
    hasActionableKeyword(cleanPrompt, /\bi\s+want\s+an\s+/i) ||
    hasActionableKeyword(cleanPrompt, /\bhandle\s+it\s+all\b/i) ||
    hasActionableKeyword(cleanPrompt, /\bend\s+to\s+end\b/i) ||
    hasActionableKeyword(cleanPrompt, /\be2e\s+this\b/i)
  ) {
    matches.push({ name: 'autopilot', args: '' })
  }

  // Ultrawork
  if (hasActionableKeyword(cleanPrompt, /\b(ultrawork|ulw|uw)\b/i)) {
    matches.push({ name: 'ultrawork', args: '' })
  }

  // CCG
  if (hasActionableKeyword(cleanPrompt, /\b(ccg|claude-codex-gemini)\b/i)) {
    matches.push({ name: 'ccg', args: '' })
  }

  // Ralplan（需要显式调用语境）
  if (hasActionableRalplanKeyword(cleanPrompt, /\b(ralplan)\b/i)) {
    matches.push({ name: 'ralplan', args: '' })
  }

  // Deep interview
  if (
    hasActionableKeyword(cleanPrompt, /\b(deep[\s-]interview|ouroboros)\b/i)
  ) {
    matches.push({ name: 'deep-interview', args: '' })
  }

  // AI slop cleanup
  if (isAntiSlopCleanupRequest(cleanPrompt)) {
    matches.push({ name: 'ai-slop-cleaner', args: '' })
  }

  // TDD
  if (
    hasActionableKeyword(cleanPrompt, /\b(tdd)\b/i) ||
    hasActionableKeyword(cleanPrompt, /\btest\s+first\b/i) ||
    hasActionableKeyword(cleanPrompt, /\bred\s+green\b/i)
  ) {
    matches.push({ name: 'tdd', args: '' })
  }

  // Code review（排除评审指令回声）
  if (
    !isReviewSeedContext(cleanPrompt) &&
    hasActionableKeyword(cleanPrompt, /\b(code\s+review|review\s+code)\b/i)
  ) {
    matches.push({ name: 'code-review', args: '' })
  }

  // Security review
  if (
    !isReviewSeedContext(cleanPrompt) &&
    hasActionableKeyword(cleanPrompt, /\b(security\s+review|review\s+security)\b/i)
  ) {
    matches.push({ name: 'security-review', args: '' })
  }

  // Ultrathink
  if (
    hasActionableKeyword(cleanPrompt, /\b(ultrathink|think hard|think deeply)\b/i)
  ) {
    matches.push({ name: 'ultrathink', args: '' })
  }

  // Deepsearch
  if (
    hasActionableKeyword(cleanPrompt, /\b(deepsearch)\b/i) ||
    hasActionableKeyword(
      cleanPrompt,
      /\bsearch\s+(the\s+)?(codebase|code|files?|project)\b/i,
    ) ||
    hasActionableKeyword(cleanPrompt, /\bfind\s+(in\s+)?(codebase|code|all\s+files?)\b/i)
  ) {
    matches.push({ name: 'deepsearch', args: '' })
  }

  // Analyze
  if (hasActionableKeyword(cleanPrompt, /\b(deep[\s-]analyze|analyze\s+deeply)\b/i)) {
    matches.push({ name: 'analyze', args: '' })
  }

  if (matches.length === 0) {
    return { stateActivations: [], modeMessages: [], skills: [], cancelled: false }
  }

  const resolved = resolveConflicts(matches)

  // cancel 清理状态，无技能引导
  if (resolved.length > 0 && resolved[0].name === 'cancel') {
    return { stateActivations: [], modeMessages: [], skills: [], cancelled: true }
  }

  // 需写状态文件的模式（官方语义：ralph/autopilot/ultrawork/ralplan）
  const stateModes: readonly OmnStateMode[] = ['ralph', 'autopilot', 'ultrawork', 'ralplan']
  const stateActivations: OmnStateMode[] = resolved.filter(m =>
    (stateModes as readonly string[]).includes(m.name),
  ).map(m => m.name as OmnStateMode)

  // ralph 联动 ultrawork（官方语义）
  const hasRalph = resolved.some(m => m.name === 'ralph')
  const hasUltrawork = resolved.some(m => m.name === 'ultrawork')
  if (hasRalph && !hasUltrawork) {
    stateActivations.push('ultrawork')
  }

  // 模式消息（注入上下文，不进技能列表）
  const modeMessages: string[] = []
  const skills: SkillMatch[] = []
  for (const m of resolved) {
    const message = MODE_MESSAGE_KEYWORDS.get(m.name)
    if (message !== undefined) {
      modeMessages.push(message)
    } else if (m.name !== 'cancel') {
      skills.push(m)
    }
  }

  return { stateActivations, modeMessages, skills, cancelled: false }
}
