# OpenPencil headless MCP

MCP server that inspects and exports OpenPencil `.fig` and `.pen` files through the
[OpenPencil CLI](https://github.com/open-pencil/open-pencil), without opening OpenPencil Desktop.

It is a small wrapper around these CLI commands: `info`, `tree`, `query`, `lint`, `export`, and `convert`.
All file paths are confined to `OPENPENCIL_MCP_ROOT`.

## Requirements

- Node.js 20+
- OpenPencil CLI on your `PATH` (`bun add -g @open-pencil/cli`), or `OPENPENCIL_CLI` pointing at the binary

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

`OPENPENCIL_MCP_ROOT` is the only directory the tools can read or write. Point it at the folder that contains your `.fig` / `.pen` files, then pass paths relative to that root (for example `woments/woments.fig`).

To use a local clone instead of `npx`:

```json
{
  "mcpServers": {
    "open-pencil": {
      "command": "node",
      "args": ["/absolute/path/to/open-pencil-headless-mcp/server.mjs"],
      "env": {
        "OPENPENCIL_MCP_ROOT": "/absolute/path/to/your/designs",
        "OPENPENCIL_CLI": "openpencil"
      }
    }
  }
}
```

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENPENCIL_MCP_ROOT` | process working directory | Allowed design directory |
| `OPENPENCIL_CLI` | `openpencil` | CLI binary or path |

## Tools

- `pencil_info` — document metadata, pages, fonts
- `pencil_tree` — node tree (`page`, `depth`)
- `pencil_query` — XPath search (`page`, `limit`)
- `pencil_lint` — presets `recommended`, `strict`, `accessibility`
- `pencil_export` — `png`, `jpg`, `webp`, `svg`, `pdf`, `pptx`, `jsx`, `html`, `fig`
- `pencil_convert` — convert to `.fig`

This is not the official [`@open-pencil/mcp`](https://www.npmjs.com/package/@open-pencil/mcp) package. That server exposes many more tools, including live editor control. This one only runs the CLI in headless mode against a sandboxed folder.
