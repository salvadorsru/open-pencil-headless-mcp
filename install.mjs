import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import pkg from './package.json' with { type: 'json' }

const SPEC = 'github:salvadorsru/open-pencil-headless-mcp#main'

function flag(args, name) {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('-')) {
    throw new Error(`${name} needs a path`)
  }
  return value
}

export async function install(args) {
  const cwd = process.cwd()
  const designs = resolve(cwd, flag(args, '--root') ?? cwd)
  const dest = join(cwd, '.cursor/mcp.json')

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

  const next = {
    ...current,
    mcpServers: {
      ...servers,
      pencil: {
        command: 'npx',
        args: ['-y', '--prefer-online', SPEC],
        env: { OPENPENCIL_MCP_ROOT: designs },
      },
    },
  }

  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, `${JSON.stringify(next, null, 2)}\n`)
  process.stderr.write(
    `pencil ${pkg.version}: wrote ${dest}\npencil ${pkg.version}: OPENPENCIL_MCP_ROOT=${designs}\npencil ${pkg.version}: restart the MCP server in Cursor\n`,
  )
}
