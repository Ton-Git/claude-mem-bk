import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const SRC_ROOT = new URL('../src/', import.meta.url);

async function collectJsFiles(dirUrl) {
  const entries = await readdir(dirUrl, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dirUrl);
    if (entry.isDirectory()) {
      files.push(...await collectJsFiles(entryUrl));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(entryUrl);
    }
  }

  return files;
}

test('features-export has local-only source imports', async () => {
  const jsFiles = await collectJsFiles(SRC_ROOT);

  for (const fileUrl of jsFiles) {
    const content = await readFile(fileUrl, 'utf-8');
    const source = fileUrl.pathname.split('/features-export/')[1];
    const importSpecifiers = Array.from(content.matchAll(/(?:import\s+[^'"\n]+from\s+|import\()\s*['"]([^'"]+)['"]/g)).map((match) => match[1]);

    for (const specifier of importSpecifiers) {
      if (!specifier.startsWith('.')) continue;
      assert.ok(!specifier.startsWith('../../'), `${source} has external relative import: ${specifier}`);
      assert.ok(!specifier.startsWith('../..\\'), `${source} has external relative import: ${specifier}`);
    }
  }
});

test('features-export includes standalone package config', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf-8'));

  assert.equal(packageJson.type, 'module');
  assert.equal(packageJson.scripts?.test, 'node --test tests/*.test.js');
  assert.ok(packageJson.dependencies?.['tree-sitter-cli']);
});
