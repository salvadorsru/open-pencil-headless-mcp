import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chdir } from 'node:process'
import { access } from 'node:fs/promises'

import { install } from '../install.mjs'

const dir = await mkdtemp(join(tmpdir(), 'pencil-install-'))
chdir(dir)

const printed = await install(['--root', join(dir, 'figs')])
if (printed.mcpServers.pencil.command !== 'npx') throw new Error('print: expected npx')
try {
  await access(join(dir, '.cursor/mcp.json'))
  throw new Error('default install must not write .cursor/mcp.json')
} catch (error) {
  if (error && error.code !== 'ENOENT') throw error
}

await mkdir(join(dir, 'cfg'), { recursive: true })
const dest = join(dir, 'cfg/mcp.json')
await writeFile(dest, JSON.stringify({ mcpServers: { Sanity: { url: 'https://mcp.sanity.io' } } }, null, 2))
await install(['--root', join(dir, 'figs'), '--out', dest])
const data = JSON.parse(await readFile(dest, 'utf8'))
if (!data.mcpServers.Sanity) throw new Error('lost existing server')
if (data.mcpServers.pencil.env.OPENPENCIL_MCP_ROOT !== join(dir, 'figs')) {
  throw new Error(`root ${data.mcpServers.pencil.env.OPENPENCIL_MCP_ROOT}`)
}

await install(['--client', 'cursor', '--root', join(dir, 'more')])
const cursor = JSON.parse(await readFile(join(dir, '.cursor/mcp.json'), 'utf8'))
if (cursor.mcpServers.pencil.env.OPENPENCIL_MCP_ROOT !== join(dir, 'more')) {
  throw new Error('cursor client shortcut failed')
}
console.log('install ok')
