#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { relative, resolve } from 'node:path'
import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'

const root = resolve(process.env.OPENPENCIL_MCP_ROOT ?? process.cwd())
const cli = process.env.OPENPENCIL_CLI ?? 'openpencil'

function pathize(value, label = 'file') {
  const path = resolve(root, value)
  const outside = relative(root, path).startsWith('..')

  if (outside) {
    throw new Error(`${label} must be inside ${root}`)
  }

  return path
}

function output(value) {
  return {
    content: [{ type: 'text', text: value }],
  }
}

function fail(error) {
  return {
    isError: true,
    content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
  }
}

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(cli, [command, ...args], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolveRun(stdout.trim())
        return
      }

      reject(new Error(stderr.trim() || stdout.trim() || `openpencil exited with code ${code}`))
    })
  })
}

function file(value) {
  return pathize(value)
}

function register(server, name, description, schema, command, args) {
  server.registerTool(
    name,
    {
      description,
      inputSchema: schema,
      annotations: { readOnlyHint: command !== 'convert', destructiveHint: false },
    },
    async (input) => {
      try {
        const values = args(input)
        return output(await run(command, values))
      } catch (error) {
        return fail(error)
      }
    },
  )
}

const design = z.string().min(1).describe('Path relative to the Pencil root')

const server = new McpServer({
  name: 'open-pencil-headless',
  version: '0.1.0',
})

register(
  server,
  'pencil_info',
  'Get information about an OpenPencil document without opening the app.',
  { file: design },
  'info',
  (input) => [file(input.file), '--json'],
)

register(
  server,
  'pencil_tree',
  'Get the node tree of an OpenPencil document without opening the app.',
  {
    file: design,
    page: z.string().optional().describe('Page name'),
    depth: z.number().int().positive().optional().describe('Maximum depth'),
  },
  'tree',
  (input) => [
    file(input.file),
    ...(input.page ? ['--page', input.page] : []),
    ...(input.depth ? ['--depth', String(input.depth)] : []),
    '--json',
  ],
)

register(
  server,
  'pencil_query',
  'Find nodes with XPath in an OpenPencil document.',
  {
    file: design,
    selector: z.string().min(1).describe('XPath selector'),
    page: z.string().optional().describe('Page name'),
    limit: z.number().int().positive().max(10000).optional().describe('Maximum results'),
  },
  'query',
  (input) => [
    file(input.file),
    input.selector,
    ...(input.page ? ['--page', input.page] : []),
    ...(input.limit ? ['--limit', String(input.limit)] : []),
    '--json',
  ],
)

register(
  server,
  'pencil_lint',
  'Lint an OpenPencil document with quality and accessibility rules.',
  {
    file: design,
    preset: z.enum(['recommended', 'strict', 'accessibility']).optional(),
  },
  'lint',
  (input) => [file(input.file), '--preset', input.preset ?? 'recommended', '--json'],
)

register(
  server,
  'pencil_export',
  'Export an OpenPencil document without opening the app. The destination must be inside the root.',
  {
    file: design,
    format: z.enum(['png', 'jpg', 'webp', 'svg', 'pdf', 'pptx', 'jsx', 'html', 'fig']),
    output: z.string().min(1).describe('Relative output path inside the root'),
    page: z.string().optional().describe('Page name'),
    scale: z.number().positive().optional().describe('Export scale'),
  },
  'export',
  (input) => [
    file(input.file),
    '--format',
    input.format,
    '--output',
    pathize(input.output, 'output'),
    ...(input.page ? ['--page', input.page] : []),
    ...(input.scale ? ['--scale', String(input.scale)] : []),
  ],
)

register(
  server,
  'pencil_convert',
  'Convert an OpenPencil document to .fig without opening the app.',
  {
    file: design,
    output: z.string().min(1).describe('Relative output path inside the root'),
  },
  'convert',
  (input) => [file(input.file), '--output', pathize(input.output, 'output'), '--format', 'fig'],
)

const transport = new StdioServerTransport()
await server.connect(transport)
