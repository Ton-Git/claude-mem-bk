import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);

const LANG_MAP = {
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.py': 'python',
  '.pyw': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.rb': 'ruby',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
};

const GRAMMAR_PACKAGES = {
  javascript: 'tree-sitter-javascript',
  typescript: 'tree-sitter-typescript/typescript',
  tsx: 'tree-sitter-typescript/tsx',
  python: 'tree-sitter-python',
  go: 'tree-sitter-go',
  rust: 'tree-sitter-rust',
  ruby: 'tree-sitter-ruby',
  java: 'tree-sitter-java',
  c: 'tree-sitter-c',
  cpp: 'tree-sitter-cpp',
};

const QUERIES = {
  jsts: `
(function_declaration name: (identifier) @name) @func
(lexical_declaration (variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression)])) @const_func
(class_declaration name: (type_identifier) @name) @cls
(method_definition name: (property_identifier) @name) @method
(interface_declaration name: (type_identifier) @name) @iface
(type_alias_declaration name: (type_identifier) @name) @tdef
(enum_declaration name: (identifier) @name) @enm
(import_statement) @imp
(export_statement) @exp
`,
  python: `
(function_definition name: (identifier) @name) @func
(class_definition name: (identifier) @name) @cls
(import_statement) @imp
(import_from_statement) @imp
`,
  go: `
(function_declaration name: (identifier) @name) @func
(method_declaration name: (field_identifier) @name) @method
(type_declaration (type_spec name: (type_identifier) @name)) @tdef
(import_declaration) @imp
`,
  rust: `
(function_item name: (identifier) @name) @func
(struct_item name: (type_identifier) @name) @struct_def
(enum_item name: (type_identifier) @name) @enm
(trait_item name: (type_identifier) @name) @trait_def
(impl_item type: (type_identifier) @name) @impl_def
(use_declaration) @imp
`,
  ruby: `
(method name: (identifier) @name) @func
(class name: (constant) @name) @cls
(module name: (constant) @name) @cls
(call method: (identifier) @name) @imp
`,
  java: `
(method_declaration name: (identifier) @name) @method
(class_declaration name: (identifier) @name) @cls
(interface_declaration name: (identifier) @name) @iface
(enum_declaration name: (identifier) @name) @enm
(import_declaration) @imp
`,
  generic: `
(function_declaration name: (identifier) @name) @func
(function_definition name: (identifier) @name) @func
(class_declaration name: (identifier) @name) @cls
(class_definition name: (identifier) @name) @cls
(import_statement) @imp
(import_declaration) @imp
`,
};

const KIND_MAP = {
  func: 'function',
  const_func: 'function',
  cls: 'class',
  method: 'method',
  iface: 'interface',
  tdef: 'type',
  enm: 'enum',
  struct_def: 'struct',
  trait_def: 'trait',
  impl_def: 'impl',
};

const CONTAINER_KINDS = new Set(['class', 'struct', 'impl', 'trait']);
const SIGNATURE_MAX_LEN = 200;
const SIGNATURE_LOOKAHEAD_LINES = 10;
const SIGNATURE_BRACE_WINDOW = 500;

let queryTmpDir = null;
const queryFileCache = new Map();
let cachedBinPath = null;
const TREE_SITTER_TIMEOUT_MS = 30000;
let cleanupRegistered = false;

export function detectLanguage(filePath) {
  const ext = filePath.slice(filePath.lastIndexOf('.'));
  return LANG_MAP[ext] || 'unknown';
}

function resolveGrammarPath(language) {
  const pkg = GRAMMAR_PACKAGES[language];
  if (!pkg) return null;
  try {
    const packageJsonPath = _require.resolve(`${pkg}/package.json`);
    return dirname(packageJsonPath);
  } catch {
    return null;
  }
}

function getQueryKey(language) {
  switch (language) {
    case 'javascript':
    case 'typescript':
    case 'tsx':
      return 'jsts';
    case 'python':
      return 'python';
    case 'go':
      return 'go';
    case 'rust':
      return 'rust';
    case 'ruby':
      return 'ruby';
    case 'java':
      return 'java';
    default:
      return 'generic';
  }
}

function getQueryFile(queryKey) {
  if (queryFileCache.has(queryKey)) return queryFileCache.get(queryKey);

  if (!queryTmpDir) {
    queryTmpDir = mkdtempSync(join(tmpdir(), 'smart-explore-queries-'));
    registerQueryTmpCleanup();
  }

  const filePath = join(queryTmpDir, `${queryKey}.scm`);
  writeFileSync(filePath, QUERIES[queryKey]);
  queryFileCache.set(queryKey, filePath);
  return filePath;
}

function getTreeSitterBin() {
  if (cachedBinPath) return cachedBinPath;

  try {
    const pkgPath = _require.resolve('tree-sitter-cli/package.json');
    const binPath = join(dirname(pkgPath), 'tree-sitter');
    if (existsSync(binPath)) {
      cachedBinPath = binPath;
      return binPath;
    }
  } catch {
    // fallback to PATH below
  }

  cachedBinPath = 'tree-sitter';
  return cachedBinPath;
}

function registerQueryTmpCleanup() {
  if (cleanupRegistered) return;
  cleanupRegistered = true;

  const cleanup = () => {
    if (!queryTmpDir) return;
    rmSync(queryTmpDir, { recursive: true, force: true });
    queryTmpDir = null;
  };

  process.once('exit', cleanup);
  process.once('beforeExit', cleanup);
}

function runBatchQuery(queryFile, sourceFiles, grammarPath) {
  if (sourceFiles.length === 0) return new Map();

  const bin = getTreeSitterBin();
  const execArgs = ['query', '-p', grammarPath, queryFile, ...sourceFiles];

  let output;
  try {
    output = execFileSync(bin, execArgs, {
      encoding: 'utf-8',
      timeout: TREE_SITTER_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    return new Map();
  }

  return parseMultiFileQueryOutput(output);
}

function runQuery(queryFile, sourceFile, grammarPath) {
  const result = runBatchQuery(queryFile, [sourceFile], grammarPath);
  return result.get(sourceFile) || [];
}

function parseMultiFileQueryOutput(output) {
  const fileMatches = new Map();
  let currentFile = null;
  let currentMatch = null;

  for (const line of output.split('\n')) {
    if (line.length > 0 && !/^\s/.test(line)) {
      currentFile = line.trim();
      if (!fileMatches.has(currentFile)) fileMatches.set(currentFile, []);
      currentMatch = null;
      continue;
    }

    if (!currentFile) continue;

    const patternMatch = line.match(/^\s+pattern:\s+(\d+)/);
    if (patternMatch) {
      currentMatch = { pattern: parseInt(patternMatch[1], 10), captures: [] };
      fileMatches.get(currentFile).push(currentMatch);
      continue;
    }

    const captureMatch = line.match(
      /^\s+capture:\s+(?:\d+\s*-\s*)?(\w+),\s*start:\s*\((\d+),\s*(\d+)\),\s*end:\s*\((\d+),\s*(\d+)\)(?:,\s*text:\s*`([^`]*)`)?/
    );

    if (captureMatch && currentMatch) {
      currentMatch.captures.push({
        tag: captureMatch[1],
        startRow: parseInt(captureMatch[2], 10),
        startCol: parseInt(captureMatch[3], 10),
        endRow: parseInt(captureMatch[4], 10),
        endCol: parseInt(captureMatch[5], 10),
        text: captureMatch[6],
      });
    }
  }

  return fileMatches;
}

function extractSignatureFromLines(lines, startRow, endRow, maxLen = SIGNATURE_MAX_LEN) {
  const firstLine = lines[startRow] || '';
  let sig = firstLine;

  if (!sig.trimEnd().endsWith('{') && !sig.trimEnd().endsWith(':')) {
    const chunk = lines.slice(startRow, Math.min(startRow + SIGNATURE_LOOKAHEAD_LINES, endRow + 1)).join('\n');
    const braceIdx = chunk.indexOf('{');
    if (braceIdx !== -1 && braceIdx < SIGNATURE_BRACE_WINDOW) {
      sig = chunk.slice(0, braceIdx).replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  sig = sig.replace(/\s*[{:]\s*$/, '').trim();
  if (sig.length > maxLen) sig = `${sig.slice(0, maxLen - 3)}...`;
  return sig;
}

function findCommentAbove(lines, startRow) {
  const commentLines = [];
  let foundComment = false;

  for (let i = startRow - 1; i >= 0; i -= 1) {
    const trimmed = lines[i].trim();
    if (trimmed === '') {
      if (foundComment) break;
      continue;
    }

    if (
      trimmed.startsWith('/**') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('*/') ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('///') ||
      trimmed.startsWith('//!') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('@')
    ) {
      commentLines.unshift(lines[i]);
      foundComment = true;
    } else {
      break;
    }
  }

  return commentLines.length > 0 ? commentLines.join('\n').trim() : undefined;
}

function findPythonDocstringFromLines(lines, startRow, endRow) {
  for (let i = startRow + 1; i <= Math.min(startRow + 3, endRow); i += 1) {
    const trimmed = lines[i]?.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) return trimmed;
    break;
  }
  return undefined;
}

function isExported(name, startRow, endRow, exportRanges, lines, language) {
  switch (language) {
    case 'javascript':
    case 'typescript':
    case 'tsx':
      return exportRanges.some((r) => startRow >= r.startRow && endRow <= r.endRow);
    case 'python':
      return !name.startsWith('_');
    case 'go':
      return name.length > 0 && name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase();
    case 'rust':
      return lines[startRow]?.trimStart().startsWith('pub') ?? false;
    default:
      return true;
  }
}

function buildSymbols(matches, lines, language) {
  const symbols = [];
  const imports = [];
  const exportRanges = [];
  const containers = [];

  for (const match of matches) {
    for (const cap of match.captures) {
      if (cap.tag === 'exp') exportRanges.push({ startRow: cap.startRow, endRow: cap.endRow });
      if (cap.tag === 'imp') imports.push(cap.text || lines[cap.startRow]?.trim() || '');
    }
  }

  for (const match of matches) {
    const kindCapture = match.captures.find((c) => KIND_MAP[c.tag]);
    const nameCapture = match.captures.find((c) => c.tag === 'name');
    if (!kindCapture) continue;

    const name = nameCapture?.text || 'anonymous';
    const startRow = kindCapture.startRow;
    const endRow = kindCapture.endRow;
    const kind = KIND_MAP[kindCapture.tag];

    const comment = findCommentAbove(lines, startRow);
    const docstring = language === 'python' ? findPythonDocstringFromLines(lines, startRow, endRow) : undefined;

    const sym = {
      name,
      kind,
      signature: extractSignatureFromLines(lines, startRow, endRow),
      jsdoc: comment || docstring,
      lineStart: startRow,
      lineEnd: endRow,
      exported: isExported(name, startRow, endRow, exportRanges, lines, language),
    };

    if (CONTAINER_KINDS.has(kind)) {
      sym.children = [];
      containers.push({ sym, startRow, endRow });
    }

    symbols.push(sym);
  }

  const nested = new Set();
  for (const container of containers) {
    for (const sym of symbols) {
      if (sym === container.sym) continue;
      if (sym.lineStart > container.startRow && sym.lineEnd <= container.endRow) {
        if (sym.kind === 'function') sym.kind = 'method';
        container.sym.children.push(sym);
        nested.add(sym);
      }
    }
  }

  return { symbols: symbols.filter((s) => !nested.has(s)), imports };
}

export function formatFoldedView(file) {
  const parts = [];

  parts.push(`📁 ${file.filePath} (${file.language}, ${file.totalLines} lines)`);
  parts.push('');

  if (file.imports.length > 0) {
    parts.push(`  📦 Imports: ${file.imports.length} statements`);
    for (const imp of file.imports.slice(0, 10)) parts.push(`    ${imp}`);
    if (file.imports.length > 10) parts.push(`    ... +${file.imports.length - 10} more`);
    parts.push('');
  }

  for (const sym of file.symbols) parts.push(formatSymbol(sym, '  '));

  return parts.join('\n');
}

function formatSymbol(sym, indent) {
  const parts = [];

  const exportTag = sym.exported ? ' [exported]' : '';
  const lineRange = sym.lineStart === sym.lineEnd ? `L${sym.lineStart + 1}` : `L${sym.lineStart + 1}-${sym.lineEnd + 1}`;

  parts.push(`${indent}${getSymbolIcon(sym.kind)} ${sym.name}${exportTag} (${lineRange})`);
  parts.push(`${indent}  ${sym.signature}`);

  if (sym.jsdoc) {
    const jsdocLines = sym.jsdoc.split('\n');
    const firstLine = jsdocLines.find((l) => {
      const t = l.replace(/^[\s*/]+/, '').replace(/^['"`]{3}/, '').trim();
      return t.length > 0 && !t.startsWith('/**');
    });
    if (firstLine) {
      const cleaned = firstLine
        .replace(/^[\s*/]+/, '')
        .replace(/^['"`]{3}/, '')
        .replace(/['"`]{3}$/, '')
        .trim();
      if (cleaned) parts.push(`${indent}  💬 ${cleaned}`);
    }
  }

  if (sym.children && sym.children.length > 0) {
    for (const child of sym.children) parts.push(formatSymbol(child, `${indent}  `));
  }

  return parts.join('\n');
}

function getSymbolIcon(kind) {
  const icons = {
    function: 'ƒ',
    method: 'ƒ',
    class: '◆',
    interface: '◇',
    type: '◇',
    const: '●',
    variable: '○',
    export: '→',
    struct: '◆',
    enum: '▣',
    trait: '◇',
    impl: '◈',
    property: '○',
    getter: '⇢',
    setter: '⇠',
  };
  return icons[kind] || '·';
}

export function parseFile(content, filePath) {
  const language = detectLanguage(filePath);
  const lines = content.split('\n');

  const grammarPath = resolveGrammarPath(language);
  if (!grammarPath) {
    return {
      filePath,
      language,
      symbols: [],
      imports: [],
      totalLines: lines.length,
      foldedTokenEstimate: 50,
    };
  }

  const queryKey = getQueryKey(language);
  const queryFile = getQueryFile(queryKey);

  const ext = filePath.slice(filePath.lastIndexOf('.')) || '.txt';
  const tmpDir = mkdtempSync(join(tmpdir(), 'smart-explore-src-'));
  const tmpFile = join(tmpDir, `source${ext}`);
  writeFileSync(tmpFile, content);

  try {
    const matches = runQuery(queryFile, tmpFile, grammarPath);
    const result = buildSymbols(matches, lines, language);

    const folded = formatFoldedView({
      filePath,
      language,
      symbols: result.symbols,
      imports: result.imports,
      totalLines: lines.length,
      foldedTokenEstimate: 0,
    });

    return {
      filePath,
      language,
      symbols: result.symbols,
      imports: result.imports,
      totalLines: lines.length,
      foldedTokenEstimate: Math.ceil(folded.length / 4),
    };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

export function parseFilesBatch(files) {
  const results = new Map();

  const languageGroups = new Map();
  for (const file of files) {
    const language = detectLanguage(file.relativePath);
    if (!languageGroups.has(language)) languageGroups.set(language, []);
    languageGroups.get(language).push(file);
  }

  for (const [language, groupFiles] of languageGroups) {
    const grammarPath = resolveGrammarPath(language);
    if (!grammarPath) {
      for (const file of groupFiles) {
        const lines = file.content.split('\n');
        results.set(file.relativePath, {
          filePath: file.relativePath,
          language,
          symbols: [],
          imports: [],
          totalLines: lines.length,
          foldedTokenEstimate: 50,
        });
      }
      continue;
    }

    const queryKey = getQueryKey(language);
    const queryFile = getQueryFile(queryKey);

    const absolutePaths = groupFiles.map((f) => f.absolutePath);
    const batchResults = runBatchQuery(queryFile, absolutePaths, grammarPath);

    for (const file of groupFiles) {
      const lines = file.content.split('\n');
      const matches = batchResults.get(file.absolutePath) || [];
      const symbolResult = buildSymbols(matches, lines, language);

      const folded = formatFoldedView({
        filePath: file.relativePath,
        language,
        symbols: symbolResult.symbols,
        imports: symbolResult.imports,
        totalLines: lines.length,
        foldedTokenEstimate: 0,
      });

      results.set(file.relativePath, {
        filePath: file.relativePath,
        language,
        symbols: symbolResult.symbols,
        imports: symbolResult.imports,
        totalLines: lines.length,
        foldedTokenEstimate: Math.ceil(folded.length / 4),
      });
    }
  }

  return results;
}

export function unfoldSymbol(content, filePath, symbolName, options = {}) {
  const file = options.parsedFile || parseFile(content, filePath);

  const findSymbolByName = (symbols) => {
    for (const sym of symbols) {
      if (sym.name === symbolName) return sym;
      if (sym.children) {
        const found = findSymbolByName(sym.children);
        if (found) return found;
      }
    }
    return null;
  };

  const findSymbolByPath = (symbols, segments, index) => {
    if (!Array.isArray(segments) || index >= segments.length) return null;

    const segment = segments[index];
    for (const sym of symbols) {
      if (sym.name !== segment) continue;
      if (index === segments.length - 1) return sym;
      if (sym.children?.length) {
        const found = findSymbolByPath(sym.children, segments, index + 1);
        if (found) return found;
      }
    }
    return null;
  };

  let symbol = findSymbolByName(file.symbols);
  if (!symbol && typeof symbolName === 'string' && symbolName.includes('.')) {
    const segments = symbolName.split('.').filter((s) => s.length > 0);
    if (segments.length > 0) {
      symbol = findSymbolByPath(file.symbols, segments, 0);
    }
  }

  if (!symbol) return null;

  const lines = content.split('\n');
  let start = symbol.lineStart;

  for (let i = symbol.lineStart - 1; i >= 0; i -= 1) {
    const trimmed = lines[i].trim();
    if (
      trimmed === '' ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('/**') ||
      trimmed.startsWith('///') ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('@') ||
      trimmed === '*/'
    ) {
      start = i;
    } else {
      break;
    }
  }

  const extracted = lines.slice(start, symbol.lineEnd + 1).join('\n');
  return `// 📍 ${filePath} L${start + 1}-${symbol.lineEnd + 1}\n${extracted}`;
}
