import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, formatFoldedView, unfoldSymbol } from '../src/core/parser.js';

test('detectLanguage maps known extensions and unknown values', () => {
  assert.equal(detectLanguage('file.ts'), 'typescript');
  assert.equal(detectLanguage('file.py'), 'python');
  assert.equal(detectLanguage('file.jsx'), 'javascript');
  assert.equal(detectLanguage('file.unknown'), 'unknown');
});

test('formatFoldedView renders imports, symbols, and child methods', () => {
  const output = formatFoldedView({
    filePath: 'src/example.ts',
    language: 'typescript',
    totalLines: 40,
    foldedTokenEstimate: 10,
    imports: ['import { x } from "y";'],
    symbols: [
      {
        name: 'Example',
        kind: 'class',
        signature: 'class Example',
        lineStart: 3,
        lineEnd: 30,
        exported: true,
        children: [
          {
            name: 'run',
            kind: 'method',
            signature: 'run() => void',
            lineStart: 10,
            lineEnd: 14,
            exported: false,
          },
        ],
      },
    ],
  });

  assert.match(output, /📦 Imports: 1 statements/);
  assert.match(output, /◆ Example \[exported\]/);
  assert.match(output, /ƒ run/);
});

test('unfoldSymbol uses provided parsedFile and includes leading comments', () => {
  const content = [
    '/** important */',
    'function keep() {}',
    '',
    '// docs',
    'function target() {',
    '  return 1;',
    '}',
  ].join('\n');

  const parsedFile = {
    symbols: [
      {
        name: 'target',
        kind: 'function',
        signature: 'function target()',
        lineStart: 4,
        lineEnd: 6,
        exported: true,
      },
    ],
  };

  const out = unfoldSymbol(content, '/abs/file.js', 'target', { parsedFile });
  assert.ok(out);
  assert.match(out, /\/\/ docs/);
  assert.match(out, /function target\(\)/);
  assert.match(out, /L\d+-\d+/);
});

test('unfoldSymbol returns null when symbol is missing', () => {
  const content = 'function a() {}';
  const parsedFile = { symbols: [] };
  const out = unfoldSymbol(content, '/abs/file.js', 'missing', { parsedFile });
  assert.equal(out, null);
});

test('unfoldSymbol resolves dotted symbol paths for nested methods', () => {
  const content = [
    'class Example {',
    '  run() {',
    '    return true;',
    '  }',
    '}',
  ].join('\n');

  const parsedFile = {
    symbols: [
      {
        name: 'Example',
        kind: 'class',
        signature: 'class Example',
        lineStart: 0,
        lineEnd: 4,
        exported: true,
        children: [
          {
            name: 'run',
            kind: 'method',
            signature: 'run()',
            lineStart: 1,
            lineEnd: 3,
            exported: false,
          },
        ],
      },
    ],
  };

  const out = unfoldSymbol(content, '/abs/file.js', 'Example.run', { parsedFile });
  assert.ok(out);
  assert.match(out, /run\(\)/);
});
