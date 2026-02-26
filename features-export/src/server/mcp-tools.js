import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { searchCodebase, formatSearchResults } from '../core/search.js';
import { parseFile, formatFoldedView, unfoldSymbol } from '../core/parser.js';

export function createSmartExploreTools(deps = {}) {
  const readFileFn = deps.readFileFn || readFile;
  const searchFn = deps.searchFn || searchCodebase;
  const parseFn = deps.parseFn || parseFile;
  const formatFoldedViewFn = deps.formatFoldedViewFn || formatFoldedView;
  const unfoldFn = deps.unfoldFn || unfoldSymbol;

  return [
    {
      name: 'smart_search',
      description: 'Search codebase for symbols, functions, classes using tree-sitter AST parsing. Returns folded structural views with token counts.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          path: { type: 'string' },
          max_results: { type: 'number' },
          file_pattern: { type: 'string' },
        },
        required: ['query'],
      },
      handler: async (args) => {
        const rootDir = resolve(args.path || process.cwd());
        const result = await searchFn(rootDir, args.query, {
          maxResults: args.max_results || 20,
          filePattern: args.file_pattern,
        });
        return { content: [{ type: 'text', text: formatSearchResults(result, args.query) }] };
      },
    },
    {
      name: 'smart_outline',
      description: 'Get structural outline of a file with symbol signatures and folded bodies.',
      inputSchema: {
        type: 'object',
        properties: { file_path: { type: 'string' } },
        required: ['file_path'],
      },
      handler: async (args) => {
        const filePath = resolve(args.file_path);
        const content = await readFileFn(filePath, 'utf-8');
        const parsed = parseFn(content, filePath);
        if (parsed.symbols.length > 0) {
          return { content: [{ type: 'text', text: formatFoldedViewFn(parsed) }] };
        }
        return {
          content: [{ type: 'text', text: `Could not parse ${args.file_path}. File may use an unsupported language or be empty.` }],
        };
      },
    },
    {
      name: 'smart_unfold',
      description: 'Expand one symbol from a file and return full source for that symbol only.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          symbol_name: { type: 'string' },
        },
        required: ['file_path', 'symbol_name'],
      },
      handler: async (args) => {
        const filePath = resolve(args.file_path);
        const content = await readFileFn(filePath, 'utf-8');
        const unfolded = unfoldFn(content, filePath, args.symbol_name);
        if (unfolded) return { content: [{ type: 'text', text: unfolded }] };

        const parsed = parseFn(content, filePath);
        if (parsed.symbols.length > 0) {
          const available = parsed.symbols.map((s) => `  - ${s.name} (${s.kind})`).join('\n');
          return {
            content: [{ type: 'text', text: `Symbol "${args.symbol_name}" not found in ${args.file_path}.\n\nAvailable symbols:\n${available}` }],
          };
        }

        return {
          content: [{ type: 'text', text: `Could not parse ${args.file_path}. File may be unsupported or empty.` }],
        };
      },
    },
  ];
}

export async function callSmartExploreTool(tools, name, args = {}) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool.handler(args);
}
