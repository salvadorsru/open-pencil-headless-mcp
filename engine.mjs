import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

import { executeRPCCommand } from '@open-pencil/core/rpc'
import { createLinter } from '@open-pencil/core/lint'
import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { populateAllLazyFigImportRoots, populateLazyFigImportRoots } from '@open-pencil/core/kiwi'
import { computeAllLayouts } from '@open-pencil/core/layout'
import { prepareGraphFonts } from '@open-pencil/core/text'
import { exportHTMLBundle, sceneGraphToDesignDocument } from '@open-pencil/dom-css'

const io = new IORegistry(BUILTIN_IO_FORMATS)
const RASTER = new Set(['png', 'jpg', 'webp'])
const FORMATS = new Set([...RASTER, 'svg', 'pdf', 'pptx', 'jsx', 'html', 'fig'])

function dump(value) {
  return JSON.stringify(value, null, 2)
}

function pageName(args) {
  return typeof args?.page === 'string' ? args.page : undefined
}

export async function load(path) {
  const { graph } = await io.readDocument({
    name: path,
    data: new Uint8Array(await readFile(path)),
  })
  computeAllLayouts(graph)
  return graph
}

export function populatePage(graph, pageId) {
  if (populateLazyFigImportRoots(graph, [pageId])) computeAllLayouts(graph, pageId)
}

export function populateAll(graph) {
  if (populateAllLazyFigImportRoots(graph)) computeAllLayouts(graph)
}

export function prepare(graph, command, args) {
  if (command === 'pages' || command === 'variables') return
  if (command === 'tree') {
    const pages = graph.getPages()
    const name = pageName(args)
    const page = name ? pages.find((item) => item.name === name) : pages[0]
    if (page) populatePage(graph, page.id)
    return
  }
  if (command === 'find' || command === 'query') {
    const name = pageName(args)
    if (name) {
      const page = graph.getPages().find((item) => item.name === name)
      if (page) populatePage(graph, page.id)
      return
    }
    populateAll(graph)
    return
  }
  populateAll(graph)
}

async function rpc(path, command, args) {
  const graph = await load(path)
  prepare(graph, command, args)
  const result = await executeRPCCommand(graph, command, args)
  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error(result.error)
  }
  return dump(result)
}

export function info(path) {
  return rpc(path, 'info')
}

export function tree(path, args = {}) {
  return rpc(path, 'tree', {
    page: args.page,
    depth: args.depth,
  })
}

export function query(path, args) {
  return rpc(path, 'query', {
    selector: args.selector,
    page: args.page,
    limit: args.limit,
  })
}

export function pages(path) {
  return rpc(path, 'pages')
}

export function node(path, args) {
  return rpc(path, 'node', { id: args.id })
}

export function find(path, args = {}) {
  return rpc(path, 'find', {
    name: args.name,
    type: args.type,
    page: args.page,
    limit: args.limit,
  })
}

export function variables(path, args = {}) {
  return rpc(path, 'variables', {
    collection: args.collection,
    type: args.type,
  })
}

export function fontStatus(path) {
  return rpc(path, 'font-status')
}

export function analyze(path, args) {
  return rpc(path, `analyze_${args.kind}`, {
    threshold: args.threshold,
    similar: args.similar,
    limit: args.limit,
    minSize: args.minSize,
    minCount: args.minCount,
    scope: args.scope,
    severity: args.severity,
    categories: args.categories,
    minRatio: args.minRatio,
  })
}

export function formats() {
  return dump(
    io.listFormats().map((format) => ({
      id: format.id,
      label: format.label,
      role: format.role,
      category: format.category,
      extensions: format.extensions,
      mimeTypes: format.mimeTypes,
      support: Object.entries(format.support)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name),
    })),
  )
}

export async function lint(path, args = {}) {
  const graph = await load(path)
  populateAll(graph)
  return dump(createLinter({ preset: args.preset ?? 'recommended' }).lintGraph(graph))
}

export async function convert(path, output) {
  const graph = await load(path)
  populateAll(graph)
  const result = await io.writeDocument('fig', graph)
  await writeFile(output, result.data)
  return dump({ output, bytes: result.data.byteLength })
}

async function fontWarning(graph, roots, format) {
  if (!['png', 'jpg', 'webp', 'pdf'].includes(format)) return
  const status = await prepareGraphFonts(graph, roots)
  if (status.faithful) return
  return `Font substitution: ${status.issues.map((face) => `${face.family} ${face.style}`).join(', ')}`
}

async function writeHtml(graph, target, output) {
  const document = sceneGraphToDesignDocument(graph, {
    rootId: target.scope === 'page' ? target.pageId : target.nodeId,
  })
  const bundle = await exportHTMLBundle(document, {
    html: 'fragment',
    style: 'inline',
    assets: 'inline',
    fonts: 'none',
    assetBasePath: `${basename(output, extname(output))}.assets`,
  })
  const entry = bundle.files.find((file) => file.path === bundle.entrypoint)
  if (!entry) throw new Error(`HTML export did not include ${bundle.entrypoint}`)
  await writeFile(output, entry.content)
  for (const file of bundle.files.filter((item) => item.path !== bundle.entrypoint)) {
    const dest = join(dirname(output), file.path)
    await mkdir(dirname(dest), { recursive: true })
    await writeFile(dest, file.content)
  }
  const bytes =
    typeof entry.content === 'string' ? Buffer.byteLength(entry.content) : entry.content.byteLength
  return { output, bytes }
}

export async function exportDocument(path, args) {
  const format = args.format.toLowerCase()
  if (!FORMATS.has(format)) {
    throw new Error(`Invalid format "${args.format}". Use ${[...FORMATS].join(', ')}.`)
  }

  const graph = await load(path)
  const pages = graph.getPages()
  const page = args.page ? pages.find((item) => item.name === args.page) : pages[0]
  if (!page) {
    const available = pages.map((item) => `"${item.name}"`).join(', ')
    throw new Error(
      args.page
        ? `Page "${args.page}" not found. Available pages: ${available || 'none'}.`
        : 'Document has no pages.',
    )
  }

  const whole = (format === 'fig' || format === 'pptx') && !args.page
  if (whole) populateAll(graph)
  else populatePage(graph, page.id)

  const target = { scope: 'page', pageId: page.id }
  const warning = await fontWarning(graph, whole ? pages.map((item) => item.id) : [page.id], format)
  await mkdir(dirname(args.output), { recursive: true })

  if (format === 'html') {
    return dump({ ...(await writeHtml(graph, target, args.output)), warning })
  }

  let options
  if (format === 'jsx') options = { format: 'openpencil' }
  else if (format === 'fig') options = { renderThumbnail: true }
  else if (RASTER.has(format)) options = { format: format.toUpperCase(), scale: args.scale ?? 1 }

  const result =
    whole && format === 'fig'
      ? await io.writeDocument(format, graph, options)
      : await io.exportContent(
          format,
          { graph, target: whole ? { scope: 'document' } : target },
          options,
        )

  await writeFile(args.output, result.data)
  const bytes =
    typeof result.data === 'string' ? Buffer.byteLength(result.data) : result.data.byteLength
  return dump({ output: args.output, bytes, warning })
}
