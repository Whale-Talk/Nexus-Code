#!/usr/bin/env node
/**
 * Nexus Code — postinstall hook
 * Guides users through PATH setup to avoid the "nexus: command not found" issue.
 *
 * This runs after `bun add -g @while_talk/nexus-code` or `npm install -g @while_talk/nexus-code`.
 */

const { existsSync } = require('fs')
const { homedir, platform } = require('os')
const { join } = require('path')

const CYAN = '\x1b[36m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

function main() {
  const home = homedir()
  const bunBin = join(home, '.bun', 'bin')
  const pathEnv = process.env.PATH || ''
  const bunInPath = pathEnv.split(':').some(p => p === bunBin)

  // Check if `nexus` is immediately runnable
  let nexusWorks = false
  try {
    const { execSync } = require('child_process')
    execSync('command -v nexus', { stdio: 'ignore' })
    nexusWorks = true
  } catch {
    nexusWorks = false
  }

  // Check if bun is available
  const bunAvailable = existsSync(join(bunBin, 'bun')) ||
    pathEnv.split(':').some(p => existsSync(join(p, 'bun')))

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
  } else if (!bunInPath) {
    // bun's bin directory not in PATH
    console.log(`${YELLOW}⚠${RESET}  ${BOLD}~/.bun/bin/ is not in your PATH${RESET}`)
    console.log('')
    console.log('   Nexus was installed but your shell cannot find it.')
    console.log('   Add this line to your shell config:')
    console.log('')
    console.log(`     ${BOLD}export PATH="$HOME/.bun/bin:$PATH"${RESET}`)
    console.log('')
    console.log('   Then restart your terminal or run:')
    console.log(`     ${BOLD}source ~/.bashrc${RESET}  (bash)`)
    console.log(`     ${BOLD}source ~/.zshrc${RESET}   (zsh)`)
    console.log('')
    console.log(`   After that, try: ${BOLD}nexus --version${RESET}`)
  } else if (!bunAvailable) {
    console.log(`${YELLOW}⚠${RESET}  ${BOLD}bun is not installed${RESET}`)
    console.log('')
    console.log('   Nexus Code requires bun >= 1.3.5 as its runtime.')
    console.log('   Install bun first:')
    console.log('')
    console.log(`     ${BOLD}curl -fsSL https://bun.sh/install | bash${RESET}`)
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
