import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const fork = resolve(process.env.OPENPENCIL_SRC ?? join(root, '../open-pencil'))
const core = join(fork, 'packages/core')
const exportsMap = JSON.parse(await readFile(join(core, 'package.json'), 'utf8')).exports

function source(entry) {
  if (typeof entry === 'string') return entry
  return entry.bun ?? entry.import ?? entry.default
}

function coreFile(specifier) {
  const sub = specifier === '@open-pencil/core' ? '.' : `./${specifier.slice('@open-pencil/core/'.length)}`
  const mapped = exportsMap[sub]
  if (!mapped) return null
  return join(core, source(mapped).replace('/dist/', '/src/').replace(/\.js$/, '.ts'))
}

await mkdir(join(root, 'dist'), { recursive: true })

await build({
  absWorkingDir: fork,
  entryPoints: [join(root, 'engine.mjs')],
  outfile: join(root, 'dist/engine.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  conditions: ['bun'],
  logLevel: 'info',
  nodePaths: [join(fork, 'node_modules')],
  packages: 'bundle',
  external: ['canvaskit-wasm', 'canvaskit-wasm/full', 'css-tree'],
  plugins: [
    {
      name: 'open-pencil-core-src',
      setup(build) {
        build.onResolve({ filter: /^@open-pencil\/core(?:\/|$)/ }, (args) => {
          const path = coreFile(args.path)
          if (!path) return null
          return { path }
        })
      },
    },
    {
      name: 'vite-raw',
      setup(build) {
        build.onResolve({ filter: /\?raw$/ }, (args) => ({
          path: resolve(args.resolveDir, args.path.replace(/\?raw$/, '')),
          namespace: 'raw',
        }))
        build.onLoad({ filter: /.*/, namespace: 'raw' }, async (args) => ({
          contents: await readFile(args.path, 'utf8'),
          loader: 'text',
        }))
      },
    },
  ],
})
