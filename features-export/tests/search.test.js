import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchCodebase, formatSearchResults } from '../src/core/search.js';

async function setupTestFixture() {
  const root = await mkdtemp(join(tmpdir(), 'smart-explore-search-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'lib'), { recursive: true });

  await writeFile(join(root, 'src', 'alpha.ts'), 'export function alpha() { return 1; }\n');
  await writeFile(join(root, 'src', 'beta.ts'), 'export function beta() { return 2; }\n');
  await writeFile(join(root, 'node_modules', 'lib', 'ignored.ts'), 'export function ignored() {}\n');
  return root;
}

test('searchCodebase ignores ignored directories and returns symbol matches', async () => {
  const root = await setupTestFixture();

  try {
    const parserBatch = (files) => {
      const map = new Map();
      for (const f of files) {
        if (f.relativePath.endsWith('alpha.ts')) {
          map.set(f.relativePath, {
            filePath: f.relativePath,
            language: 'typescript',
            imports: [],
            totalLines: 1,
            foldedTokenEstimate: 20,
            symbols: [
              {
                name: 'alpha',
                kind: 'function',
                signature: 'function alpha() : number',
                lineStart: 0,
                lineEnd: 0,
                exported: true,
              },
            ],
          });
        } else {
          map.set(f.relativePath, {
            filePath: f.relativePath,
            language: 'typescript',
            imports: [],
            totalLines: 1,
            foldedTokenEstimate: 20,
            symbols: [
              {
                name: 'beta',
                kind: 'function',
                signature: 'function beta() : number',
                lineStart: 0,
                lineEnd: 0,
                exported: true,
              },
            ],
          });
        }
      }
      return map;
    };

    const result = await searchCodebase(root, 'alpha', { parserBatch, maxResults: 5 });
    assert.equal(result.totalFilesScanned, 2);
    assert.equal(result.matchingSymbols.length, 1);
    assert.equal(result.matchingSymbols[0].symbolName, 'alpha');
    assert.equal(result.foldedFiles.length, 1);
    assert.equal(result.foldedFiles[0].filePath, 'src/alpha.ts');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('searchCodebase supports filePattern filter', async () => {
  const root = await setupTestFixture();

  try {
    const parserBatch = (files) => {
      const map = new Map();
      for (const f of files) {
        map.set(f.relativePath, {
          filePath: f.relativePath,
          language: 'typescript',
          imports: [],
          totalLines: 1,
          foldedTokenEstimate: 15,
          symbols: [
            {
              name: 'alpha',
              kind: 'function',
              signature: 'function alpha()',
              lineStart: 0,
              lineEnd: 0,
              exported: true,
            },
          ],
        });
      }
      return map;
    };

    const result = await searchCodebase(root, 'alpha', {
      parserBatch,
      filePattern: 'alpha.ts',
    });

    assert.equal(result.totalFilesScanned, 1);
    assert.equal(result.foldedFiles.length, 1);
    assert.equal(result.foldedFiles[0].filePath, 'src/alpha.ts');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('formatSearchResults includes action guidance and compact symbol info', () => {
  const text = formatSearchResults(
    {
      foldedFiles: [
        {
          filePath: 'src/alpha.ts',
          language: 'typescript',
          imports: [],
          totalLines: 10,
          foldedTokenEstimate: 10,
          symbols: [],
        },
      ],
      matchingSymbols: [
        {
          filePath: 'src/alpha.ts',
          symbolName: 'alpha',
          kind: 'function',
          signature: 'function alpha() : number',
          jsdoc: '/** alpha */',
          lineStart: 1,
          lineEnd: 2,
          matchReason: 'name match',
        },
      ],
      totalFilesScanned: 1,
      totalSymbolsFound: 1,
      tokenEstimate: 10,
    },
    'alpha'
  );

  assert.match(text, /Smart Search: "alpha"/);
  assert.match(text, /Matching Symbols/);
  assert.match(text, /To see full implementation: use smart_unfold/);
});
