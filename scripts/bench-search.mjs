import { spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const cli = resolve(repo, '../open-pencil/packages/cli/dist/index.mjs')
const file = resolve(
  process.argv[2] ?? process.env.OPENPENCIL_SMOKE_FILE ?? '../pencil/woments/woments.fig',
)

function runNode(args, cwd = repo) {
  const start = performance.now()
  const out = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' })
  const ms = Math.round(performance.now() - start)
  if (out.status !== 0) {
    throw new Error(out.stderr.trim() || out.stdout.trim() || `exit ${out.status}`)
  }
  return { ms, stdout: out.stdout.trim() }
}

function bench(label, args) {
  const { ms } = runNode(args)
  console.log(`${label.padEnd(42)} ${String(ms).padStart(6)} ms`)
  return ms
}

function ratio(base, next) {
  if (base <= 0) return '—'
  const pct = Math.round((1 - next / base) * 100)
  return pct >= 0 ? `${pct}% faster` : `${Math.abs(pct)}% slower`
}

console.log(`file: ${file}\n`)

const legacyFind = bench('CLI find (reload each run)', [
  cli,
  'find',
  file,
  '--name',
  'Mi vida',
  '--limit',
  '1',
])

const modernFindCold = bench('MCP find cold (new process)', [
  '--input-type=module',
  '-e',
  `import { find } from './dist/engine.mjs';
await find(${JSON.stringify(file)}, { name: 'Mi vida', limit: 1 });`,
])

const { ms: modernChainMs, stdout: chainOut } = runNode([
  '--input-type=module',
  '-e',
  `import { performance } from 'node:perf_hooks';
import { find, node } from './dist/engine.mjs';
const file = ${JSON.stringify(file)};
const t0 = performance.now();
const hits = JSON.parse(await find(file, { name: 'Mi vida', limit: 1 }));
const t1 = performance.now();
await node(file, { id: hits[0].id });
const t2 = performance.now();
await find(file, { name: 'Card', page: 'UI Desktop', limit: 5 });
const t3 = performance.now();
console.log(JSON.stringify({
  find: Math.round(t1 - t0),
  node: Math.round(t2 - t1),
  findPage: Math.round(t3 - t2),
}));`,
])

const chain = JSON.parse(chainOut)
console.log(`${'MCP find→node→find (1 session)'.padEnd(42)} ${String(modernChainMs).padStart(6)} ms`)
console.log(`  ├─ find "Mi vida"`.padEnd(42) + ` ${String(chain.find).padStart(6)} ms`)
console.log(`  ├─ node (cached graph)`.padEnd(42) + ` ${String(chain.node).padStart(6)} ms`)
console.log(`  └─ find "Card" UI Desktop`.padEnd(42) + ` ${String(chain.findPage).padStart(6)} ms`)

console.log('\nComparación')
console.log(`  warm find+node vs CLI find:              ${ratio(legacyFind, chain.find + chain.node)}`)
console.log(`  MCP cold find vs CLI find:               ${ratio(legacyFind, modernFindCold)}`)
console.log(`  2ª búsqueda en sesión vs CLI de nuevo:   ${ratio(legacyFind, chain.findPage)}`)
