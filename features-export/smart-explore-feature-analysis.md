# Smart Explore Feature Analysis

## Scope and method

This analysis covers every repository file with direct references to Smart Explore naming (`smart-explore`, `smart_search`, `smart_outline`, `smart_unfold`, `smart-file-read`) and the core implementation modules those references depend on.

## Smart Explore reference inventory

| File | Reference type | Why it matters |
|---|---|---|
| `src/servers/mcp-server.ts` | Runtime tool registration and handlers | Exposes Smart Explore as MCP tools and wires request handling |
| `src/services/smart-file-read/search.ts` | Core search implementation | Implements codebase traversal, matching, ranking, and Smart Search response format |
| `src/services/smart-file-read/parser.ts` | Core parser and unfold engine | Implements tree-sitter parsing, folded outlines, and symbol unfolding |
| `plugin/skills/smart-explore/SKILL.md` | Agent behavior contract | Defines how agents should use Smart Explore tools |
| `scripts/build-hooks.js` | Build/distribution integration | Verifies Smart Explore skill is included in distributable plugin |
| `docs/public/smart-explore-benchmark.mdx` | Product/benchmark documentation | Documents performance claims and intended usage boundaries |
| `docs/public/docs.json` | Docs navigation integration | Publishes Smart Explore benchmark in docs sidebar |
| `CHANGELOG.md` | Release history references | Captures rollout timeline and claim evolution |
| `plugin/scripts/mcp-server.cjs` | Built artifact mirror | Generated output containing transpiled Smart Explore runtime (not source of truth) |

## Architecture overview

Smart Explore is implemented as a **3-layer code exploration pipeline** exposed from the MCP server:

1. **`smart_search`** (discovery): scans a directory and returns ranked symbol matches plus folded file views.
2. **`smart_outline`** (structure): parses one file and returns symbol signatures with bodies collapsed.
3. **`smart_unfold`** (precision): returns full source for a single symbol using AST-derived ranges.

### Entry point: MCP tool surface

In `src/servers/mcp-server.ts`, Smart Explore is integrated as three tool definitions in the `tools` array:

- `smart_search` calls `searchCodebase(...)` and `formatSearchResults(...)` from `src/services/smart-file-read/search.ts`.
- `smart_outline` reads file content and uses `parseFile(...)` + `formatFoldedView(...)` from `src/services/smart-file-read/parser.ts`.
- `smart_unfold` reads file content and uses `unfoldSymbol(...)`, with fallback listing from `parseFile(...)` when a symbol cannot be found.

This means Smart Explore is currently **coupled to the broader MCP server process** rather than isolated as a standalone package/module boundary.

## Core implementation analysis

### 1) `src/services/smart-file-read/search.ts`

Responsibilities:
- Recursively walks directories with ignore rules (`IGNORE_DIRS`), extension filtering (`CODE_EXTENSIONS`), and file-size safeguards (`MAX_FILE_SIZE`).
- Reads candidate files safely and batches them into parser input.
- Uses parser batch mode (`parseFilesBatch`) for speed.
- Scores relevance by symbol name, signature, JSDoc, and path match.
- Produces token-estimated folded responses designed for LLM consumption.

Important behavior details:
- Query tokenization supports separators (`[\s_\-./]+`) to improve matching flexibility.
- Matching is a hybrid of exact/substring/fuzzy ordering.
- File inclusion can be narrowed via `filePattern`.
- Output always pushes users toward selective expansion (`smart_unfold`) rather than full-file reads.

Extraction implications:
- This module is mostly self-contained but depends on parser types/functions and Node FS/Path APIs.
- Ignore lists and extension sets are product choices that should be preserved or made configurable in a standalone extraction.

### 2) `src/services/smart-file-read/parser.ts`

Responsibilities:
- Detects language from extension.
- Resolves tree-sitter grammars from installed packages.
- Builds and caches query files (`.scm`) for language-specific AST captures.
- Executes tree-sitter CLI queries (single-file and batch).
- Converts captures into normalized symbols (`CodeSymbol`) and folded file models (`FoldedFile`).
- Extracts comments/docstrings and export semantics.
- Supports symbol unfolding with leading comment/decorator inclusion.

Important behavior details:
- Uses CLI invocation (`tree-sitter query`) instead of native bindings.
- Uses temporary source/query files and cleans them after processing.
- Supports multiple languages through `LANG_MAP` and `GRAMMAR_PACKAGES`.
- Includes container nesting (methods under classes/structs/traits/impl).
- Folded token estimates are heuristic (`Math.ceil(folded.length / 4)`).

Extraction implications:
- This is the true Smart Explore engine and can be extracted with minimal changes.
- Main hard dependency is tree-sitter grammar package resolution and CLI availability.
- Runtime portability depends on preserving binary and grammar installation strategy.

## Prompting and UX layer analysis

### `plugin/skills/smart-explore/SKILL.md`

This file defines Smart Explore usage policy for agents:
- Prefer Smart Explore tools over Grep/Glob/Read for code structure tasks.
- Enforce discovery-first workflow.
- Clarify when to escalate to classic exploration or full synthesis.
- Provide token economics and practical examples.

Extraction implications:
- This is not runtime code, but it is essential to preserving user/agent behavior quality.
- Should be carried over as product documentation or a packaged prompt contract.

### `docs/public/smart-explore-benchmark.mdx` + `docs/public/docs.json`

These files are product-level documentation and navigation metadata:
- Contain the benchmark claims (cost/speed/completeness tradeoffs).
- Position Smart Explore vs Explore agent and describe hybrid usage.

Extraction implications:
- Benchmarks should move with feature extraction to support adoption and validation.
- Claims should be re-verified in the standalone repo because token/runtime characteristics may shift.

## Build and release integration analysis

### `scripts/build-hooks.js`

Smart Explore appears in build integration as a required distribution artifact:
- `plugin/skills/smart-explore/SKILL.md` is validated during distribution checks.
- MCP server bundling includes smart-file-read runtime via `src/servers/mcp-server.ts` imports.

Extraction implications:
- Build-time coupling exists through the monorepo build script.
- Standalone extraction should introduce its own build pipeline and artifact validation.

### `plugin/scripts/mcp-server.cjs`

This is generated output from build. It mirrors Smart Explore logic but should not be treated as authoritative for extraction.

Extraction implication:
- Do not base extraction on this file; regenerate from TypeScript sources in standalone project.

## Changelog-derived timeline

From `CHANGELOG.md`:
- **v10.5.0**: Smart Explore introduced (AST-powered navigation, 3 new tools).
- **v10.5.1**: Related hook configuration rollback note indicates nearby integration churn.
- **v10.5.2**: Benchmark docs and skill guidance updated with revised token/completeness claims.

Implication:
- Feature is new and still stabilizing in messaging/integration; extraction should include regression checks around claims and workflow behavior.

## Boundaries: what is and is not Smart Explore

Included in Smart Explore core:
- `src/services/smart-file-read/parser.ts`
- `src/services/smart-file-read/search.ts`
- MCP tool exposure paths in `src/servers/mcp-server.ts`
- Smart Explore skill docs (`plugin/skills/smart-explore/SKILL.md`)

Adjacent but non-core:
- Benchmark docs and changelog entries
- Generated build artifact (`plugin/scripts/mcp-server.cjs`)

Not Smart Explore feature code (despite similar naming):
- `scripts/smart-install.js` and `tests/smart-install.test.ts` are installation/runtime bootstrap utilities unrelated to Smart Explore code exploration.

## Dependency map for extraction

- **Runtime deps**: `node:fs/promises`, `node:path`, `node:child_process`, `node:os`, `node:module`.
- **External deps**:
  - `tree-sitter-cli`
  - grammar packages (`tree-sitter-javascript`, `tree-sitter-typescript`, `tree-sitter-python`, `tree-sitter-go`, `tree-sitter-rust`, `tree-sitter-ruby`, `tree-sitter-java`, `tree-sitter-c`, `tree-sitter-cpp`)
- **Current host integration**: MCP server (`@modelcontextprotocol/sdk`) exposes tools.

## Risk and readiness assessment

Strengths for extraction:
- Clear module boundary under `src/services/smart-file-read/`.
- Function-based APIs already usable without global singleton state.
- Prompt contract already documented.

Risks to manage:
- CLI/path resolution differences across environments.
- Language grammar package availability drift.
- Potential behavior mismatch if extracted without preserving ignore rules and formatting contract.

Overall assessment:
- Smart Explore is **highly extractable** with a moderate packaging effort, because core logic is localized and primarily depends on tree-sitter CLI plus filesystem access.
