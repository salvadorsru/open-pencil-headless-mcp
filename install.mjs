import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import pkg from './package.json' with { type: 'json' }

const SPEC = 'github:salvadorsru/open-pencil-headless-mcp#main'

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

function dest(args, cwd) {
  const out = flag(args, '--out')
  const client = flag(args, '--client')
  if (out && client) throw new Error('use --out or --client, not both')
  if (out) return resolve(cwd, out)
  if (client === 'cursor') return join(cwd, '.cursor/mcp.json')
  if (client === 'claude') return claudeConfig()
  if (client) throw new Error(`unknown --client ${client} (cursor or claude)`)
  return undefined
}

export function block(designs) {
  return {
    command: 'npx',
    args: ['-y', '--prefer-online', SPEC],
    env: { OPENPENCIL_MCP_ROOT: designs },
  }
}

async function merge(dest, pencil) {
  let current = {}
  try {
    current = JSON.parse(await readFile(dest, 'utf8'))
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error
  }
  if (current === null || typeof current !== 'object' || Array.isArray(current)) {
    throw new Error(`${dest} is not a JSON object`)
  }
  const servers =
    current.mcpServers && typeof current.mcpServers === 'object' && !Array.isArray(current.mcpServers)
      ? current.mcpServers
      : {}
  return {
    ...current,
    mcpServers: { ...servers, pencil },
  }
}

export async function install(args) {
  const cwd = process.cwd()
  const designs = resolve(cwd, flag(args, '--root') ?? cwd)
  const pencil = block(designs)
  const path = dest(args, cwd)
  const snippet = { mcpServers: { pencil } }

  if (!path) {
    process.stdout.write(`${JSON.stringify(snippet, null, 2)}\n`)
    process.stderr.write(
      `pencil ${pkg.version}: paste that into any MCP client. Write a file with --out FILE or --client cursor|claude.\n`,
    )
    return snippet
  }

  const next = await merge(path, pencil)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`)
  process.stderr.write(
    `pencil ${pkg.version}: wrote ${path}\npencil ${pkg.version}: OPENPENCIL_MCP_ROOT=${designs}\npencil ${pkg.version}: restart the MCP server in your client\n`,
  )
  return next
}
