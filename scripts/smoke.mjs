import { access } from 'node:fs/promises'
import { resolve } from 'node:path'

import { info } from '../dist/engine.mjs'

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

console.log(`ok ${file} pages=${result.pages} nodes=${result.totalNodes}`)
