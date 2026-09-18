import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chdir } from 'node:process'

import { install } from '../install.mjs'

const dir = await mkdtemp(join(tmpdir(), 'pencil-install-'))
chdir(dir)
await mkdir(join(dir, '.cursor'), { recursive: true })
await writeFile(
  join(dir, '.cursor/mcp.json'),
  JSON.stringify({ mcpServers: { Sanity: { url: 'https://mcp.sanity.io' } } }, null, 2),
)
await install(['--root', join(dir, 'figs')])
const data = JSON.parse(await readFile(join(dir, '.cursor/mcp.json'), 'utf8'))
if (!data.mcpServers.Sanity) throw new Error('lost existing server')
if (data.mcpServers.pencil.command !== 'npx') throw new Error('expected npx')
if (data.mcpServers.pencil.env.OPENPENCIL_MCP_ROOT !== join(dir, 'figs')) {
  throw new Error(`root ${data.mcpServers.pencil.env.OPENPENCIL_MCP_ROOT}`)
}
if (!data.mcpServers.pencil.args.includes('github:salvadorsru/open-pencil-headless-mcp#main')) {
  throw new Error('missing spec')
}
console.log('install ok')
