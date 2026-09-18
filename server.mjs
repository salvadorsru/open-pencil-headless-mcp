#!/usr/bin/env node

import { relative, resolve } from 'node:path'
import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'

import { convert, exportDocument, info, lint, query, tree } from './dist/engine.mjs'

const root = resolve(process.env.OPENPENCIL_MCP_ROOT ?? process.cwd())
const design = z.string().min(1).describe('Path relative to the Pencil root')

function pathize(value, label = 'file') {
  const path = resolve(root, value)
  if (relative(root, path).startsWith('..')) {
    throw new Error(`${label} must be inside ${root}`)
  }
  return path
}

function output(value) {
  return { content: [{ type: 'text', text: value }] }
}

function fail(error) {
  return {
    isError: true,
    content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
  }
}

function register(name, description, schema, run, readOnly = true) {
  server.registerTool(
    name,
    {
      description,
      inputSchema: schema,
      annotations: { readOnlyHint: readOnly, destructiveHint: false },
    },
    async (input) => {
      try {
        return output(await run(input))
      } catch (error) {
        return fail(error)
      }
    },
  )
}

const server = new McpServer({
  name: 'open-pencil-headless',
  version: '0.1.0',
})

register(
  'pencil_info',
  'Get information about an OpenPencil document without opening the app.',
  { file: design },
  (input) => info(pathize(input.file)),
)

register(
  'pencil_tree',
  'Get the node tree of an OpenPencil document without opening the app.',
  {
    file: design,
    page: z.string().optional().describe('Page name'),
    depth: z.number().int().positive().optional().describe('Maximum depth'),
  },
  (input) => tree(pathize(input.file), { page: input.page, depth: input.depth }),
)

register(
  'pencil_query',
  'Find nodes with XPath in an OpenPencil document.',
  {
    file: design,
    selector: z.string().min(1).describe('XPath selector'),
    page: z.string().optional().describe('Page name'),
    limit: z.number().int().positive().max(10000).optional().describe('Maximum results'),
  },
  (input) =>
    query(pathize(input.file), {
      selector: input.selector,
      page: input.page,
      limit: input.limit,
    }),
)

register(
  'pencil_lint',
  'Lint an OpenPencil document with quality and accessibility rules.',
  {
    file: design,
    preset: z.enum(['recommended', 'strict', 'accessibility']).optional(),
  },
  (input) => lint(pathize(input.file), { preset: input.preset }),
)

register(
  'pencil_export',
  'Export an OpenPencil document without opening the app. The destination must be inside the root.',
  {
    file: design,
    format: z.enum(['png', 'jpg', 'webp', 'svg', 'pdf', 'pptx', 'jsx', 'html', 'fig']),
    output: z.string().min(1).describe('Relative output path inside the root'),
    page: z.string().optional().describe('Page name'),
    scale: z.number().positive().optional().describe('Export scale'),
  },
  (input) =>
    exportDocument(pathize(input.file), {
      format: input.format,
      output: pathize(input.output, 'output'),
      page: input.page,
      scale: input.scale,
    }),
)

register(
  'pencil_convert',
  'Convert an OpenPencil document to .fig without opening the app.',
  {
    file: design,
    output: z.string().min(1).describe('Relative output path inside the root'),
  },
  (input) => convert(pathize(input.file), pathize(input.output, 'output')),
  false,
)

const transport = new StdioServerTransport()
await server.connect(transport)
