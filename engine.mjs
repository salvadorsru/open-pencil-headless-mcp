import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'

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
const ROOT = resolve(process.env.OPENPENCIL_MCP_ROOT ?? process.cwd())

/** ponytail: RAM + OPENPENCIL_MCP_ROOT/.cache/pencil (survives npx/MCP restart) */
const docs = new Map()

const INDEX_VERSION = 3
const SHELL = new Set(['SECTION', 'FRAME', 'COMPONENT', 'INSTANCE', 'GROUP'])
const GENERIC = /^(frame|container|rectangle|ellipse|vector|group|line|boolean)(\s+\d+.*)?$/i

function cachePath(path) {
  const rel = relative(ROOT, path)
  const key = rel && !rel.startsWith('..') ? rel : basename(path)
  return join(ROOT, '.cache', 'pencil', `${key}.json`)
}

function pageList(entry) {
  if (entry.index) return entry.index.pages
  return entry.graph.getPages()
}

function genericName(name) {
  return !name?.trim() || GENERIC.test(name.trim())
}

function keepNode(node) {
  if (node.type === 'TEXT') return true
  return SHELL.has(node.type) && !genericName(node.name)
}

function clipText(node) {
  if (!node.text?.length) return 0
  return node.text.length > 200 ? `${node.text.slice(0, 200)}…` : node.text
}

function snapshot(graph, mtimeMs) {
  populateAll(graph)
  const pageIndex = new Map(graph.getPages().map((page, i) => [page.name, i]))
  const kept = {}
  const pageKids = Object.fromEntries(graph.getPages().map((page) => [page.name, []]))
  const types = {}
  const fonts = new Set()
  const pageCounts = {}

  function walk(id, pageName, parentId) {
    const node = graph.getNode(id)
    if (!node) return
    if (keepNode(node)) {
      kept[id] = { node, pageName, parentId, childIds: [] }
      if (parentId && kept[parentId]) kept[parentId].childIds.push(id)
      else pageKids[pageName].push(id)
      for (const childId of node.childIds) walk(childId, pageName, id)
      return
    }
    for (const childId of node.childIds) walk(childId, pageName, parentId)
  }

  for (const page of graph.getPages()) {
    for (const childId of page.childIds) walk(childId, page.name, 0)
    pageCounts[page.name] = 0
  }

  const nodes = {}
  for (const [id, item] of Object.entries(kept)) {
    const { node, pageName, parentId, childIds } = item
    types[node.type] = (types[node.type] ?? 0) + 1
    if (node.fontFamily) fonts.add(node.fontFamily)
    pageCounts[pageName] += 1
    nodes[id] = [
      node.name,
      node.type,
      pageIndex.get(pageName),
      parentId || 0,
      childIds,
      Math.round(node.x),
      Math.round(node.y),
      Math.round(node.width),
      Math.round(node.height),
      clipText(node),
      node.fontFamily || 0,
      node.fontSize || 0,
      node.fontWeight || 0,
    ]
  }

  const pages = graph.getPages().map((page) => ({
    id: page.id,
    name: page.name,
    type: page.type,
    childIds: pageKids[page.name],
  }))

  return {
    v: INDEX_VERSION,
    mtimeMs,
    pages,
    nodes,
    info: {
      pages: pages.length,
      totalNodes: Object.keys(nodes).length,
      types,
      fonts: [...fonts].sort(),
      pageCounts,
    },
  }
}

function hydrate(index) {
  if (index.byName) return index
  const pages = index.pages
  const live = {}
  const names = new Set()
  const byName = new Map()
  const byPage = Object.fromEntries(pages.map((page) => [page.name, []]))

  for (const [id, row] of Object.entries(index.nodes)) {
    const name = row[0]
    const page = pages[row[2]]?.name
    const childIds = row[4]
    const node = {
      id,
      name,
      type: row[1],
      page,
      parentId: row[3] || undefined,
      childIds,
      x: row[5],
      y: row[6],
      width: row[7],
      height: row[8],
      text: row[9] || null,
      fontFamily: row[10] || undefined,
      fontSize: row[11] || undefined,
      fontWeight: row[12] || undefined,
      children: childIds.length,
      nameLower: name.toLowerCase(),
    }
    live[id] = node
    if (name) names.add(name)
    const group = byName.get(node.nameLower)
    if (group) group.push(node)
    else byName.set(node.nameLower, [node])
    if (page) byPage[page].push(node)
  }

  index.nodes = live
  index.names = names
  index.byName = byName
  index.byPage = byPage
  return index
}

async function readIndex(path, mtimeMs) {
  try {
    const data = JSON.parse(await readFile(cachePath(path), 'utf8'))
    if (data.v !== INDEX_VERSION || data.mtimeMs !== mtimeMs || !data.nodes || !data.pages) {
      return null
    }
    return hydrate(data)
  } catch {
    return null
  }
}

async function writeIndex(path, index) {
  const dest = cachePath(path)
  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, JSON.stringify(index))
}

function entryFromIndex(path, mtimeMs, index) {
  return {
    path,
    mtimeMs,
    graph: undefined,
    index,
    whole: true,
    pages: new Set(index.pages.map((page) => page.id)),
    laid: new Set(),
    laidAll: false,
    names: index.names,
  }
}

function dump(value) {
  return JSON.stringify(value)
}

function pageName(args) {
  return typeof args?.page === 'string' ? args.page : undefined
}

async function readGraph(path) {
  const { graph } = await io.readDocument({
    name: path,
    data: new Uint8Array(await readFile(path)),
  })
  return graph
}

function layout(entry, pageId) {
  if (pageId) {
    if (entry.laid.has(pageId)) return
    computeAllLayouts(entry.graph, pageId)
    entry.laid.add(pageId)
    return
  }
  if (entry.laidAll) return
  computeAllLayouts(entry.graph)
  entry.laidAll = true
  for (const page of entry.graph.getPages()) entry.laid.add(page.id)
}

export async function load(path) {
  const entry = await open(path)
  await ensureGraph(entry)
  return entry.graph
}

export async function warm(path) {
  const entry = await open(path)
  await ensureGraph(entry)
}

async function ensureGraph(entry, pageName) {
  if (!entry.graph) {
    entry.loading ??= readGraph(entry.path).then((graph) => {
      entry.graph = graph
      entry.whole = false
      entry.pages = new Set()
      entry.loading = undefined
      return graph
    })
    await entry.loading
  }
  if (!pageName) {
    touchAll(entry)
    return entry.graph
  }
  const page = entry.graph.getPages().find((item) => item.name === pageName)
  if (page) touchPage(entry, page.id)
  else touchAll(entry)
  return entry.graph
}

async function open(path) {
  const { mtimeMs } = await stat(path)
  const cached = docs.get(path)
  if (cached && cached.mtimeMs === mtimeMs) return cached

  const index = await readIndex(path, mtimeMs)
  if (index) {
    const entry = entryFromIndex(path, mtimeMs, index)
    docs.set(path, entry)
    return entry
  }

  const graph = await readGraph(path)
  const built = snapshot(graph, mtimeMs)
  await writeIndex(path, built).catch(() => {})
  hydrate(built)
  const entry = {
    path,
    mtimeMs,
    graph,
    index: built,
    whole: true,
    pages: new Set(graph.getPages().map((page) => page.id)),
    laid: new Set(),
    laidAll: false,
    names: built.names,
  }
  docs.set(path, entry)
  return entry
}

function resolvePage(entry, hint) {
  if (!hint) return undefined
  const pages = pageList(entry)
  const exact = pages.find((page) => page.name === hint)
  if (exact) return exact.name

  const lower = hint.trim().toLowerCase()
  const fuzzy = pages.find((page) => page.name.toLowerCase().includes(lower))
  if (fuzzy) return fuzzy.name

  const available = pages.map((page) => `"${page.name}"`).join(', ')
  throw new Error(`Page "${hint}" not found. Available pages: ${available || 'none'}.`)
}

function nameMatches(names, pattern) {
  const needle = pattern.toLowerCase()
  for (const name of names) {
    if (name.toLowerCase().includes(needle)) return true
  }
  return false
}

function suggestNames(names, pattern, limit = 8) {
  const parts = pattern
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  const scored = [...names]
    .map((name) => {
      const lower = name.toLowerCase()
      let score = 0
      for (const part of parts) {
        if (lower.includes(part)) score += 1
      }
      return { name, score }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  return scored.slice(0, limit).map((item) => item.name)
}

function findHint(entry, args, meta) {
  const lines = []
  if (meta.pageResolved && meta.pageResolved !== args.page) {
    lines.push(`Page "${args.page}" resolved to "${meta.pageResolved}".`)
  }
  if (args.name && !nameMatches(entry.names, args.name)) {
    const suggestions = suggestNames(entry.names, args.name)
    if (suggestions.length > 0) {
      lines.push(
        `No layer name contains "${args.name}". Similar layers: ${suggestions.map((name) => `"${name}"`).join(', ')}.`,
      )
    } else {
      lines.push(`No layer name contains "${args.name}" in the loaded document index.`)
    }
  }
  return lines.join('\n')
}

function findFromIndex(entry, args) {
  const cap = args.limit ?? 100
  const needle = args.name?.toLowerCase()
  const typeFilter = args.type?.toUpperCase()
  const pageFilter = args.page
  const results = []
  const pool = needle
    ? namePool(entry.index.byName, needle)
    : pageFilter
      ? entry.index.byPage[pageFilter] ?? []
      : Object.values(entry.index.nodes)

  for (const node of pool) {
    if (pageFilter && node.page !== pageFilter) continue
    if (typeFilter && node.type !== typeFilter) continue
    results.push({
      id: node.id,
      name: node.name,
      type: node.type,
      width: node.width,
      height: node.height,
    })
    if (results.length >= cap) break
  }
  return results
}

function namePool(byName, needle) {
  const exact = byName.get(needle)
  if (exact) return exact
  const out = []
  for (const [name, group] of byName) {
    if (name.includes(needle)) out.push(...group)
  }
  return out
}

function styleOf(node) {
  return {
    fills: node.fills,
    strokes: node.strokes,
    effects: node.effects,
    opacity: node.opacity,
    cornerRadius: node.cornerRadius,
    padding: {
      top: node.paddingTop,
      right: node.paddingRight,
      bottom: node.paddingBottom,
      left: node.paddingLeft,
    },
    gap: node.itemSpacing,
    counterGap: node.counterAxisSpacing,
    layoutMode: node.layoutMode,
    layoutWrap: node.layoutWrap,
    layoutDirection: node.layoutDirection,
    primaryAxisAlign: node.primaryAxisAlign,
    counterAxisAlign: node.counterAxisAlign,
    clipsContent: node.clipsContent,
    blendMode: node.blendMode,
    fontFamily: node.fontFamily,
    fontSize: node.fontSize,
    fontWeight: node.fontWeight,
    lineHeight: node.lineHeight,
    letterSpacing: node.letterSpacing,
    textAlignHorizontal: node.textAlignHorizontal,
  }
}

function inspectNode(graph, id) {
  const node = graph.getNode(id)
  if (!node) return { error: `Node "${id}" not found` }
  const parent = node.parentId ? graph.getNode(node.parentId) : undefined
  const boundVariables = {}
  for (const [field, varId] of Object.entries(node.boundVariables ?? {})) {
    const variable = graph.variables.get(varId)
    boundVariables[field] = variable?.name ?? varId
  }
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    x: Math.round(node.x),
    y: Math.round(node.y),
    width: Math.round(node.width),
    height: Math.round(node.height),
    visible: node.visible,
    locked: node.locked,
    rotation: node.rotation,
    text: node.text?.length
      ? node.text.length > 200
        ? `${node.text.slice(0, 200)}…`
        : node.text
      : null,
    parent: parent ? { id: parent.id, name: parent.name, type: parent.type } : null,
    children: node.childIds.length,
    boundVariables,
    ...styleOf(node),
  }
}

function treeFromIndex(entry, args) {
  const pages = entry.index.pages
  const maxDepth = args.depth ?? Infinity
  const name = args.page ? resolvePage(entry, args.page) : pages[0]?.name
  const page = pages.find((item) => item.name === name)
  if (!page) {
    return {
      error: `Page "${args.page}" not found. Available: ${pages.map((item) => item.name).join(', ')}`,
    }
  }

  function build(id, depth) {
    const node = entry.index.nodes[id]
    if (!node) return null
    const result = {
      id: node.id,
      name: node.name,
      type: node.type,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    }
    if (node.childIds.length > 0 && depth < maxDepth) {
      result.children = node.childIds.map((childId) => build(childId, depth + 1)).filter(Boolean)
    }
    return result
  }

  return {
    page: { id: page.id, name: page.name, type: page.type },
    children: page.childIds.map((id) => build(id, 0)).filter(Boolean),
  }
}

function pagesFromIndex(entry) {
  return entry.index.pages.map((page) => ({
    id: page.id,
    name: page.name,
    nodes: entry.index.info.pageCounts[page.name] ?? 0,
  }))
}

const SECTION_RANK = {
  SECTION: 0,
  FRAME: 1,
  COMPONENT: 2,
  INSTANCE: 3,
  GROUP: 4,
  TEXT: 9,
}

function ancestry(entry, node) {
  const names = [node.name]
  let id = node.parentId
  while (id) {
    const parent = entry.index.nodes[id]
    if (!parent) break
    names.unshift(parent.name)
    id = parent.parentId
  }
  names.unshift(node.page)
  return names
}

function textsUnder(entry, id, out = []) {
  const node = entry.index.nodes[id]
  if (!node) return out
  if (node.type === 'TEXT' && node.text) {
    out.push({
      id: node.id,
      name: node.name,
      text: node.text,
      fontFamily: node.fontFamily,
      fontSize: node.fontSize,
      fontWeight: node.fontWeight,
    })
  }
  for (const childId of node.childIds) textsUnder(entry, childId, out)
  return out
}

function pickSection(entry, hits, within) {
  let pool = hits.map((hit) => entry.index.nodes[hit.id]).filter(Boolean)
  if (within) {
    const needle = within.toLowerCase()
    const scoped = pool.filter((node) =>
      ancestry(entry, node).some((name) => name.toLowerCase().includes(needle)),
    )
    if (scoped.length > 0) pool = scoped
  }
  pool.sort((a, b) => (SECTION_RANK[a.type] ?? 8) - (SECTION_RANK[b.type] ?? 8))
  return pool[0]
}

function describeSection(entry, node, graph) {
  const live = graph?.getNode(node.id)
  const texts = textsUnder(entry, node.id).map((item) => {
    const textNode = graph?.getNode(item.id)
    return textNode ? { ...item, ...styleOf(textNode) } : item
  })
  return {
    page: node.page,
    id: node.id,
    name: node.name,
    type: node.type,
    box: { x: node.x, y: node.y, width: node.width, height: node.height },
    path: ancestry(entry, node),
    style: live ? styleOf(live) : undefined,
    texts,
    children: node.childIds
      .map((id) => entry.index.nodes[id])
      .filter(Boolean)
      .map((child) => ({ id: child.id, name: child.name, type: child.type })),
  }
}

async function rpcSection(path, args) {
  const entry = await open(path)
  const search = { name: args.name, page: args.page, limit: args.limit ?? 20 }
  const meta = { pageResolved: undefined }
  if (search.page) {
    meta.pageResolved = resolvePage(entry, search.page)
    search.page = meta.pageResolved
  }
  const hits = findFromIndex(entry, search)
  const node = pickSection(entry, hits, args.within)
  if (!node) {
    const hint = findHint(entry, args, meta)
    return dump({ results: [], hint, searched: search })
  }
  await ensureGraph(entry, search.page || node.page)
  return dump(describeSection(entry, node, entry.graph))
}

export function populatePage(graph, pageId) {
  populateLazyFigImportRoots(graph, [pageId])
}

export function populateAll(graph) {
  populateAllLazyFigImportRoots(graph)
}

function touchPage(entry, pageId) {
  if (entry.whole || entry.pages.has(pageId)) return
  populatePage(entry.graph, pageId)
  entry.pages.add(pageId)
}

function touchAll(entry) {
  if (entry.whole) return
  populateAll(entry.graph)
  entry.whole = true
  for (const page of entry.graph.getPages()) entry.pages.add(page.id)
}

function touchForCommand(entry, command, args) {
  if (command === 'pages' || command === 'variables') return
  if (command === 'tree') {
    const pages = entry.graph.getPages()
    const name = pageName(args)
    const page = name ? pages.find((item) => item.name === name) : pages[0]
    if (page) touchPage(entry, page.id)
    return
  }
  if (command === 'find') return
  if (command === 'query') {
    const name = pageName(args)
    if (name) {
      const page = entry.graph.getPages().find((item) => item.name === name)
      if (page) touchPage(entry, page.id)
    }
    return
  }
  if (command === 'node') {
    const id = args?.id
    if (typeof id === 'string' && entry.graph.getNode(id)) return
    touchAll(entry)
    return
  }
  touchAll(entry)
}

async function runRpc(entry, command, args) {
  touchForCommand(entry, command, args)
  const result = await executeRPCCommand(entry.graph, command, args)
  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error(result.error)
  }
  return result
}

async function pagedRpc(entry, command, args) {
  const cap = args.limit ?? 100
  const merged = []

  for (const page of entry.graph.getPages()) {
    touchPage(entry, page.id)
    const batch = await runRpc(entry, command, {
      ...args,
      page: page.name,
      limit: cap - merged.length,
    })
    if (!Array.isArray(batch)) return batch
    merged.push(...batch)
    if (merged.length >= cap) break
  }

  return merged.slice(0, cap)
}

async function rpcFind(path, args) {
  const entry = await open(path)
  const search = { ...args }
  const meta = { pageResolved: undefined }

  if (search.page) {
    meta.pageResolved = resolvePage(entry, search.page)
    search.page = meta.pageResolved
  }

  const result = findFromIndex(entry, search)
  if (Array.isArray(result) && result.length === 0) {
    const hint = findHint(entry, args, meta)
    if (hint) return dump({ results: [], hint, searched: search })
  }
  return dump(result)
}

async function rpc(path, command, args) {
  if (command === 'find') return rpcFind(path, args)
  const entry = await open(path)
  if (entry.index) {
    if (command === 'info') return dump(entry.index.info)
    if (command === 'pages') return dump(pagesFromIndex(entry))
    if (command === 'node') {
      const page = entry.index.nodes[args.id]?.page
      await ensureGraph(entry, page)
      let result = inspectNode(entry.graph, args.id)
      if (result.error) {
        await ensureGraph(entry)
        result = inspectNode(entry.graph, args.id)
      }
      if (result.error) throw new Error(result.error)
      return dump(result)
    }
    if (command === 'tree') {
      const result = treeFromIndex(entry, args)
      if (result.error) throw new Error(result.error)
      return dump(result)
    }
  }
  await ensureGraph(entry)
  const paged = command === 'query' && !pageName(args)
  const result = paged ? await pagedRpc(entry, command, args) : await runRpc(entry, command, args)
  return dump(result)
}

export function prepare(graph, command, args) {
  const entry = { graph, whole: false, pages: new Set() }
  touchForCommand(entry, command, args)
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

export function section(path, args) {
  return rpcSection(path, args)
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

export async function analyze(path, args) {
  const entry = await open(path)
  await ensureGraph(entry)
  touchAll(entry)
  layout(entry)
  return dump(
    await executeRPCCommand(entry.graph, `analyze_${args.kind}`, {
      threshold: args.threshold,
      similar: args.similar,
      limit: args.limit,
      minSize: args.minSize,
      minCount: args.minCount,
      scope: args.scope,
      severity: args.severity,
      categories: args.categories,
      minRatio: args.minRatio,
    }),
  )
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
  const entry = await open(path)
  await ensureGraph(entry)
  touchAll(entry)
  layout(entry)
  return dump(createLinter({ preset: args.preset ?? 'recommended' }).lintGraph(entry.graph))
}

export async function convert(path, output) {
  const entry = await open(path)
  await ensureGraph(entry)
  touchAll(entry)
  layout(entry)
  const result = await io.writeDocument('fig', entry.graph)
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

  const entry = await open(path)
  await ensureGraph(entry)
  const pages = entry.graph.getPages()
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
  if (whole) {
    touchAll(entry)
    layout(entry)
  } else {
    touchPage(entry, page.id)
    layout(entry, page.id)
  }

  const target = { scope: 'page', pageId: page.id }
  const warning = await fontWarning(
    entry.graph,
    whole ? pages.map((item) => item.id) : [page.id],
    format,
  )
  await mkdir(dirname(args.output), { recursive: true })

  if (format === 'html') {
    return dump({ ...(await writeHtml(entry.graph, target, args.output)), warning })
  }

  let options
  if (format === 'jsx') options = { format: 'openpencil' }
  else if (format === 'fig') options = { renderThumbnail: true }
  else if (RASTER.has(format)) options = { format: format.toUpperCase(), scale: args.scale ?? 1 }

  const result =
    whole && format === 'fig'
      ? await io.writeDocument(format, entry.graph, options)
      : await io.exportContent(
          format,
          { graph: entry.graph, target: whole ? { scope: 'document' } : target },
          options,
        )

  await writeFile(args.output, result.data)
  const bytes =
    typeof result.data === 'string' ? Buffer.byteLength(result.data) : result.data.byteLength
  return dump({ output: args.output, bytes, warning })
}
