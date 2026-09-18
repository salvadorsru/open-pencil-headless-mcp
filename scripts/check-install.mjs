import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { install } from '../install.mjs'

const env = {}
const dir = await mkdtemp(join(tmpdir(), 'pencil-install-'))
const figs = join(dir, 'figs')

const printed = await install(['--root', figs], { cwd: dir, env })
if (printed.mcpServers.pencil.command !== 'npx') throw new Error('print: expected npx')

const cursorRoot = join(dir, 'cursor-app')
await mkdir(join(cursorRoot, '.cursor'), { recursive: true })
await install(['--root', figs], { cwd: cursorRoot, env })
const cursor = JSON.parse(await readFile(join(cursorRoot, '.cursor/mcp.json'), 'utf8'))
if (!cursor.mcpServers.pencil) throw new Error('cursor detect failed')

const codeRoot = join(dir, 'code-app')
await mkdir(join(codeRoot, '.vscode'), { recursive: true })
await install(['--root', figs], { cwd: codeRoot, env })
const code = JSON.parse(await readFile(join(codeRoot, '.vscode/mcp.json'), 'utf8'))
if (code.servers.pencil.type !== 'stdio') throw new Error('vscode shape failed')
if (code.mcpServers) throw new Error('vscode must use servers')

const both = join(dir, 'both')
await mkdir(join(both, '.cursor'), { recursive: true })
await mkdir(join(both, '.vscode'), { recursive: true })
const ambiguous = await install(['--root', figs], { cwd: both, env })
if (!ambiguous.mcpServers) throw new Error('ambiguous should print')
try {
  await readFile(join(both, '.cursor/mcp.json'))
  throw new Error('ambiguous must not write cursor')
} catch (error) {
  if (error && error.code !== 'ENOENT') throw error
}

await install(['--root', figs], { cwd: both, env: { CURSOR_TRACE_ID: '1' } })
const picked = JSON.parse(await readFile(join(both, '.cursor/mcp.json'), 'utf8'))
if (!picked.mcpServers.pencil) throw new Error('cursor env should win')

const dest = join(dir, 'cfg/mcp.json')
await mkdir(join(dir, 'cfg'), { recursive: true })
await writeFile(dest, JSON.stringify({ mcpServers: { Sanity: { url: 'https://example' } } }))
await install(['--root', figs, '--out', dest], { cwd: dir, env })
const merged = JSON.parse(await readFile(dest, 'utf8'))
if (!merged.mcpServers.Sanity || !merged.mcpServers.pencil) throw new Error('merge failed')

console.log('install ok')
