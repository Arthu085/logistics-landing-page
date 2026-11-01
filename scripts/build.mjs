import { cp, mkdir, rm, writeFile } from 'node:fs/promises';

const revision = process.env.BUILD_REVISION ?? 'local';
if (!/^(local|[a-f0-9]{7,40})$/.test(revision)) {
  throw new Error('BUILD_REVISION must be local or a Git commit SHA.');
}
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('src', 'dist', { recursive: true });
await writeFile('dist/healthz', 'ok\n');
await writeFile('dist/version.json', JSON.stringify({ revision }) + '\n');
console.log(`Static site built in dist/ (revision: ${revision}).`);
