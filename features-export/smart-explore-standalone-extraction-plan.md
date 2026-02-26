# Smart Explore Standalone Extraction Plan

## Goal

Extract Smart Explore into a standalone project that preserves feature parity for:
- `smart_search`
- `smart_outline`
- `smart_unfold`

while minimizing coupling to claude-mem internals.

## Non-goals

- Rebuilding claude-mem memory features (`search`, `timeline`, observation APIs).
- Migrating viewer UI, worker service, or SQLite systems.
- Carrying over generated artifacts (`plugin/scripts/*.cjs`) as source.

## Source-of-truth modules to extract

Primary code:
- `/home/runner/work/claude-mem-bk/claude-mem-bk/src/services/smart-file-read/parser.ts`
- `/home/runner/work/claude-mem-bk/claude-mem-bk/src/services/smart-file-read/search.ts`

Integration adapter to recreate in new repo:
- Smart tool wiring currently in `/home/runner/work/claude-mem-bk/claude-mem-bk/src/servers/mcp-server.ts`

Documentation/prompt assets to migrate:
- `/home/runner/work/claude-mem-bk/claude-mem-bk/plugin/skills/smart-explore/SKILL.md`
- `/home/runner/work/claude-mem-bk/claude-mem-bk/docs/public/smart-explore-benchmark.mdx`

## Target standalone architecture (proposed solution)

Use a **library-first monorepo layout**:

- `packages/core`
  - parser and search logic (portable library)
- `packages/mcp-server`
  - MCP tool surface exposing `smart_search`, `smart_outline`, `smart_unfold`
- `packages/docs` (optional)
  - benchmark and usage docs

## Phase-by-phase implementation plan

### Phase 1 — Bootstrap standalone repository

1. Initialize repo with a **Node-only** toolchain (Node 20+).
2. Add TypeScript build config and scripts.
3. Add dependencies:
   - `@modelcontextprotocol/sdk` (if exposing MCP server)
   - `tree-sitter-cli`
   - language grammars currently used by parser
4. Add CI workflow for build + tests using **Node/npm only** (no Bun).

Deliverable:
- Clean repo building successfully with placeholder server and tool registration.

### Phase 2 — Extract Smart Explore core engine

1. Copy `parser.ts` and `search.ts` into core package with minimal edits.
2. Replace any claude-mem-specific import paths with local package paths.
3. Keep existing interfaces (`CodeSymbol`, `FoldedFile`, `SearchResult`, `SymbolMatch`) to preserve contract.
4. Add configuration seam for:
   - ignored directories
   - supported extensions
   - file size limit
   (defaulting to current values for parity)

Deliverable:
- Core library can parse files and return folded outputs from a simple script.

### Phase 3 — Rebuild MCP adapter layer

1. Implement MCP server exposing exactly three tools:
   - `smart_search`
   - `smart_outline`
   - `smart_unfold`
2. Reuse current input schema shape for backward compatibility.
3. Keep response formatting compatible with existing Smart Explore output style.
4. Add robust error handling for:
   - unsupported languages
   - missing symbols
   - unreadable files
   - missing tree-sitter CLI/grammars

Deliverable:
- End-to-end MCP server runnable with Smart Explore feature only.

### Phase 4 — Test parity and correctness

1. Add unit tests for parser:
   - symbol extraction per language
   - method nesting behavior
   - export detection heuristics
2. Add unit tests for search:
   - directory walking and ignores
   - scoring/ranking behavior
   - `filePattern` filtering
3. Add integration tests for MCP tools:
   - schema validation
   - deterministic outputs for fixture files
4. Add regression fixtures for long symbols to validate non-truncation behavior.

Deliverable:
- Test suite demonstrating behavioral parity with current implementation intent.

### Phase 5 — Packaging and distribution

1. Publish as npm package(s) or release binary artifacts.
2. Add installation guide covering tree-sitter CLI + grammar requirements.
3. Add environment diagnostics command (`doctor`) to validate runtime dependencies.
4. Document migration path for users currently relying on claude-mem integrated Smart Explore.

Deliverable:
- Installable standalone Smart Explore with clear setup and support docs.

### Phase 6 — Benchmark re-validation

1. Port the benchmark methodology from `smart-explore-benchmark.mdx`.
2. Re-run A/B tests in standalone environment.
3. Update benchmark report with new numbers and caveats.
4. Verify that claims in docs align with measured results.

Deliverable:
- Standalone benchmark report and confidence in performance claims.

## Detailed work breakdown (engineering tasks)

### Core extraction tasks

- [ ] Create `core/parser.ts` and `core/search.ts` from source modules.
- [ ] Introduce `core/config.ts` for defaults and override hooks.
- [ ] Ensure temp-file lifecycle and cleanup behavior remains intact.
- [ ] Preserve query cache and grammar resolution logic.

### MCP server tasks

- [ ] Implement tool registry with current tool names and schemas.
- [ ] Add structured error responses matching MCP expectations.
- [ ] Add path normalization and safe file read guards.

### Test tasks

- [ ] Build fixture corpus (TS/JS/Python/Go/Rust minimal examples).
- [ ] Add snapshot tests for folded output formatting.
- [ ] Add unfold completeness tests on large method fixtures.

### Documentation tasks

- [ ] Port Smart Explore skill guide into standalone docs.
- [ ] Add “when to use Smart Explore vs full-agent synthesis” guidance.
- [ ] Include troubleshooting for missing grammars and CLI path issues.

## Migration strategy (selected)

### Library-first extraction (selected)

- Extract core library first, then build MCP adapter on top.
- Define stable APIs and tests before packaging.
- Keep runtime and developer workflows Node-only (npm scripts and Node execution).

Pros: cleaner architecture, better long-term maintainability, easier future reuse.
Tradeoff: slightly longer initial effort.

## Acceptance criteria for standalone project

1. `smart_search` finds and ranks symbols across supported languages.
2. `smart_outline` returns complete structural map for supported files.
3. `smart_unfold` returns full symbol source without truncation.
4. Setup docs allow a fresh user to run the MCP server successfully.
5. Tests cover critical parser/search/unfold behavior.
6. Benchmarks are reproducible and documented.

## Estimated effort

- Phase 1-3 (MVP extraction): **2-4 engineering days**
- Phase 4 (test hardening): **2-3 days**
- Phase 5-6 (distribution + benchmarking): **2-4 days**

Total: **~1.5 to 2 weeks** for production-ready standalone extraction.

## Immediate next actions

1. Create the standalone repository skeleton and CI.
2. Copy `parser.ts` and `search.ts` unchanged and run initial smoke tests.
3. Implement minimal MCP server with three tool endpoints.
4. Build fixture-based tests before optimization/refactoring.
