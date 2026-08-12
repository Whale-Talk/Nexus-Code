/**
 * OMN 技能引导文本生成（与官方 createSkillInvocation 语义一致）：
 * 生成紧凑的引导块，指示模型立即调用对应技能，
 * 不内联 SKILL.md 全文（避免 UserPromptSubmit token 爆炸）。
 */
import { existsSync } from 'fs'
import { join } from 'path'
import type { SkillMatch } from './keywordDetector.js'

const SKILL_INVOCATION_USER_REQUEST_MAX = 1200

function compactHookText(text: string, maxChars = SKILL_INVOCATION_USER_REQUEST_MAX): string {
  const notice =
    '\n...[truncated; original user prompt remains available in the conversation]'
  if (!text || text.length <= maxChars) return text || ''
  if (maxChars <= notice.length) return notice.slice(0, Math.max(0, maxChars))
  return `${text.slice(0, maxChars - notice.length).trimEnd()}${notice}`
}

/** 技能 SKILL.md 候选路径：项目 .nexus/skills + 用户 ~/.nexus/skills */
function getSkillPathCandidates(skillName: string): string[] {
  const roots = [process.cwd(), process.env.HOME ?? ''].filter(Boolean)
  return [
    ...new Set(roots.map(root => join(root, '.nexus', 'skills', skillName, 'SKILL.md'))),
  ]
}

function resolveSkillPath(skillName: string): string {
  for (const skillPath of getSkillPathCandidates(skillName)) {
    if (existsSync(skillPath)) return skillPath
  }
  return getSkillPathCandidates(skillName)[0] || `skills/${skillName}/SKILL.md`
}

/** 单技能引导块 */
export function createSkillInvocation(
  skillName: string,
  originalPrompt: string,
  args = '',
): string {
  const argsSection = args ? `\nArguments: ${args}` : ''
  const skillPath = resolveSkillPath(skillName)
  const pathStatus = existsSync(skillPath)
    ? `Read fallback: open ${skillPath} and follow its SKILL.md instructions.`
    : `Read fallback: locate skills/${skillName}/SKILL.md in the active oh-my-claudecode install and follow it.`

  return `[MAGIC KEYWORD: ${skillName.toUpperCase()}]

Skill routing detected: ${skillName}
Preferred invocation: /oh-my-claudecode:${skillName}${args ? ` ${args}` : ''}
${pathStatus}${argsSection}

User request (compact echo; original prompt remains authoritative):
${compactHookText(originalPrompt)}

IMPORTANT: Start the ${skillName} workflow immediately. If the slash invocation is unavailable, read the SKILL.md at the fallback path instead of relying on this compact guide.`
}

/** 多技能引导块（按序执行） */
export function createMultiSkillInvocation(
  skills: SkillMatch[],
  originalPrompt: string,
): string {
  if (skills.length === 0) return ''
  if (skills.length === 1) {
    return createSkillInvocation(skills[0].name, originalPrompt, skills[0].args)
  }

  const skillBlocks = skills
    .map((s, i) => {
      const skillPath = resolveSkillPath(s.name)
      const argsText = s.args ? ` ${s.args}` : ''
      const pathStatus = existsSync(skillPath)
        ? `Read fallback: ${skillPath}`
        : `Read fallback: locate skills/${s.name}/SKILL.md in the active oh-my-claudecode install`
      return `### Skill ${i + 1}: ${s.name.toUpperCase()}
Preferred invocation: /oh-my-claudecode:${s.name}${argsText}
${pathStatus}`
    })
    .join('\n\n')

  return `[MAGIC KEYWORDS DETECTED: ${skills.map(s => s.name.toUpperCase()).join(', ')}]

Execute ALL detected workflows in order using compact invocation guidance. Do not inline full SKILL.md files into the prompt.

${skillBlocks}

User request (compact echo; original prompt remains authoritative):
${compactHookText(originalPrompt)}

IMPORTANT: Complete ALL skills listed above in order. Start with the first skill IMMEDIATELY.`
}
