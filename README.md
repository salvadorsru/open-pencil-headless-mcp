# OpenPencil headless MCP

Inspect and export OpenPencil `.fig` and `.pen` files from Cursor (or any MCP
client) without opening OpenPencil Desktop and without installing the
`openpencil` CLI.

The server embeds the engine from
[salvadorsru/open-pencil](https://github.com/salvadorsru/open-pencil) in
`dist/engine.mjs`. `npx` only installs Node dependencies from the public npm
registry (`@modelcontextprotocol/server`, `zod`, `canvaskit-wasm`, `css-tree`).
No npm login. No GitHub Packages.

This is not [`@open-pencil/mcp`](https://www.npmjs.com/package/@open-pencil/mcp).
That package is a bridge to a running desktop app. This one reads files on disk.

## Requirements

- Node.js 20+

Raster export (`png`, `jpg`, `webp`, `pdf`) downloads `canvaskit-wasm` the first
time `npx` runs. Nothing else is required on `PATH`.

## Cursor

Add this to `~/.cursor/mcp.json` (or the project `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "open-pencil": {
      "command": "npx",
      "args": ["-y", "github:salvadorsru/open-pencil-headless-mcp"],
      "env": {
        "OPENPENCIL_MCP_ROOT": "/absolute/path/to/your/designs"
      }
    }
  }
}
```

Restart the MCP server after changing this file.

If `npx` keeps an old install that still calls the CLI (`spawn openpencil ENOENT`),
clear the cache and try again:

```sh
npx clear-npx-cache
# or: rm -rf ~/.npm/_npx
```

### Local clone

```json
{
  "mcpServers": {
    "open-pencil": {
      "command": "node",
      "args": ["/absolute/path/to/open-pencil-headless-mcp/server.mjs"],
      "env": {
        "OPENPENCIL_MCP_ROOT": "/absolute/path/to/your/designs"
      }
    }
  }
}
```

## Paths

`OPENPENCIL_MCP_ROOT` is the only directory the tools can read or write. Point it
at the folder that contains your documents. Tool arguments are **relative** to
that root:

| Root | `file` argument |
| --- | --- |
| `/absolute/path/to/your/designs` | `project/file.fig` |
| `/absolute/path/to/your/designs/project` | `file.fig` |

Absolute paths or `../` that escape the root are rejected.

## Tools

Every tool takes `file`. Responses are JSON text.

### `pencil_info`

Document metadata: page count, node counts by type, fonts.

```
file: project/file.fig
```

### `pencil_tree`

Node tree. Optional `page` (name) and `depth`.

```
file: project/file.fig
page: Home
depth: 2
```

Omitting `page` uses the first page. Large `.fig` files can be heavy without
`depth`.

### `pencil_query`

XPath over the document. Optional `page` and `limit` (max 10000).

```
file: project/file.fig
selector: //SECTION[@name='Hero']
page: Home
```

Useful selectors:

```
//FRAME[@name='Header']
//COMPONENT[contains(@name,'Button')]
//TEXT[contains(@name,'Title')]
//*[@name='Hero']
```

Layer names must match the document exactly.

### `pencil_lint`

Quality and accessibility rules. Optional `preset`: `recommended` (default),
`strict`, `accessibility`.

```
file: project/file.fig
preset: recommended
```

### `pencil_export`

Write a derived file **inside the root**.

| Argument | Notes |
| --- | --- |
| `file` | Source `.fig` / `.pen` |
| `format` | `png`, `jpg`, `webp`, `svg`, `pdf`, `pptx`, `jsx`, `html`, `fig` |
| `output` | Relative destination, e.g. `project/exports/hero.png` |
| `page` | Optional page name |
| `scale` | Optional, raster only |

```
file: project/file.fig
format: png
output: project/exports/hero.png
page: Home
scale: 2
```

Missing fonts on raster/PDF are reported as a warning in the JSON (`warn`
policy). HTML writes a fragment plus any sidecar assets next to `output`.

### `pencil_convert`

Write a `.fig` copy.

```
file: project/file.fig
output: project/exports/file.fig
```

## Environment

| Variable | Default | When it applies |
| --- | --- | --- |
| `OPENPENCIL_MCP_ROOT` | process working directory | Runtime. Sandbox for every tool. |
| `OPENPENCIL_SRC` | `../open-pencil` | `bun run bundle` only. Path to the fork checkout. |
| `OPENPENCIL_SMOKE_FILE` | first existing candidate | `bun run test` only. |

There is no `OPENPENCIL_CLI`.

## Develop

The published `npx` payload is `server.mjs` + `dist/engine.mjs`. The source of
the engine is `engine.mjs`; it is bundled from a sibling clone of the fork.

```sh
git clone https://github.com/salvadorsru/open-pencil-headless-mcp.git
git clone https://github.com/salvadorsru/open-pencil.git   # sibling directory
cd open-pencil && bun install
cd ../open-pencil-headless-mcp && bun install
bun run bundle
bun run test
```

`bun run test` runs `info` on `OPENPENCIL_SMOKE_FILE` if set, otherwise the
first existing local `.fig` or `.pen` fixture it finds.

After changing the fork, regenerate and commit `dist/engine.mjs` so GitHub `npx`
picks it up:

```sh
bun run bundle
bun run test
```
