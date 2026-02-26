# Smart Explore Export — Phase 2 Migration Plan

## Current status of `features-export/src`

Implemented in `features-export/src`:
- `core/parser.js` (AST parsing + outline + unfold engine)
- `core/search.js` (codebase search + ranking + folded formatting)
- `server/mcp-tools.js` (tool surface: `smart_search`, `smart_outline`, `smart_unfold`)

Conclusion: the **runtime search feature code in the new `src` folder is implemented** for standalone Smart Explore behavior.

## What is still missing from the main project

### 1) Skill prompt contract (needs copy/migration)

Missing in `features-export`:
- `plugin/skills/smart-explore/SKILL.md`

Why this matters:
- This is the behavioral contract that tells agents to use Smart Explore tools first.
- Without it, exported runtime code works, but agent usage quality/regression parity is incomplete.

Recommended migration target:
- Copy into `features-export/skills/smart-explore/SKILL.md` (or equivalent docs location).

### 2) Hooks related to Smart Explore (none to copy)

Checked areas:
- `src/hooks/*`
- `plugin/hooks/hooks.json`

Result:
- There are **no Smart Explore-specific hooks** to migrate.
- Existing hooks are for memory lifecycle/session processing, not Smart Explore tool behavior.

### 3) Related non-runtime assets to carry for parity

These are not required to execute tools, but should be migrated if parity with main project packaging/docs is desired:
- `docs/public/smart-explore-benchmark.mdx` (benchmark and usage claims)
- `docs/public/docs.json` entry for Smart Explore benchmark navigation
- `scripts/build-hooks.js` distribution check expectation for `plugin/skills/smart-explore/SKILL.md`

## Phase 2 tasks

- [ ] Copy `plugin/skills/smart-explore/SKILL.md` into `features-export` and keep frontmatter/instructions intact
- [ ] Add a short `features-export` note describing how the skill pairs with `smart_search`/`smart_outline`/`smart_unfold`
- [ ] Decide whether benchmark docs are in scope; if yes, migrate `smart-explore-benchmark.mdx` + docs navigation metadata
- [ ] If this export is packaged, add a distribution check that verifies the migrated skill file exists

## Exit criteria for Phase 2

- Export contains both runtime Smart Explore implementation and its skill guidance contract
- Explicit confirmation documented that no Smart Explore-specific hook migration is required
- Optional benchmark/docs parity decision is documented (migrated or intentionally deferred)
