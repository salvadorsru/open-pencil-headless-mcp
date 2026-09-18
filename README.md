# OpenPencil headless MCP

MCP server that inspects and exports OpenPencil `.fig` and `.pen` files through
the [OpenPencil](https://github.com/salvadorsru/open-pencil) engine, without
opening OpenPencil Desktop or installing the CLI.

The engine from the fork is bundled in `dist/engine.mjs`. File paths are confined
to `OPENPENCIL_MCP_ROOT`.

## Requirements

- Node.js 20+

Raster export (`png`, `jpg`, `webp`, `pdf`) uses `canvaskit-wasm` from npm. `npx`
installs it automatically; no login required.

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

`OPENPENCIL_MCP_ROOT` is the only directory the tools can read or write. Point it
at the folder that contains your `.fig` / `.pen` files, then pass paths relative
to that root (for example `woments/woments.fig`).

To use a local clone instead of `npx`:

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

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENPENCIL_MCP_ROOT` | process working directory | Allowed design directory |
| `OPENPENCIL_SRC` | `../open-pencil` | Fork checkout used only when regenerating the bundle |

## Tools

- `pencil_info` — document metadata, pages, fonts
- `pencil_tree` — node tree (`page`, `depth`)
- `pencil_query` — XPath search (`page`, `limit`)
- `pencil_lint` — presets `recommended`, `strict`, `accessibility`
- `pencil_export` — `png`, `jpg`, `webp`, `svg`, `pdf`, `pptx`, `jsx`, `html`, `fig`
- `pencil_convert` — convert to `.fig`

## Regenerate the engine

After changing the local OpenPencil fork:

```sh
cd ../open-pencil   # optional: bun run build:packages
cd ../open-pencil-headless-mcp
bun run bundle
bun run test
```

This is not the official [`@open-pencil/mcp`](https://www.npmjs.com/package/@open-pencil/mcp)
package. That server talks to the desktop app. This one runs the bundled engine
against a sandboxed folder.
