import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import pkg from './package.json' with { type: 'json' }

const SPEC = 'github:salvadorsru/open-pencil-headless-mcp#main'
const CLIENTS = ['cursor', 'vscode', 'claude', 'claude-code', 'windsurf']

function flag(args, name) {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('-')) {
    throw new Error(`${name} needs a value`)
  }
  return value
}

function claudeConfig() {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library/Application Support/Claude/claude_desktop_config.json')
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData/Roaming'), 'Claude/claude_desktop_config.json')
  }
  return join(homedir(), '.config/Claude/claude_desktop_config.json')
}

function windsurfConfig() {
  return join(homedir(), '.codeium/windsurf/mcp_config.json')
}

function walk(cwd, rel) {
  let dir = resolve(cwd)
  const home = resolve(homedir())
  for (;;) {
    if (dir === home) return
    const path = join(dir, rel)
    if (existsSync(path)) return path
    const parent = dirname(dir)
    if (parent === dir) return
    dir = parent
  }
}

export function host(env) {
  if (env.CURSOR_TRACE_ID || env.CURSOR_AGENT || env.CURSOR_SESSION_ID || env.TERM_PROGRAM === 'cursor') {
    return 'cursor'
  }
  if (env.CLAUDE_CODE || env.CLAUDECODE || env.CLAUDE_AGENT) return 'claude-code'
  if (env.WINDSURF || env.TERM_PROGRAM === 'windsurf') return 'windsurf'
  if (env.VSCODE_PID || env.VSCODE_INJECTION || env.TERM_PROGRAM === 'vscode') return 'vscode'
  return undefined
}

export function locate(cwd, env = process.env, args = []) {
  const out = flag(args, '--out')
  const clientFlag = flag(args, '--client')
  if (out && clientFlag) throw new Error('use --out or --client, not both')
  if (out) return { client: 'file', path: resolve(cwd, out) }
  if (clientFlag) {
    if (!CLIENTS.includes(clientFlag)) {
      throw new Error(`unknown --client ${clientFlag} (${CLIENTS.join(', ')})`)
    }
    return { client: clientFlag, path: destOf(clientFlag, cwd) }
  }

  const cursorDir = walk(cwd, '.cursor')
  const vscodeDir = walk(cwd, '.vscode')
  const claudeCode = walk(cwd, '.mcp.json')
  const running = host(env)

  if (running === 'cursor') return { client: 'cursor', path: destOf('cursor', cwd) }
  if (running === 'vscode') return { client: 'vscode', path: destOf('vscode', cwd) }
  if (running === 'claude-code') return { client: 'claude-code', path: destOf('claude-code', cwd) }
  if (running === 'windsurf') return { client: 'windsurf', path: destOf('windsurf', cwd) }

  const existing = []
  if (cursorDir && existsSync(join(cursorDir, 'mcp.json'))) {
    existing.push({ client: 'cursor', path: join(cursorDir, 'mcp.json') })
  }
  if (vscodeDir && existsSync(join(vscodeDir, 'mcp.json'))) {
    existing.push({ client: 'vscode', path: join(vscodeDir, 'mcp.json') })
  }
  if (claudeCode) existing.push({ client: 'claude-code', path: claudeCode })
  if (existing.length === 1) return existing[0]

  const markers = []
  if (cursorDir) markers.push({ client: 'cursor', path: destOf('cursor', cwd) })
  if (vscodeDir) markers.push({ client: 'vscode', path: destOf('vscode', cwd) })
  if (markers.length === 1) return markers[0]

  if (existsSync(claudeConfig())) return { client: 'claude', path: claudeConfig() }
  if (existsSync(windsurfConfig())) return { client: 'windsurf', path: windsurfConfig() }

  return { client: undefined, path: undefined }
}

function destOf(client, cwd) {
  if (client === 'cursor') {
    const marker = walk(cwd, '.cursor')
    return join(marker ? dirname(marker) : cwd, '.cursor/mcp.json')
  }
  if (client === 'vscode') {
    const marker = walk(cwd, '.vscode')
    return join(marker ? dirname(marker) : cwd, '.vscode/mcp.json')
  }
  if (client === 'claude') return claudeConfig()
  if (client === 'claude-code') return walk(cwd, '.mcp.json') ?? join(cwd, '.mcp.json')
  if (client === 'windsurf') return windsurfConfig()
  throw new Error(`unknown client ${client}`)
}

export function block(designs) {
  return {
    command: 'npx',
    args: ['-y', '--prefer-online', SPEC],
    env: { OPENPENCIL_MCP_ROOT: designs },
  }
}

function bucket(client, current) {
  if (client === 'vscode') return 'servers'
  if (current?.servers && !current.mcpServers) return 'servers'
  return 'mcpServers'
}

function entry(client, pencil) {
  return client === 'vscode' ? { type: 'stdio', ...pencil } : pencil
}

async function merge(path, client, pencil) {
  let current = {}
  try {
    current = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error
  }
  if (current === null || typeof current !== 'object' || Array.isArray(current)) {
    throw new Error(`${path} is not a JSON object`)
  }
  const key = bucket(client, current)
  const servers = current[key] && typeof current[key] === 'object' && !Array.isArray(current[key]) ? current[key] : {}
  return { ...current, [key]: { ...servers, pencil: entry(client, pencil) } }
}

export async function install(args, options = {}) {
  const cwd = options.cwd ?? process.cwd()
  const env = options.env ?? process.env
  const designs = resolve(cwd, flag(args, '--root') ?? cwd)
  const pencil = block(designs)
  const found = locate(cwd, env, args)
  const snippet = { mcpServers: { pencil } }

  if (!found.path) {
    process.stdout.write(`${JSON.stringify(snippet, null, 2)}\n`)
    process.stderr.write(
      `pencil ${pkg.version}: no MCP client detected. Paste that JSON, or pass --client ${CLIENTS.join('|')} or --out FILE.\n`,
    )
    return snippet
  }

  const next = await merge(found.path, found.client, pencil)
  await mkdir(dirname(found.path), { recursive: true })
  await writeFile(found.path, `${JSON.stringify(next, null, 2)}\n`)
  process.stderr.write(
    `pencil ${pkg.version}: ${found.client} → ${found.path}\npencil ${pkg.version}: OPENPENCIL_MCP_ROOT=${designs}\npencil ${pkg.version}: restart the MCP server in your client\n`,
  )
  return next
}
