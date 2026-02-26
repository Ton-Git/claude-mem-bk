# features-export

`features-export` is the standalone packaging area for the **Smart Explore** feature set from Claude-Mem.

This sub-project is intended for users who want the AST-based exploration workflow (`smart_search`, `smart_outline`, `smart_unfold`) and its MCP server wiring without needing to understand the full repository first.

---

## What is in this folder

At minimum, this folder is the dedicated home for feature-export onboarding and distribution docs.

For implementation details, this export is sourced from the following repository components:

- `plugin/skills/smart-explore/SKILL.md` (skill contract and usage workflow)
- `src/services/smart-file-read/` (tree-sitter parsing, search, unfold logic)
- `src/servers/mcp-server.ts` (MCP stdio server and tool registration)
- `plugin/scripts/mcp-server.cjs` (built runtime entrypoint used by MCP clients)

If you are packaging this as a standalone module, these are the core files to mirror into `features-export`.

---

## Prerequisites

- Node.js 18+
- Bun 1.0+ (used by several repository scripts)

Install dependencies from the repository root:

```bash
cd /home/runner/work/claude-mem-bk/claude-mem-bk
npm install
```

---

## Build

From repository root:

```bash
cd /home/runner/work/claude-mem-bk/claude-mem-bk
npm run build
```

This builds the bundled runtime scripts under `plugin/scripts/`, including:

- `plugin/scripts/mcp-server.cjs`
- `plugin/scripts/worker-service.cjs`

---

## Run locally (stdio MCP)

The MCP server depends on the worker API (`http://localhost:37777`) for search/timeline data, so run the worker first.

### 1) Start worker service

```bash
cd /home/runner/work/claude-mem-bk/claude-mem-bk
npm run worker:start
```

Optional health check:

```bash
curl http://localhost:37777/api/health
```

### 2) Start MCP server over stdio

```bash
cd /home/runner/work/claude-mem-bk/claude-mem-bk
node plugin/scripts/mcp-server.cjs
```

> The MCP server communicates over **stdio**. Keep stdout clean for JSON-RPC messages.

---

## VS Code MCP configuration (stdio only)

Use VS Code MCP configuration with a `command` + `args` stdio process.

Create or update your MCP config (for example `.vscode/mcp.json` in your workspace, or your global VS Code MCP config) with:

```json
{
  "servers": {
    "claude-mem-smart-explore": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/home/runner/work/claude-mem-bk/claude-mem-bk/plugin/scripts/mcp-server.cjs"
      ]
    }
  }
}
```

If you installed Claude-Mem through the Claude marketplace instead of running from source, point `args[0]` to your installed path, typically:

- macOS/Linux: `~/.claude/plugins/marketplaces/thedotmack/plugin/scripts/mcp-server.cjs`
- Windows: `C:\\Users\\<you>\\.claude\\plugins\\marketplaces\\thedotmack\\plugin\\scripts\\mcp-server.cjs`

### Recommended environment variables (optional)

If your setup needs non-default worker host/port, add env values in your MCP client configuration:

- `CLAUDE_MEM_HOST`
- `CLAUDE_MEM_PORT`

---

## Typical onboarding flow for new users

1. Install dependencies (`npm install`)
2. Build runtime bundles (`npm run build`)
3. Start worker (`npm run worker:start`)
4. Configure VS Code MCP server in **stdio mode**
5. Restart VS Code / MCP host and verify tools are visible:
   - `smart_search`
   - `smart_outline`
   - `smart_unfold`

---

## Troubleshooting

- **`bun: not found`**: install Bun and re-run worker/test scripts.
- **MCP connects but tools fail**: worker is not running; start with `npm run worker:start`.
- **No MCP connection**: verify `node` path and absolute `mcp-server.cjs` path in config.
- **No results from search/timeline**: confirm worker health at `http://localhost:37777/api/health`.
