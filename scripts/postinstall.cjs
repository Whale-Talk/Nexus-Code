#!/usr/bin/env node
/**
 * Nexus Code — postinstall hook
 * Guides users through PATH setup to avoid the "nexus: command not found" issue.
 *
 * This runs after `bun add -g @while_talk/nexus-code` or `npm install -g @while_talk/nexus-code`.
 */

const { existsSync } = require('fs')
const { homedir, platform } = require('os')
const { delimiter, join } = require('path')

const CYAN = '\x1b[36m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

function main() {
  const isWindows = platform() === 'win32'
  const home = homedir()
  const bunBin = join(home, '.bun', 'bin')
  const npmBunBin = join(home, 'AppData', 'Roaming', 'npm', 'node_modules', 'bun', 'bin')
  const pathEnv = process.env.PATH || ''
  // 跨平台分隔符: Windows ';' / POSIX ':'（修复硬编码 ':' 导致的误判）
  const pathDirs = pathEnv.split(delimiter)
  const bunInPath = pathDirs.some(p => p.toLowerCase() === bunBin.toLowerCase())
  const npmBunInPath = pathDirs.some(p => p.toLowerCase() === npmBunBin.toLowerCase())

  // Check if `nexus` is immediately runnable
  let nexusWorks = false
  try {
    const { execSync } = require('child_process')
    execSync('command -v nexus', { stdio: 'ignore', shell: isWindows ? 'cmd.exe' : true })
    nexusWorks = true
  } catch {
    nexusWorks = false
  }

  // Check if bun is available (bun.exe on Windows, bare bun elsewhere)
  const bunCandidates = isWindows ? ['bun.exe', 'bun.cmd', 'bun'] : ['bun']
  const bunAvailable =
    pathDirs.some(d => bunCandidates.some(n => existsSync(join(d, n)))) ||
    existsSync(join(bunBin, isWindows ? 'bun.exe' : 'bun')) ||
    existsSync(join(npmBunBin, isWindows ? 'bun.exe' : 'bun'))

  console.log('')
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════╗${RESET}`)
  console.log(`${CYAN}${BOLD}║   Nexus Code — Installation Complete     ║${RESET}`)
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════╝${RESET}`)
  console.log('')

  if (nexusWorks) {
    // All good
    console.log(`${GREEN}✓${RESET} nexus is ready to use!`)
    console.log('')
    console.log('  Quick start:')
    console.log(`    ${BOLD}nexus${RESET}                  # launch interactive session`)
    console.log(`    ${BOLD}nexus --version${RESET}        # check version`)
    console.log(`    ${BOLD}nexus "your question"${RESET}  # single-turn query`)
  } else if (!bunInPath || (isWindows && !npmBunInPath)) {
    // bun's bin directory not in PATH
    console.log(`${YELLOW}⚠${RESET}  ${BOLD}bun 相关目录不在 PATH${RESET}`)
    console.log('')
    console.log('   Nexus 已安装但命令行找不到它。')
    if (isWindows) {
      console.log('   把以下目录加入系统 PATH（设置 → 系统 → 高级系统设置 → 环境变量）：')
      console.log('')
      console.log(`     ${BOLD}%USERPROFILE%\\.bun\\bin${RESET}`)
      console.log(`     ${BOLD}%APPDATA%\\npm\\node_modules\\bun\\bin${RESET}`)
      console.log('')
      console.log('   或 PowerShell 一键添加（当前用户）：')
      console.log(`     ${BOLD}setx PATH "$env:PATH;%USERPROFILE%\\.bun\\bin;%APPDATA%\\npm\\node_modules\\bun\\bin"${RESET}`)
      console.log('')
      console.log('   然后重启终端，运行:')
      console.log(`     ${BOLD}nexus --version${RESET}`)
    } else {
      console.log('   Add this line to your shell config:')
      console.log('')
      console.log(`     ${BOLD}export PATH="$HOME/.bun/bin:$PATH"${RESET}`)
      console.log('')
      console.log('   Then restart your terminal or run:')
      console.log(`     ${BOLD}source ~/.bashrc${RESET}  (bash)`)
      console.log(`     ${BOLD}source ~/.zshrc${RESET}   (zsh)`)
      console.log('')
      console.log(`   After that, try: ${BOLD}nexus --version${RESET}`)
    }
  } else if (!bunAvailable) {
    console.log(`${YELLOW}⚠${RESET}  ${BOLD}bun is not installed${RESET}`)
    console.log('')
    console.log('   Nexus Code requires bun >= 1.3.5 as its runtime.')
    console.log('   Install bun first:')
    console.log('')
    if (isWindows) {
      console.log(`     ${BOLD}npm install -g bun${RESET}  (推荐)`)
      console.log(`     ${BOLD}powershell -c "irm bun.sh/install.ps1 | iex"${RESET}`)
    } else {
      console.log(`     ${BOLD}curl -fsSL https://bun.sh/install | bash${RESET}`)
    }
    console.log('')
    console.log('   Then restart your terminal and try:')
    console.log(`     ${BOLD}nexus --version${RESET}`)
  } else {
    console.log(`${YELLOW}⚠${RESET}  nexus may not be in PATH`)
    console.log('')
    console.log('   Try restarting your terminal and running:')
    console.log(`     ${BOLD}nexus --version${RESET}`)
    console.log('')
    console.log('   If that fails, check that your global bin directory is in PATH.')
  }

  // Always show config path
  console.log('')
  console.log(`  Config directory: ${BOLD}~/.nexus/${RESET}`)
  console.log(`  API key setting:  ${BOLD}~/.nexus/settings.json${RESET} → env.NEXUS_API_KEY`)
  console.log('')
}

main()
