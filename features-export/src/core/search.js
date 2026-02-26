import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parseFilesBatch, formatFoldedView } from './parser.js';

export const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.pyw',
  '.go',
  '.rs',
  '.rb',
  '.java',
  '.cs',
  '.cpp', '.c', '.h', '.hpp',
  '.swift',
  '.kt',
  '.php',
  '.vue', '.svelte',
]);

export const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  '.venv', 'venv', 'env', '.env', 'target', 'vendor',
  '.cache', '.turbo', 'coverage', '.nyc_output',
  '.claude', '.smart-file-read',
]);

const MAX_FILE_SIZE_BYTES = 512 * 1024;

async function* walkDir(dir, maxDepth = 20) {
  if (maxDepth <= 0) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') || IGNORE_DIRS.has(entry.name)) continue;

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      yield* walkDir(fullPath, maxDepth - 1);
    } else if (entry.isFile()) {
      const ext = entry.name.slice(entry.name.lastIndexOf('.'));
      if (CODE_EXTENSIONS.has(ext)) yield fullPath;
    }
  }
}

async function safeReadFile(filePath) {
  try {
    const stats = await stat(filePath);
    if (stats.size > MAX_FILE_SIZE_BYTES || stats.size === 0) return null;

    const content = await readFile(filePath, 'utf-8');
    if (content.slice(0, 1000).includes('\0')) return null;

    return content;
  } catch {
    return null;
  }
}

function matchScore(text, queryParts) {
  let score = 0;

  for (const part of queryParts) {
    if (text === part) {
      score += 10;
    } else if (text.includes(part)) {
      score += 5;
    } else {
      let ti = 0;
      let matched = 0;
      for (const ch of part) {
        const idx = text.indexOf(ch, ti);
        if (idx !== -1) {
          matched += 1;
          ti = idx + 1;
        }
      }
      if (matched === part.length) score += 1;
    }
  }

  return score;
}

function countSymbols(file) {
  let count = file.symbols.length;
  for (const sym of file.symbols) {
    if (sym.children) count += sym.children.length;
  }
  return count;
}

export async function searchCodebase(rootDir, query, options = {}) {
  const maxResults = options.maxResults || 20;
  const queryLower = query.toLowerCase();
  const queryParts = queryLower.split(/[\s_\-./]+/).filter((p) => p.length > 0);

  const filesToParse = [];

  for await (const filePath of walkDir(rootDir)) {
    if (options.filePattern) {
      const relPath = relative(rootDir, filePath);
      if (!relPath.toLowerCase().includes(options.filePattern.toLowerCase())) continue;
    }

    const content = await safeReadFile(filePath);
    if (!content) continue;

    filesToParse.push({
      absolutePath: filePath,
      relativePath: relative(rootDir, filePath),
      content,
    });
  }

  const parser = options.parserBatch || parseFilesBatch;
  const parsedFiles = parser(filesToParse);

  const foldedFiles = [];
  const matchingSymbols = [];
  let totalSymbolsFound = 0;

  for (const [relPath, parsed] of parsedFiles) {
    totalSymbolsFound += countSymbols(parsed);

    const pathMatch = matchScore(relPath.toLowerCase(), queryParts);
    let fileHasMatch = pathMatch > 0;
    const fileSymbolMatches = [];

    const checkSymbols = (symbols, parent) => {
      for (const sym of symbols) {
        let score = 0;
        let reason = '';

        const nameScore = matchScore(sym.name.toLowerCase(), queryParts);
        if (nameScore > 0) {
          score += nameScore * 3;
          reason = 'name match';
        }

        if (sym.signature.toLowerCase().includes(queryLower)) {
          score += 2;
          reason = reason ? `${reason} + signature` : 'signature match';
        }

        if (sym.jsdoc && sym.jsdoc.toLowerCase().includes(queryLower)) {
          score += 1;
          reason = reason ? `${reason} + jsdoc` : 'jsdoc match';
        }

        if (score > 0) {
          fileHasMatch = true;
          fileSymbolMatches.push({
            filePath: relPath,
            symbolName: parent ? `${parent}.${sym.name}` : sym.name,
            kind: sym.kind,
            signature: sym.signature,
            jsdoc: sym.jsdoc,
            lineStart: sym.lineStart,
            lineEnd: sym.lineEnd,
            matchReason: reason,
          });
        }

        if (sym.children) checkSymbols(sym.children, sym.name);
      }
    };

    checkSymbols(parsed.symbols);

    if (fileHasMatch) {
      foldedFiles.push(parsed);
      matchingSymbols.push(...fileSymbolMatches);
    }
  }

  matchingSymbols.sort((a, b) => {
    const aScore = matchScore(a.symbolName.toLowerCase(), queryParts);
    const bScore = matchScore(b.symbolName.toLowerCase(), queryParts);
    return bScore - aScore;
  });

  const trimmedSymbols = matchingSymbols.slice(0, maxResults);
  const relevantFiles = new Set(trimmedSymbols.map((s) => s.filePath));
  const trimmedFiles = foldedFiles.filter((f) => relevantFiles.has(f.filePath)).slice(0, maxResults);

  const tokenEstimate = trimmedFiles.reduce((sum, f) => sum + f.foldedTokenEstimate, 0);

  return {
    foldedFiles: trimmedFiles,
    matchingSymbols: trimmedSymbols,
    totalFilesScanned: filesToParse.length,
    totalSymbolsFound,
    tokenEstimate,
  };
}

export function formatSearchResults(result, query) {
  const parts = [];

  parts.push(`🔍 Smart Search: "${query}"`);
  parts.push(`   Scanned ${result.totalFilesScanned} files, found ${result.totalSymbolsFound} symbols`);
  parts.push(`   ${result.matchingSymbols.length} matches across ${result.foldedFiles.length} files (~${result.tokenEstimate} tokens for folded view)`);
  parts.push('');

  if (result.matchingSymbols.length === 0) {
    parts.push('   No matching symbols found.');
    return parts.join('\n');
  }

  parts.push('── Matching Symbols ──');
  parts.push('');

  for (const match of result.matchingSymbols) {
    parts.push(`  ${match.kind} ${match.symbolName} (${match.filePath}:${match.lineStart + 1})`);
    parts.push(`    ${match.signature}`);

    if (match.jsdoc) {
      const firstLine = match.jsdoc.split('\n').find((l) => l.replace(/^[\s*/]+/, '').trim().length > 0);
      if (firstLine) parts.push(`    💬 ${firstLine.replace(/^[\s*/]+/, '').trim()}`);
    }

    parts.push('');
  }

  parts.push('── Folded File Views ──');
  parts.push('');
  for (const file of result.foldedFiles) {
    parts.push(formatFoldedView(file));
    parts.push('');
  }

  parts.push('── Actions ──');
  parts.push('  To see full implementation: use smart_unfold with file path and symbol name');

  return parts.join('\n');
}
