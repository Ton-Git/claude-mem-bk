import test from 'node:test';
import assert from 'node:assert/strict';
import { createSmartExploreTools, callSmartExploreTool } from '../src/server/mcp-tools.js';

function getToolNames(tools) {
  return tools.map((t) => t.name).sort();
}

test('createSmartExploreTools exposes three smart_* tools', () => {
  const tools = createSmartExploreTools();
  assert.deepEqual(getToolNames(tools), ['smart_outline', 'smart_search', 'smart_unfold']);
});

test('smart_search tool delegates to search function and formats output', async () => {
  const tools = createSmartExploreTools({
    searchFn: async () => ({
      foldedFiles: [],
      matchingSymbols: [],
      totalFilesScanned: 0,
      totalSymbolsFound: 0,
      tokenEstimate: 0,
    }),
  });

  const result = await callSmartExploreTool(tools, 'smart_search', { query: 'x', path: '/tmp' });
  assert.equal(result.content[0].type, 'text');
  assert.match(result.content[0].text, /Smart Search: "x"/);
});

test('smart_outline returns formatted outline for parsed symbols', async () => {
  const tools = createSmartExploreTools({
    readFileFn: async () => 'export function x() {}',
    parseFn: () => ({
      filePath: 'a.ts',
      language: 'typescript',
      imports: [],
      totalLines: 1,
      foldedTokenEstimate: 5,
      symbols: [
        {
          name: 'x',
          kind: 'function',
          signature: 'function x()',
          lineStart: 0,
          lineEnd: 0,
          exported: true,
        },
      ],
    }),
  });

  const result = await callSmartExploreTool(tools, 'smart_outline', { file_path: '/tmp/a.ts' });
  assert.match(result.content[0].text, /x/);
});

test('smart_unfold returns fallback symbol list when symbol is missing', async () => {
  const tools = createSmartExploreTools({
    readFileFn: async () => 'export function x() {}',
    unfoldFn: () => null,
    parseFn: () => ({
      symbols: [
        {
          name: 'x',
          kind: 'function',
          signature: 'function x()',
          lineStart: 0,
          lineEnd: 0,
          exported: true,
        },
      ],
    }),
  });

  const result = await callSmartExploreTool(tools, 'smart_unfold', {
    file_path: '/tmp/a.ts',
    symbol_name: 'missing',
  });

  assert.match(result.content[0].text, /Available symbols/);
  assert.match(result.content[0].text, /x \(function\)/);
});

test('callSmartExploreTool throws on unknown tool name', async () => {
  const tools = createSmartExploreTools();
  await assert.rejects(() => callSmartExploreTool(tools, 'missing_tool'), /Unknown tool/);
});
