#!/usr/bin/env node

import { readdir } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'

import pkg from './package.json' with { type: 'json' }

const { version } = pkg

const argv = process.argv.slice(2).filter((arg) => arg !== '--')
if (argv[0] === 'install') {
  const { install } = await import('./install.mjs')
  await install(argv.slice(1))
  process.exit(0)
}

process.stderr.write(`open-pencil-headless ${version}: starting\n`)

const {
  analyze,
  convert,
  exportDocument,
  find,
  fontStatus,
  formats,
  info,
  lint,
  node,
  pages,
  query,
  section,
  tree,
  variables,
  warm,
} = await import('./dist/engine.mjs')
process.stderr.write(`open-pencil-headless ${version}: engine loaded\n`)

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

const server = new McpServer(
  {
    name: 'pencil',
    version,
  },
  {
    instructions:
      'Local Figma inspector for .fig and .pen files on disk. When the user asks to consult Figma, inspect a design, or read layers, styles, spacing, copy, or tokens from a .fig, use these tools first. Do not use a Figma cloud, API, or desktop MCP unless they paste a figma.com URL. Prefer pencil_section for a named block; pencil_find to locate layers; pencil_node for one id. Paths are relative to OPENPENCIL_MCP_ROOT.',
  },
)

register(
  'pencil_info',
  'Figma: document info for a local .fig or .pen. Use when the user asks to consult Figma or open a design file.',
  { file: design },
  (input) => info(pathize(input.file)),
)

register(
  'pencil_tree',
  'Figma: node tree of a local .fig or .pen.',
  {
    file: design,
    page: z.string().optional().describe('Page name'),
    depth: z.number().int().positive().optional().describe('Maximum depth'),
  },
  (input) => tree(pathize(input.file), { page: input.page, depth: input.depth }),
)

register(
  'pencil_query',
  'Figma: find nodes with XPath in a local .fig or .pen.',
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
  'pencil_pages',
  'Figma: list pages in a local .fig or .pen.',
  { file: design },
  (input) => pages(pathize(input.file)),
)

register(
  'pencil_node',
  'Figma: live node style — fills, padding, gap, layout, text, typography.',
  {
    file: design,
    id: z.string().min(1).describe('Node ID'),
  },
  (input) => node(pathize(input.file), { id: input.id }),
)

register(
  'pencil_find',
  'Figma: find layers by name or type. Page matches the canvas name or a substring (e.g. Desktop → UI Desktop).',
  {
    file: design,
    name: z.string().optional().describe('Partial name, case-insensitive'),
    type: z.string().optional().describe('Node type, e.g. FRAME, TEXT, COMPONENT'),
    page: z.string().optional().describe('Page name or substring, e.g. Desktop'),
    limit: z.number().int().positive().max(10000).optional().describe('Maximum results'),
  },
  (input) =>
    find(pathize(input.file), {
      name: input.name,
      type: input.type,
      page: input.page,
      limit: input.limit,
    }),
)

register(
  'pencil_section',
  'Figma: one-shot inspect of a named block (path, texts, children, fills, padding, gap, layout). Prefer this when the user asks for a section or component in Figma.',
  {
    file: design,
    name: z.string().min(1).describe('Layer name, case-insensitive substring'),
    page: z.string().optional().describe('Page name or substring, e.g. Mobile'),
    within: z.string().optional().describe('Ancestor name substring, e.g. Homepage'),
    limit: z.number().int().positive().max(100).optional().describe('Candidates to consider'),
  },
  (input) =>
    section(pathize(input.file), {
      name: input.name,
      page: input.page,
      within: input.within,
      limit: input.limit,
    }),
)

register(
  'pencil_variables',
  'Figma: list design variables and collections.',
  {
    file: design,
    collection: z.string().optional().describe('Filter by collection name'),
    type: z.string().optional().describe('COLOR, FLOAT, STRING, or BOOLEAN'),
  },
  (input) =>
    variables(pathize(input.file), {
      collection: input.collection,
      type: input.type,
    }),
)

register(
  'pencil_fonts',
  'Figma: fonts used by a local .fig or .pen and whether they resolve.',
  { file: design },
  (input) => fontStatus(pathize(input.file)),
)

register(
  'pencil_formats',
  'List supported document and export formats.',
  {},
  () => formats(),
)

register(
  'pencil_analyze',
  'Figma: analyze tokens (colors, typography, spacing, clusters, overlaps).',
  {
    file: design,
    kind: z.enum(['colors', 'typography', 'spacing', 'clusters', 'overlaps']),
    threshold: z.number().optional().describe('Color distance threshold (colors)'),
    similar: z.boolean().optional().describe('Cluster similar colors'),
    limit: z.number().int().positive().optional(),
    minSize: z.number().positive().optional().describe('Minimum node size (clusters)'),
    minCount: z.number().int().positive().optional().describe('Minimum repeats (clusters)'),
    scope: z.string().optional().describe('Overlap scope'),
    severity: z.string().optional().describe('Overlap severity'),
    categories: z.string().optional().describe('Overlap categories'),
    minRatio: z.number().min(0).max(1).optional().describe('Overlap min ratio'),
  },
  (input) =>
    analyze(pathize(input.file), {
      kind: input.kind,
      threshold: input.threshold,
      similar: input.similar,
      limit: input.limit,
      minSize: input.minSize,
      minCount: input.minCount,
      scope: input.scope,
      severity: input.severity,
      categories: input.categories,
      minRatio: input.minRatio,
    }),
)

register(
  'pencil_lint',
  'Figma: lint a local .fig or .pen for quality and accessibility.',
  {
    file: design,
    preset: z.enum(['recommended', 'strict', 'accessibility']).optional(),
  },
  (input) => lint(pathize(input.file), { preset: input.preset }),
)

register(
  'pencil_export',
  'Figma: export a local .fig or .pen. Destination must stay inside the root.',
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
  'Figma: convert a local .pen to .fig.',
  {
    file: design,
    output: z.string().min(1).describe('Relative output path inside the root'),
  },
  (input) => convert(pathize(input.file), pathize(input.output, 'output')),
  false,
)

const transport = new StdioServerTransport()
try {
  await server.connect(transport)
} catch (error) {
  process.stderr.write(
    `open-pencil-headless ${version}: connect failed — ${error instanceof Error ? error.message : error}\n`,
  )
  process.exit(1)
}

process.stderr.write(`open-pencil-headless ${version}: ready (root ${root})\n`)

async function designs(dir) {
  const out = []
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'exports' || entry.name.startsWith('.')) continue
      out.push(...(await designs(path)))
      continue
    }
    if (/\.(fig|pen)$/i.test(entry.name) && !entry.name.endsWith('.bak')) out.push(path)
  }
  return out
}

queueMicrotask(async () => {
  const files = await designs(root)
  for (const file of files) {
    const start = Date.now()
    try {
      await warm(file)
      process.stderr.write(
        `open-pencil-headless ${version}: graph ready ${relative(root, file)} in ${Date.now() - start}ms\n`,
      )
    } catch (error) {
      process.stderr.write(
        `open-pencil-headless ${version}: warm failed ${relative(root, file)} — ${error instanceof Error ? error.message : error}\n`,
      )
    }
  }
})
