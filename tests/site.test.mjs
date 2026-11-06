import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile, access, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const html = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');
const root = new URL('..', import.meta.url);

function runBuild(revision) {
  return spawnSync(process.execPath, ['scripts/build.mjs'], {
    cwd: root,
    env: { ...process.env, BUILD_REVISION: revision },
    encoding: 'utf8',
  });
}

let preview;
let previewUrl;

before(async () => {
  process.env.PORT = '0';
  ({ server: preview } = await import('../scripts/serve.mjs'));
  if (!preview.listening) await once(preview, 'listening');
  previewUrl = `http://127.0.0.1:${preview.address().port}`;
});

after(() => preview.close());

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
  const result = runBuild(revision);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(new URL('../dist/version.json', import.meta.url), 'utf8')), { revision });
  assert.equal(await readFile(new URL('../dist/healthz', import.meta.url), 'utf8'), 'ok\n');
  assert.equal(await readFile(new URL('../dist/index.html', import.meta.url), 'utf8'), html);
});

test('build rejects a revision that is not a commit SHA', () => {
  const result = runBuild('main; rm -rf /');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /BUILD_REVISION must be local or a Git commit SHA/);
});

// Shares dist/ with the build tests, so it stays in this file where tests run serially.
test('preview server asks for a build until dist/ exists, then serves it', async () => {
  await rm(new URL('../dist', import.meta.url), { recursive: true, force: true });
  const missing = await fetch(`${previewUrl}/`);
  assert.equal(missing.status, 503);
  assert.equal(await missing.text(), 'Run npm run build first.');

  assert.equal(runBuild('local').status, 0);
  const page = await fetch(`${previewUrl}/index.html?utm=test`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(await page.text(), html);
});

test('preview server answers HEAD without a body and refuses unknown routes and methods', async () => {
  const head = await fetch(`${previewUrl}/healthz`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');

  const notFound = await fetch(`${previewUrl}/package.json`);
  assert.equal(notFound.status, 404);
  await notFound.arrayBuffer();

  const refused = await fetch(`${previewUrl}/`, { method: 'POST' });
  assert.equal(refused.status, 405);
  assert.equal(refused.headers.get('allow'), 'GET, HEAD');
  await refused.arrayBuffer();
});
