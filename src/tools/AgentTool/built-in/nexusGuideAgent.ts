import { BASH_TOOL_NAME } from 'src/tools/BashTool/toolName.js'
import { FILE_READ_TOOL_NAME } from 'src/tools/FileReadTool/prompt.js'
import { GLOB_TOOL_NAME } from 'src/tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from 'src/tools/GrepTool/prompt.js'
import { SEND_MESSAGE_TOOL_NAME } from 'src/tools/SendMessageTool/constants.js'
import { WEB_FETCH_TOOL_NAME } from 'src/tools/WebFetchTool/prompt.js'
import { WEB_SEARCH_TOOL_NAME } from 'src/tools/WebSearchTool/prompt.js'
import { hasEmbeddedSearchTools } from 'src/utils/embeddedTools.js'
import { getSettings_DEPRECATED } from 'src/utils/settings/settings.js'
import { jsonStringify } from '../../../utils/slowOperations.js'
import type {
  AgentDefinition,
  BuiltInAgentDefinition,
} from '../loadAgentsDir.js'

export const NEXUS_GUIDE_AGENT_TYPE = 'nexus-guide'

function getNexusGuidePrompt(): string {
  return `Help users work with Nexus Code, including installation, local sessions, tools and approvals, MCP, plugins, and keyboard settings.
For routing questions, explain how to select a channel and a model for each role in the settings center. Check the repository README and the user's configuration before describing defaults.
Consult https://github.com/Whale-Talk/Nexus-Code for the Nexus CLI. For service-specific capabilities, use the documentation of the provider configured for the relevant model.
Handle API keys as secrets: describe the environment variable and never display its value.`
}

export const NEXUS_GUIDE_AGENT: BuiltInAgentDefinition = {
  agentType: NEXUS_GUIDE_AGENT_TYPE,
  whenToUse: `Help with Nexus Code settings, model roles, sessions, commands, or integrations. Reuse an existing guide agent with ${SEND_MESSAGE_TOOL_NAME} when appropriate.`,
  // Ant-native builds: Glob/Grep tools are removed; use Bash (with embedded
  // bfs/ugrep via find/grep aliases) for local file search instead.
  tools: hasEmbeddedSearchTools()
    ? [
        BASH_TOOL_NAME,
        FILE_READ_TOOL_NAME,
        WEB_FETCH_TOOL_NAME,
        WEB_SEARCH_TOOL_NAME,
      ]
    : [
        GLOB_TOOL_NAME,
        GREP_TOOL_NAME,
        FILE_READ_TOOL_NAME,
        WEB_FETCH_TOOL_NAME,
        WEB_SEARCH_TOOL_NAME,
      ],
  source: 'built-in',
  baseDir: 'built-in',
  model: 'electron',
  permissionMode: 'dontAsk',
  getSystemPrompt({ toolUseContext }) {
    const commands = toolUseContext.options.commands

    // Build context sections
    const contextSections: string[] = []

    // 1. Custom skills
    const customCommands = commands.filter(cmd => cmd.type === 'prompt')
    if (customCommands.length > 0) {
      const commandList = customCommands
        .map(cmd => `- /${cmd.name}: ${cmd.description}`)
        .join('\n')
      contextSections.push(
        `**Available custom skills in this project:**\n${commandList}`,
      )
    }

    // 2. Custom agents from .nexus/agents/
    const customAgents =
      toolUseContext.options.agentDefinitions.activeAgents.filter(
        (a: AgentDefinition) => a.source !== 'built-in',
      )
    if (customAgents.length > 0) {
      const agentList = customAgents
        .map((a: AgentDefinition) => `- ${a.agentType}: ${a.whenToUse}`)
        .join('\n')
      contextSections.push(
        `**Available custom agents configured:**\n${agentList}`,
      )
    }

    // 3. MCP servers
    const mcpClients = toolUseContext.options.mcpClients
    if (mcpClients && mcpClients.length > 0) {
      const mcpList = mcpClients
        .map((client: { name: string }) => `- ${client.name}`)
        .join('\n')
      contextSections.push(`**Configured MCP servers:**\n${mcpList}`)
    }

    // 4. Plugin commands
    const pluginCommands = commands.filter(
      cmd => cmd.type === 'prompt' && cmd.source === 'plugin',
    )
    if (pluginCommands.length > 0) {
      const pluginList = pluginCommands
        .map(cmd => `- /${cmd.name}: ${cmd.description}`)
        .join('\n')
      contextSections.push(`**Available plugin skills:**\n${pluginList}`)
    }

    // 5. User settings
    const settings = getSettings_DEPRECATED()
    if (Object.keys(settings).length > 0) {
      // eslint-disable-next-line no-restricted-syntax -- human-facing UI, not tool_result
      const settingsJson = jsonStringify(settings, null, 2)
      contextSections.push(
        `**User's settings.json:**\n\`\`\`json\n${settingsJson}\n\`\`\``,
      )
    }

    // Add the feedback guideline (conditional based on whether user is using 3P services)
    const basePromptWithFeedback = getNexusGuidePrompt()

    // If we have any context to add, append it to the base system prompt
    if (contextSections.length > 0) {
      return `${basePromptWithFeedback}

---

# User's Current Configuration

The user has the following custom setup in their environment:

${contextSections.join('\n\n')}

When answering questions, consider these configured features and proactively suggest them when relevant.`
    }

    // Return the base prompt if no context to add
    return basePromptWithFeedback
  },
}
