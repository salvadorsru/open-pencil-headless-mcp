import { access } from 'node:fs/promises'
import { resolve } from 'node:path'

import { info, section } from '../dist/engine.mjs'

const candidates = [
  process.argv[2],
  process.env.OPENPENCIL_SMOKE_FILE,
  '../pencil/woments/woments.fig',
  '../open-pencil/tests/fixtures/pencil_simple.pen',
].filter(Boolean)

async function first() {
  for (const candidate of candidates) {
    const path = resolve(candidate)
    try {
      await access(path)
      return path
    } catch {
      continue
    }
  }
  throw new Error(`No smoke document found. Tried: ${candidates.join(', ')}`)
}

const file = await first()
const result = JSON.parse(await info(file))

if (typeof result.pages !== 'number' || typeof result.totalNodes !== 'number') {
  throw new Error(`Unexpected info payload: ${JSON.stringify(result)}`)
}

const block = JSON.parse(await section(file, { name: 'Hero', limit: 5 }))
if (block.id) {
  if (!Array.isArray(block.texts) || !Array.isArray(block.path)) {
    throw new Error(`Unexpected section payload: ${JSON.stringify(block)}`)
  }
} else if (!Array.isArray(block.results)) {
  throw new Error(`Unexpected section miss: ${JSON.stringify(block)}`)
}

console.log(
  block.id
    ? `ok ${file} pages=${result.pages} nodes=${result.totalNodes} section=${block.id} texts=${block.texts.length}`
    : `ok ${file} pages=${result.pages} nodes=${result.totalNodes} section=none`,
)
