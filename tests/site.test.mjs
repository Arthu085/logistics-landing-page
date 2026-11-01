import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const html = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');

test('every navigation destination exists and section IDs are unique', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, anchor] of html.matchAll(/href="#([^"]+)"/g)) {
    assert.ok(ids.includes(anchor), `Missing destination #${anchor}`);
  }
  for (const id of ['inicio', 'servicos', 'diferenciais', 'contato']) {
    assert.ok(ids.includes(id));
  }
});

test('assets resolve locally and images have accessible descriptions', async () => {
  for (const [, asset] of html.matchAll(/(?:src|href)="(\/(?!\/)[^"]+)"/g)) {
    await access(new URL(`../src${asset}`, import.meta.url));
  }
  for (const [image] of html.matchAll(/<img\b[^>]*>/g)) {
    assert.match(image, /alt="[^\"]+"/);
    assert.match(image, /width="\d+"/);
    assert.match(image, /height="\d+"/);
  }
  assert.match(html, /lang="pt-BR"/);
  assert.match(html, /name="viewport"/);
  assert.equal([...html.matchAll(/<h1\b/g)].length, 1);
});

test('contact is explicitly demonstrative and never simulates submission', () => {
  assert.match(html, /href="mailto:contato@nexo\.example"/);
  assert.match(html, /Contato demonstrativo/);
  assert.doesNotMatch(html, /<form\b|<script\b|https?:\/\//);
});

test('build records the requested revision and provides an HTTP health endpoint', async () => {
  const revision = 'a'.repeat(40);
  const result = spawnSync(process.execPath, ['scripts/build.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, BUILD_REVISION: revision },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(new URL('../dist/version.json', import.meta.url), 'utf8')), { revision });
  assert.equal(await readFile(new URL('../dist/healthz', import.meta.url), 'utf8'), 'ok\n');
  assert.equal(await readFile(new URL('../dist/index.html', import.meta.url), 'utf8'), html);
});
